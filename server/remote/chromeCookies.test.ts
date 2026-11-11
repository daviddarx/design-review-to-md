import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { decryptValue, deriveKey, hostKeysFor, readCookiesFromDb } from "./chromeCookies.ts"

const key = deriveKey("peanuts")

function encrypt(plain: Buffer, k = key) {
  const cipher = crypto.createCipheriv("aes-128-cbc", k, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()])
}

// Chrome time: microseconds since 1601-01-01.
const chromeTime = (ms: number) => (BigInt(ms) + 11644473600000n) * 1000n

describe("deriveKey", () => {
  it("is PBKDF2-SHA1 with Chrome's salt", () => {
    expect(deriveKey("peanuts")).toEqual(
      crypto.pbkdf2Sync("peanuts", "saltysalt", 1003, 16, "sha1")
    )
  })
})

describe("decryptValue", () => {
  it("decrypts a v10 value", () => {
    expect(decryptValue(encrypt(Buffer.from("abc")), key, ".a.ch", 23)).toBe("abc")
  })
  it("drops the host hash prefix from db version 24", () => {
    const hash = crypto.createHash("sha256").update(".a.ch").digest()
    const enc = encrypt(Buffer.concat([hash, Buffer.from("abc")]))
    expect(decryptValue(enc, key, ".a.ch", 24)).toBe("abc")
  })
  it("returns an empty string for an empty buffer", () => {
    expect(decryptValue(Buffer.alloc(0), key, ".a.ch", 24)).toBe("")
  })
})

describe("hostKeysFor", () => {
  it("lists the host and its parent domains, never a bare TLD", () => {
    expect(hostKeysFor("web1.stage.campos.ch")).toEqual([
      "web1.stage.campos.ch",
      ".web1.stage.campos.ch",
      ".stage.campos.ch",
      ".campos.ch",
    ])
  })
})

describe("readCookiesFromDb", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  it("reads, decrypts and filters the cookies of a host", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-fixture-"))
    dirs.push(dir)
    const file = path.join(dir, "Cookies")
    const db = new DatabaseSync(file)
    db.exec(`CREATE TABLE meta(key TEXT, value TEXT);
      INSERT INTO meta VALUES ('version', '24');
      CREATE TABLE cookies(host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
        path TEXT, is_secure INTEGER, has_expires INTEGER, expires_utc INTEGER)`)
    const ins = db.prepare("INSERT INTO cookies VALUES (?, ?, '', ?, '/', 1, ?, ?)")
    const enc = (host: string, v: string) =>
      encrypt(Buffer.concat([crypto.createHash("sha256").update(host).digest(), Buffer.from(v)]))
    ins.run(".campos.ch", "session", enc(".campos.ch", "s1"), 0, 0)
    ins.run(
      "web1.stage.campos.ch",
      "pref",
      enc("web1.stage.campos.ch", "p1"),
      1,
      chromeTime(Date.now() + 3600_000)
    )
    ins.run(".campos.ch", "old", enc(".campos.ch", "x"), 1, chromeTime(Date.now() - 3600_000))
    ins.run("other.ch", "nope", enc("other.ch", "y"), 0, 0)
    db.close()

    const cookies = readCookiesFromDb(file, "web1.stage.campos.ch", key)
    expect(cookies.map((c) => [c.name, c.value, c.domain, c.hostOnly]).sort()).toEqual([
      ["pref", "p1", "web1.stage.campos.ch", true],
      ["session", "s1", "campos.ch", false],
    ])
    expect(cookies.find((c) => c.name === "session")?.expires).toBeUndefined()
    expect(cookies.find((c) => c.name === "pref")?.expires).toBeGreaterThan(Date.now() / 1000)
  })
})
