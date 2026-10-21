// @vitest-environment dr-happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parsePoint } from "../../model/markdown.ts"
import { PointDrawer } from "./PointDrawer.tsx"

const SPEC = `# 5. Main navigation

- a. Icons are too small \`done\`
- b. Search field is misaligned \`open\`
`

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Call = { url: string; method: string; body: unknown }

let root: Root
let host: HTMLDivElement
let calls: Call[]

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url === "/__review/api/topics/08.4" && method === "GET") {
        return json({ meta: { nextPoint: 6, retired: [] }, points: [parsePoint(SPEC)] })
      }
      return json({ number: 6, rowIds: [] })
    })
  )
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

async function render(pointNumber?: number) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  await act(async () => {
    root.render(
      <PointDrawer topic="08.4" pointNumber={pointNumber} onClose={onClose} onSaved={onSaved} />
    )
  })
  return { onClose, onSaved }
}

const fields = () => [...host.querySelectorAll("textarea")]
const posts = () => calls.filter((c) => c.method === "POST")

function key(el: Element, k: string, extra: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }))
}

async function type(field: HTMLTextAreaElement, text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
    setter.call(field, text)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("PointDrawer", () => {
  it("writes a point with the outliner keys and saves on ⌘Enter", async () => {
    const { onClose, onSaved } = await render()
    await type(fields()[0], "Main nav")
    await act(async () => key(fields()[0], "Enter"))
    await type(fields()[1], "Icons")
    await act(async () => key(fields()[1], "Enter"))
    await type(fields()[2], "too small")
    await act(async () => key(fields()[2], "Tab"))
    expect(host.querySelectorAll(".dr-depth-2")).toHaveLength(1)
    await act(async () => key(fields()[2], "Enter", { metaKey: true }))
    expect(posts()).toEqual([
      {
        url: "/__review/api/topics/08.4/points",
        method: "POST",
        body: {
          title: "Main nav",
          rows: [{ text: "Icons", children: [{ text: "too small", children: [] }] }],
          assets: [],
        },
      },
    ])
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("Esc on a draft with content asks inline before discarding", async () => {
    const { onClose } = await render()
    await act(async () => key(fields()[0], "Escape"))
    expect(onClose).toHaveBeenCalledTimes(1) // empty: closes at once
    onClose.mockClear()
    await type(fields()[0], "Something")
    await act(async () => key(fields()[0], "Escape"))
    expect(onClose).not.toHaveBeenCalled()
    expect(host.textContent).toContain("Discard draft?")
    const discard = [...host.querySelectorAll("button")].find((b) => b.textContent === "Discard")!
    await act(async () => discard.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("edits a saved point: open rows editable, touched rows read-only, new rows added", async () => {
    await render(5)
    // title + 5.b are editable; 5.a is done
    expect(fields().map((f) => f.value)).toEqual(["Main navigation", "Search field is misaligned"])
    expect(host.textContent).toContain("use Refine in the list")
    await type(fields()[1], "Search field is off")
    await act(async () => key(fields()[1], "Enter"))
    await type(fields()[2], "also on hover")
    await act(async () => key(fields()[2], "Enter", { metaKey: true }))
    expect(posts().map((c) => c.body)).toEqual([
      { op: { kind: "editText", rowId: "5.b", text: "Search field is off" }, assets: [] },
      {
        op: { kind: "addChild", rowId: "5", row: { text: "also on hover", children: [] } },
        assets: [],
      },
    ])
  })

  it("hides the pin action without a picker", async () => {
    await render()
    expect(host.textContent).not.toContain("📍")
  })
})
