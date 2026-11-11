import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

export type StoredCookie = {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  hostOnly: boolean
  // Unix seconds; absent for a session cookie.
  expires?: number
}

const CHROME_BASE = path.join(os.homedir(), "Library/Application Support/Google/Chrome")
// Chrome time counts microseconds from 1601-01-01.
const EPOCH_DELTA_S = 11644473600

export function deriveKey(password: string): Buffer {
  return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1")
}

export function decryptValue(
  encrypted: Buffer,
  key: Buffer,
  hostKey: string,
  dbVersion: number
): string {
  if (encrypted.length === 0) return ""
  if (encrypted.subarray(0, 3).toString() !== "v10") return encrypted.toString("utf8")
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20))
  const plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()])
  // From db version 24 Chrome prepends SHA-256(host_key) to the value.
  const prefix = dbVersion >= 24 ? crypto.createHash("sha256").update(hostKey).digest() : null
  if (prefix && !plain.subarray(0, 32).equals(prefix)) {
    throw new Error(`Cookie for ${hostKey} did not decrypt cleanly`)
  }
  return (dbVersion >= 24 ? plain.subarray(32) : plain).toString("utf8")
}

export function hostKeysFor(host: string): string[] {
  const labels = host.split(".")
  const keys = [host, `.${host}`]
  // Parent domains, stopping before a single-label TLD.
  for (let i = 1; i < labels.length - 1; i++) keys.push(`.${labels.slice(i).join(".")}`)
  return keys
}

export function readCookiesFromDb(dbFile: string, host: string, key: Buffer): StoredCookie[] {
  // Chrome keeps the live DB locked, so read a private copy.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "design-review-cookies-"))
  try {
    const copy = path.join(dir, "Cookies")
    fs.copyFileSync(dbFile, copy)
    for (const ext of ["-wal", "-shm"]) {
      if (fs.existsSync(dbFile + ext)) fs.copyFileSync(dbFile + ext, copy + ext)
    }
    const db = new DatabaseSync(copy, { readOnly: true })
    try {
      const meta = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as
        { value: string } | undefined
      const version = Number(meta?.value ?? 0)
      const hostKeys = hostKeysFor(host)
      const stmt = db.prepare(
        `SELECT host_key, name, value, encrypted_value, path, is_secure, has_expires, expires_utc
           FROM cookies WHERE host_key IN (${hostKeys.map(() => "?").join(",")})`
      )
      // expires_utc can exceed 2^53, so read integers as bigint.
      stmt.setReadBigInts(true)
      const rows = stmt.all(...hostKeys) as {
        host_key: string
        name: string
        value: string
        encrypted_value: Uint8Array
        path: string
        is_secure: bigint
        has_expires: bigint
        expires_utc: bigint
      }[]
      const now = Date.now() / 1000
      const cookies: StoredCookie[] = []
      for (const r of rows) {
        const expires =
          r.has_expires !== 0n ? Number(r.expires_utc / 1000n) / 1e3 - EPOCH_DELTA_S : undefined
        if (expires !== undefined && expires <= now) continue
        const encrypted = Buffer.from(r.encrypted_value ?? [])
        let value = r.value
        try {
          if (encrypted.length) value = decryptValue(encrypted, key, r.host_key, version)
        } catch {
          // One bad row must not break startup or a refresh: skip it.
          continue
        }
        const hostOnly = !r.host_key.startsWith(".")
        cookies.push({
          name: r.name,
          value,
          domain: hostOnly ? r.host_key : r.host_key.slice(1),
          path: r.path,
          secure: !!r.is_secure,
          hostOnly,
          ...(expires !== undefined && { expires }),
        })
      }
      return cookies
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function chromeProfiles(base = CHROME_BASE): { name: string; cookiesFile: string }[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(base)
  } catch {
    return []
  }
  const profiles: { name: string; cookiesFile: string }[] = []
  for (const name of entries.filter((n) => n === "Default" || /^Profile /.test(n)).sort()) {
    const cookiesFile = [
      path.join(base, name, "Network/Cookies"),
      path.join(base, name, "Cookies"),
    ].find((f) => fs.existsSync(f))
    if (cookiesFile) profiles.push({ name, cookiesFile })
  }
  return profiles
}

export function keychainPassword(): string {
  try {
    return execFileSync("security", ["find-generic-password", "-w", "-s", "Chrome Safe Storage"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  } catch (err) {
    throw new Error(
      `Could not read "Chrome Safe Storage" from the macOS Keychain (allow access when asked): ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

// `onProfile` learns the profile used, picked or the only one, so a refresh
// can read the same one again without asking.
export async function loadChromeCookies(
  host: string,
  pickProfile: (names: string[]) => Promise<string>,
  onProfile?: (name: string) => void
): Promise<StoredCookie[]> {
  if (process.platform !== "darwin") {
    throw new Error("Remote review reads Chrome's cookies on macOS only")
  }
  const key = deriveKey(keychainPassword())
  const found = new Map<string, StoredCookie[]>()
  for (const p of chromeProfiles()) {
    const cookies = readCookiesFromDb(p.cookiesFile, host, key)
    if (cookies.length) found.set(p.name, cookies)
  }
  return chooseProfile(found, host, pickProfile, onProfile)
}

// The cookies of one profile among those that have some for `host`.
export async function chooseProfile(
  found: Map<string, StoredCookie[]>,
  host: string,
  pickProfile: (names: string[]) => Promise<string>,
  onProfile?: (name: string) => void
): Promise<StoredCookie[]> {
  if (found.size === 0) throw new Error(`Log in to ${host} in Chrome first`)
  const names = [...found.keys()]
  const chosen = names.length === 1 ? names[0] : await pickProfile(names)
  const cookies = found.get(chosen)
  if (!cookies) throw new Error(`No Chrome profile named ${chosen} has cookies for ${host}`)
  onProfile?.(chosen)
  return cookies
}
