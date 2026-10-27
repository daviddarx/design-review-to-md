// A source map that names only a file's basename (Vite's inline maps do for a
// workspace-linked package: `Button.tsx`) gives the agent nothing to open.
// The app's repo is searched for that name instead.
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const run = promisify(execFile)

// Never the app's own source, even when committed.
const SKIP_DIRS = new Set(["node_modules", "dist", "storybook-static", ".git"])

const skipped = (relative: string) => relative.split("/").some((part) => SKIP_DIRS.has(part))

// `name` as the source map gave it: one path segment, no directory.
export function isBareName(name: string): boolean {
  return (
    name.length > 0 && name.length <= 255 && !/[/\\\0]/.test(name) && name !== "." && name !== ".."
  )
}

// Every file of a checkout git does not ignore, tracked or not, relative to
// `root` (which may be a folder inside the checkout).
async function gitFiles(root: string): Promise<string[]> {
  const { stdout } = await run(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, maxBuffer: 256 * 1024 * 1024 }
  )
  return stdout.split("\0").filter(Boolean)
}

// Outside git there is no ignore file to honour: only SKIP_DIRS are left out.
async function walkFiles(root: string, name: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    let entries
    try {
      entries = await fs.readdir(path.join(root, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) await walk(rel)
      else if (e.isFile() && e.name === name) out.push(rel)
    }
  }
  await walk("")
  return out
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile()
  } catch {
    return false
  }
}

// Repo-relative paths of every file called `name`, sorted.
async function findByName(root: string, name: string): Promise<string[]> {
  let found: string[]
  try {
    found = (await gitFiles(root)).filter((f) => path.posix.basename(f) === name)
  } catch {
    found = await walkFiles(root, name)
  }
  const kept = found.filter((f) => !skipped(f))
  // `--cached` still lists a tracked file deleted from the working tree.
  const present = await Promise.all(kept.map((f) => exists(path.join(root, f))))
  return kept.filter((_, i) => present[i]).sort()
}

export type ResolvedSource = { file: string; candidates?: string[] }

// The pin's `file` for a bare `name`: the one match's repo-relative path; or
// with several, the one whose path the script URL ends in (Vite serves a
// module at `/@fs/<absolute path>` or at its path under its root), else the
// name with every match as `candidates`; with none, the name. One search
// per name for the life of the server.
export function createSourceResolver(root: string) {
  const cache = new Map<string, Promise<string[]>>()
  return async function resolve(name: string, from?: string): Promise<ResolvedSource> {
    let search = cache.get(name)
    if (!search) {
      search = findByName(root, name)
      cache.set(name, search)
      search.catch(() => cache.delete(name))
    }
    const matches = await search
    if (matches.length === 1) return { file: matches[0] }
    if (!matches.length) return { file: name }
    const script = scriptPath(from)
    const named = script ? matches.filter((m) => script.endsWith(`/${m}`)) : []
    if (named.length === 1) return { file: named[0] }
    return { file: name, candidates: matches }
  }
}

function scriptPath(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return decodeURIComponent(new URL(url).pathname)
  } catch {
    return undefined
  }
}
