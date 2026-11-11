import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fnv1a } from "../cli.ts"
import { parseFeedback, serializeFeedback } from "../../model/markdown.ts"
import type { Row } from "../../model/types.ts"

export const REMOTE_BASE = path.join(os.homedir(), "Desktop", "design-review-to-md")
export const REMOTE_PORT_BASE = 4900
export const REMOTE_PORTS = 800

// Host (lowercased) + path, no query/hash/trailing slash; anything outside
// [A-Za-z0-9.-] becomes _.
export function urlKey(url: string): string {
  const u = new URL(url)
  const raw = u.hostname.toLowerCase() + u.pathname.replace(/\/+$/, "")
  return raw.replace(/[^A-Za-z0-9.-]/g, "_")
}

export function remotePort(key: string): number {
  return REMOTE_PORT_BASE + (fnv1a(key) % REMOTE_PORTS)
}

export function roundName(key: string, n: number): string {
  return `${key}-${n}`
}

export async function latestRound(base: string, key: string): Promise<number | null> {
  let names: string[]
  try {
    names = await fs.readdir(base)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`)
  let latest: number | null = null
  for (const name of names) {
    const m = re.exec(name)
    if (m && (latest === null || Number(m[1]) > latest)) latest = Number(m[1])
  }
  return latest
}

export function isFinalized(base: string, round: string): boolean {
  return existsSync(path.join(base, round, "index.html"))
}

function reopen(rows: Row[]) {
  for (const row of rows) {
    if (row.status === "open") row.status = "review"
    reopen(row.children)
  }
}

// The next round starts from the last one with every open tag at `review`:
// the new round's own work is what he opens next.
export async function startNextRound(base: string, key: string, from: number): Promise<string> {
  const src = roundName(key, from)
  const next = roundName(key, from + 1)
  await fs.mkdir(path.join(base, next), { recursive: true })
  const entries = await fs.readdir(path.join(base, src), { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory() || !/^\d+-/.test(e.name)) continue
    const dest = path.join(base, next, e.name)
    await fs.cp(path.join(base, src, e.name), dest, { recursive: true })
    const briefing = path.join(dest, "briefing.md")
    if (!existsSync(briefing)) continue
    const feedback = parseFeedback(await fs.readFile(briefing, "utf8"))
    if (feedback.status === "open") feedback.status = "review"
    reopen(feedback.rows)
    await fs.writeFile(briefing, serializeFeedback(feedback))
  }
  const state = path.join(base, ".state", src)
  if (existsSync(state)) {
    await fs.cp(state, path.join(base, ".state", next), { recursive: true })
  }
  return next
}

export async function chooseRound(
  base: string,
  key: string,
  ask: (q: string) => Promise<string>
): Promise<string> {
  const latest = await latestRound(base, key)
  if (latest === null) {
    const first = roundName(key, 0)
    await fs.mkdir(path.join(base, first), { recursive: true })
    return first
  }
  const name = roundName(key, latest)
  if (!isFinalized(base, name)) return name
  const answer = await ask(`Continue round ${latest} or start round ${latest + 1}? [C/n] `)
  return answer.trim().toLowerCase() === "n" ? startNextRound(base, key, latest) : name
}
