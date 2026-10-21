import { readFileSync } from "node:fs"
import path from "node:path"
import { SourceMapGenerator } from "source-map-js"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearSourceCache,
  debugStacks,
  mapUrlOf,
  repoRelative,
  sourceFromStack,
  sourceOf,
  stackFrames,
} from "./sourceLookup.ts"

const ROOT = "/Users/me/repo"

describe("stackFrames", () => {
  it("reads V8 and Gecko frames", () => {
    const stack = [
      "Error: react-stack-top-frame",
      "    at exports.jsxDEV (http://h:1/_next/static/chunks/node_modules_x.js:10:5)",
      "    at NavBar (http://h:1/_next/static/chunks/src_c084_shell.js:120:42)",
      "    at http://h:1/a.js?v=1:3:4",
      "NavBar@http://h:1/b.js:7:8",
    ].join("\n")
    expect(stackFrames(stack)).toEqual([
      { url: "http://h:1/_next/static/chunks/node_modules_x.js", line: 10, column: 5 },
      { url: "http://h:1/_next/static/chunks/src_c084_shell.js", line: 120, column: 42 },
      { url: "http://h:1/a.js?v=1", line: 3, column: 4 },
      { url: "http://h:1/b.js", line: 7, column: 8 },
    ])
  })
})

describe("repoRelative", () => {
  it("strips the bundler's prefix", () => {
    expect(repoRelative(`file://${ROOT}/src/c084/shell/NavBar.tsx`, ROOT)).toBe(
      "src/c084/shell/NavBar.tsx"
    )
    expect(repoRelative("turbopack:///[project]/src/a.tsx", null)).toBe("src/a.tsx")
    expect(repoRelative("webpack://_N_E/./src/a.tsx?abc", null)).toBe("src/a.tsx")
  })

  it("refuses anything outside the repo's own code", () => {
    expect(repoRelative(`file://${ROOT}/node_modules/react/index.js`, ROOT)).toBeUndefined()
    expect(repoRelative("file:///elsewhere/a.tsx", ROOT)).toBeUndefined()
    expect(repoRelative(`file://${ROOT}/src/a.tsx`, null)).toBeUndefined()
    expect(repoRelative("webpack://_N_E/../x.ts", null)).toBeUndefined()
  })
})

describe("mapUrlOf", () => {
  it("resolves the last sourceMappingURL, or falls back to .map", () => {
    const url = "http://h/_next/static/chunks/a.js"
    expect(mapUrlOf(url, "x\n//# sourceMappingURL=a.js.map")).toBe(`${url}.map`)
    expect(mapUrlOf(url, "x\n//# sourceMappingURL=../m/b.map")).toBe(
      "http://h/_next/static/m/b.map"
    )
    expect(mapUrlOf(url, "x")).toBe(`${url}.map`)
  })
})

describe("sourceFromStack", () => {
  it("maps the first app frame, skipping vendor scripts and node_modules sources", async () => {
    const gen = new SourceMapGenerator({ file: "app.js" })
    gen.addMapping({
      generated: { line: 5, column: 10 },
      original: { line: 1, column: 0 },
      source: `file://${ROOT}/node_modules/lib/x.js`,
    })
    gen.addMapping({
      generated: { line: 9, column: 3 },
      original: { line: 42, column: 4 },
      source: `file://${ROOT}/src/Nav.tsx`,
    })
    const files: Record<string, string> = {
      "http://h/app.js": "code\n//# sourceMappingURL=app.js.map",
      "http://h/app.js.map": gen.toString(),
    }
    const fetched: string[] = []
    const fetchText = async (url: string) => {
      fetched.push(url)
      return files[url] ?? null
    }
    const stack = [
      "Error: react-stack-top-frame",
      "    at jsxDEV (http://h/node_modules_react.js:1:1)",
      "    at lib (http://h/app.js:5:11)",
      "    at Nav (http://h/app.js:9:4)",
    ].join("\n")
    expect(await sourceFromStack(stack, fetchText, ROOT)).toEqual({ file: "src/Nav.tsx", line: 42 })
    expect(fetched).not.toContain("http://h/node_modules_react.js")
  })

  it("answers undefined when nothing maps", async () => {
    const stack = "Error\n    at X (http://h/missing.js:1:1)"
    expect(await sourceFromStack(stack, async () => null, ROOT)).toBeUndefined()
  })
})

function mapTo(line: number, file = "src/Nav.tsx") {
  const gen = new SourceMapGenerator({ file: "app.js" })
  gen.addMapping({
    generated: { line: 9, column: 3 },
    original: { line, column: 0 },
    source: `file://${ROOT}/${file}`,
  })
  return gen.toString()
}

describe("map cache", () => {
  const stack = "Error\n    at Nav (http://h/fresh.js?v=1:9:4)"
  const serve = (map: () => string) => {
    let fetches = 0
    const fetchText = async (url: string) => {
      fetches++
      if (url === "http://h/fresh.js?v=1") return "code\n//# sourceMappingURL=fresh.js.map"
      return url === "http://h/fresh.js.map" ? map() : null
    }
    return { fetchText, count: () => fetches }
  }

  it("reuses a map within a pick, and refetches it after a clear", async () => {
    clearSourceCache()
    let line = 10
    const { fetchText, count } = serve(() => mapTo(line))
    expect(await sourceFromStack(stack, fetchText, ROOT)).toEqual({ file: "src/Nav.tsx", line: 10 })
    line = 20 // the app was edited and reloaded; the URL did not change
    expect(await sourceFromStack(stack, fetchText, ROOT)).toEqual({ file: "src/Nav.tsx", line: 10 })
    expect(count()).toBe(2)
    clearSourceCache()
    expect(await sourceFromStack(stack, fetchText, ROOT)).toEqual({ file: "src/Nav.tsx", line: 20 })
  })

  it("keys by the full URL, query included", async () => {
    clearSourceCache()
    const { fetchText } = serve(() => mapTo(10))
    await sourceFromStack(stack, fetchText, ROOT)
    const other = vi.fn(async () => null)
    const v2 = "Error\n    at Nav (http://h/fresh.js?v=2:9:4)"
    expect(await sourceFromStack(v2, other, ROOT)).toBeUndefined()
    expect(other).toHaveBeenCalledWith("http://h/fresh.js?v=2")
  })
})

type FakeFiber = { _debugStack?: unknown; return?: FakeFiber | null }
const fakeElement = (fiber: FakeFiber) =>
  ({ __reactFiber$abc123: fiber, other: 1 }) as unknown as Element
const err = (stack: string) => Object.assign(new Error("x"), { stack })

describe("debugStacks", () => {
  it("reads the host fiber first, then ancestors, skipping repeats and non-errors", () => {
    const root: FakeFiber = { _debugStack: err("root") }
    const mid: FakeFiber = { _debugStack: err("host"), return: root } // same stack again
    const plain: FakeFiber = { _debugStack: "not an error", return: mid }
    const host: FakeFiber = { _debugStack: err("host"), return: plain }
    expect(debugStacks(fakeElement(host))).toEqual(["host", "root"])
  })

  it("answers nothing outside React", () => {
    expect(debugStacks({} as Element)).toEqual([])
  })

  it("stops after a bounded number of ancestors", () => {
    let fiber: FakeFiber | null = null
    for (let i = 0; i < 200; i++) fiber = { _debugStack: err(`s${i}`), return: fiber }
    expect(debugStacks(fakeElement(fiber!))).toHaveLength(60)
  })
})

describe("sourceOf", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("gives up within its bound when the network hangs", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", () => new Promise(() => {}))
    const el = fakeElement({ _debugStack: err("Error\n    at X (http://h/app.js:1:1)") })
    let result: unknown = "pending"
    void sourceOf(el, 1500).then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(1499)
    expect(result).toBe("pending")
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBeUndefined()
  })

  it("never throws", async () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("boom")
        },
      }
    ) as Element
    await expect(sourceOf(hostile, 50)).resolves.toBeUndefined()
  })
})

// The spike's verification against a live dev server (no browser): set
// DR_DEV_URL to the app's own port (not the review proxy), e.g.
//   DR_DEV_URL=http://localhost:15807 npm run test:review
// For one JSX call in each of five concept 08.4 components, it builds the
// stack V8 would record for that call (its column is the call's opening
// paren) and checks that the lookup lands on the line of that very tag.
const DEV_URL = process.env.DR_DEV_URL
const REPO = path.resolve(import.meta.dirname, "../../../..")

type Target = { what: string; file: string; fn: string; nth: number }
const TARGETS: Target[] = [
  { what: "nav button", file: "src/c084/shell/NavBar.tsx", fn: "NavBar", nth: 3 },
  { what: "list row", file: "src/c084/components/EntryTable.tsx", fn: "EntryTable", nth: 4 },
  { what: "drawer field", file: "src/c084/components/Entry.tsx", fn: "Entry", nth: 6 },
  { what: "header control", file: "src/c084/shell/AppHeader.tsx", fn: "AppHeader", nth: 2 },
  { what: "plan element", file: "src/c084/plan/FloorPlan.tsx", fn: "FloorPlan", nth: 2 },
]

const JSX_CALL = '["jsxDEV"])('

// The tag a jsxDEV call creates, as written in the source: "div" or Button.
function tagOf(args: string): string | undefined {
  const lit = /^"([\w.-]+)"/.exec(args)
  if (lit) return lit[1]
  const imported = /^[\w$]+\["(\w+)"\]/.exec(args)
  if (imported) return imported[1]
  const local = /^([\w$.]+)/.exec(args)
  return local?.[1]
}

describe.skipIf(!DEV_URL)("live dev server", () => {
  const results: string[] = []

  it("maps a JSX call in five components to its own line", { timeout: 120_000 }, async () => {
    const html = await (
      await fetch(`${DEV_URL}/concept-08-4`, { headers: { "sec-fetch-dest": "document" } })
    ).text()
    const urls = [...new Set(html.match(/\/_next\/static\/chunks\/[^"']+?\.js/g) ?? [])]
    const chunks = await Promise.all(
      urls.map(async (u) => ({ url: DEV_URL + u, text: await (await fetch(DEV_URL + u)).text() }))
    )
    const fetchText = async (url: string) => {
      const res = await fetch(url)
      return res.ok ? res.text() : null
    }

    let hits = 0
    for (const t of TARGETS) {
      // The module's definition, not a reference to it from another chunk.
      const header = `"[project]/${t.file} [app-client] (ecmascript)", ((__turbopack_context__)`
      const chunk = chunks.find((c) => c.text.includes(header))
      const start = chunk ? chunk.text.indexOf(header) : -1
      const end = chunk ? chunk.text.indexOf('\n"[project]/', start + 1) : -1
      const body = chunk ? chunk.text.slice(0, end < 0 ? undefined : end) : ""
      let at = body.indexOf(`function ${t.fn}(`, start)
      for (let i = 0; at >= 0 && i < t.nth; i++) at = body.indexOf(JSX_CALL, at + 1)
      if (!chunk || at < 0) {
        results.push(`MISS ${t.what}: ${t.file} — component not found in the page's chunks`)
        continue
      }
      const paren = at + JSX_CALL.length - 1
      const before = chunk.text.slice(0, paren)
      const line = before.split("\n").length
      const column = paren - before.lastIndexOf("\n") // 1-based, as V8 reports
      const tag = tagOf(chunk.text.slice(paren + 1, paren + 400))
      const stack = [
        "Error: react-stack-top-frame",
        `    at exports.jsxDEV (${DEV_URL}/_next/static/chunks/node_modules_next_dist_compiled_x.js:1:1)`,
        `    at ${t.fn} (${chunk.url}:${line}:${column})`,
      ].join("\n")
      const found = await sourceFromStack(stack, fetchText, REPO)
      const text = found ? readFileSync(path.join(REPO, found.file), "utf8").split("\n") : []
      const srcLine = found ? (text[found.line - 1] ?? "") : ""
      const ok = Boolean(found && found.file === t.file && tag && srcLine.includes(`<${tag}`))
      if (ok) hits++
      results.push(
        `${ok ? "OK  " : "MISS"} ${t.what}: <${tag}> in ${t.fn} → ` +
          (found ? `${found.file}:${found.line}  ${srcLine.trim().slice(0, 70)}` : "nothing")
      )
    }
    console.log(results.join("\n"))
    expect(hits).toBeGreaterThanOrEqual(4)
  })
})
