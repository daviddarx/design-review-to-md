// Open in VS Code: where in the repo a picked element was written.
//
// React-only, no framework endpoints. In a React 19 dev build every fiber
// keeps the `_debugStack` (an Error) taken when its element was created, so
// the host fiber's stack points at the line holding that `<div>` / `<Button>`.
// Its first frame outside React and node_modules is mapped back through the
// served script's own source map — plain HTTP, the way any bundler serves it.
import { SourceMapConsumer } from "source-map-js"
import { repoRoot } from "../api.ts"

export type Source = { file: string; line: number }
export type Frame = { url: string; line: number; column: number }
export type FetchText = (url: string) => Promise<string | null>

const LOOKUP_MS = 1500
const MAX_ANCESTORS = 60
const MAX_MAPS = 50

// Script URLs that are never the app's own code (skipped unfetched).
// Assumes flattened chunk names that carry the module path, as Turbopack's
// dev chunks do (`node_modules_next_dist_…js`); a bundler that names chunks
// by hash alone is still correct, as node_modules sources are refused after
// mapping — it only fetches more.
const VENDOR_URL = /node_modules|\/react-dom|\/react\/|next\/dist|turbopack-|%5Bturbopack%5D/

// "at Name (url:1:2)", "at url:1:2" (V8) and "Name@url:1:2" (Gecko).
const FRAME = /(https?:\/\/[^\s()]+?):(\d+):(\d+)\)?\s*$/

export function stackFrames(stack: string): Frame[] {
  const frames: Frame[] = []
  for (const line of stack.split("\n")) {
    const m = FRAME.exec(line.trim())
    if (m) frames.push({ url: m[1], line: Number(m[2]), column: Number(m[3]) })
  }
  return frames
}

// A source map's `sources` entry as a repo-relative path, or undefined when
// it is not the repo's own file.
export function repoRelative(source: string, root: string | null): string | undefined {
  let s = source
  const project = s.indexOf("[project]/")
  if (project >= 0) s = s.slice(project + "[project]/".length)
  else if (s.startsWith("file://")) {
    try {
      s = decodeURIComponent(new URL(s).pathname)
    } catch {
      return undefined
    }
    if (!root) return undefined
    const prefix = root.replace(/\/+$/, "") + "/"
    if (!s.startsWith(prefix)) return undefined
    s = s.slice(prefix.length)
  } else {
    s = s.replace(/^webpack:\/\/[^/]*\//, "").replace(/^\.\//, "")
  }
  s = s.replace(/[?#].*$/, "")
  if (!s || s.startsWith("/") || s.split("/").includes("..")) return undefined
  if (s.split("/").includes("node_modules")) return undefined
  return s
}

// The source map URL a script names last, or `<url>.map`.
export function mapUrlOf(scriptUrl: string, script: string): string {
  const all = [...script.matchAll(/\/\/[#@] sourceMappingURL=(\S+)/g)]
  const named = all.at(-1)?.[1]
  return named ? new URL(named, scriptUrl).href : `${scriptUrl}.map`
}

// Dev chunk URLs are not content-hashed and the shell outlives every app
// reload and HMR update, so a map is only trusted for one pick: the picker
// clears this cache at the start of each. Keyed by the full URL (a query may
// be the only thing that changes).
const consumers = new Map<string, Promise<SourceMapConsumer | null>>()

export function clearSourceCache() {
  consumers.clear()
}

function consumerFor(url: string, fetchText: FetchText): Promise<SourceMapConsumer | null> {
  const key = url
  let found = consumers.get(key)
  if (!found) {
    if (consumers.size >= MAX_MAPS) consumers.clear()
    found = (async () => {
      const script = await fetchText(url)
      if (script === null) return null
      const raw = await fetchText(mapUrlOf(url, script))
      if (raw === null) return null
      try {
        // Index maps (`sections`, as Turbopack serves) are handled too.
        return new SourceMapConsumer(JSON.parse(raw))
      } catch {
        return null
      }
    })()
    consumers.set(key, found)
    // A failure is not remembered: the next pick tries again.
    found.then(
      (c) => c ?? consumers.delete(key),
      () => consumers.delete(key)
    )
  }
  return found
}

// The first frame of `stack` that maps into the repo's own code.
export async function sourceFromStack(
  stack: string,
  fetchText: FetchText,
  root: string | null
): Promise<Source | undefined> {
  for (const frame of stackFrames(stack)) {
    if (VENDOR_URL.test(frame.url)) continue
    const consumer = await consumerFor(frame.url, fetchText)
    if (!consumer) continue
    // Stack columns are 1-based, source map columns 0-based.
    const pos = consumer.originalPositionFor({ line: frame.line, column: frame.column - 1 })
    if (!pos.source || !pos.line) continue
    const file = repoRelative(pos.source, root)
    if (file) return { file, line: pos.line }
  }
  return undefined
}

type Fiber = { _debugStack?: unknown; return?: Fiber | null }

// The element's own fiber, then its ancestors: every `_debugStack` on the
// way up, nearest first.
export function debugStacks(el: Element): string[] {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
  if (!key) return []
  const stacks: string[] = []
  let fiber = (el as unknown as Record<string, Fiber | undefined>)[key]
  for (let i = 0; fiber && i < MAX_ANCESTORS; i++) {
    const s = fiber._debugStack
    const text = s && typeof (s as Error).stack === "string" ? (s as Error).stack : undefined
    if (text && !stacks.includes(text)) stacks.push(text)
    fiber = fiber.return ?? undefined
  }
  return stacks
}

const fetchText: FetchText = async (url) => {
  try {
    const res = await fetch(url)
    return res.ok ? await res.text() : null
  } catch {
    return null
  }
}

let rootPromise: Promise<string | null> | null = null
function root(): Promise<string | null> {
  rootPromise ??= repoRoot().then(
    (r) => r.root,
    () => {
      rootPromise = null
      return null
    }
  )
  return rootPromise
}

async function lookup(el: Element): Promise<Source | undefined> {
  const stacks = debugStacks(el)
  if (!stacks.length) return undefined
  const r = await root()
  for (const stack of stacks) {
    const found = await sourceFromStack(stack, fetchText, r)
    if (found) return found
  }
  return undefined
}

// Never throws, and gives up after `timeoutMs` (a pin never waits longer).
export function sourceOf(el: Element, timeoutMs = LOOKUP_MS): Promise<Source | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs)
    lookup(el).then(
      (s) => {
        clearTimeout(timer)
        resolve(s)
      },
      () => {
        clearTimeout(timer)
        resolve(undefined)
      }
    )
  })
}
