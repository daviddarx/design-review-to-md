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
let topicStatus: number
let postStatus: number

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  calls = []
  topicStatus = 200
  postStatus = 200
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url === "/__review/api/topics/08.4" && method === "GET") {
        if (topicStatus !== 200) return json({ error: "cannot read" }, topicStatus)
        return json({ meta: { nextPoint: 6 }, points: [parsePoint(SPEC)] })
      }
      if (postStatus !== 200) return json({ error: "disk full" }, postStatus)
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

  it("deletes saved feedback after an inline confirm, then closes", async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal("confirm", confirm)
    const { onClose, onSaved } = await render(5)
    const trash = () =>
      host.querySelector<HTMLButtonElement>('button[aria-label^="Delete this feedback"]')!
    const button = (label: string) =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === label)!
    const deletes = () => calls.filter((c) => c.method === "DELETE")

    await act(async () => trash().click())
    expect(host.textContent).toContain("Delete feedback 5? Its files go too.")
    await act(async () => button("Keep").click())
    expect(host.querySelector('[aria-label="Delete feedback?"]')).toBeNull()
    expect(deletes()).toEqual([])

    await act(async () => trash().click())
    await act(async () => button("Delete").click())
    expect(deletes().map((c) => c.url)).toEqual(["/__review/api/topics/08.4/points/5"])
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it("offers no point delete on a new point", async () => {
    await render()
    expect(host.querySelector('button[aria-label^="Delete this feedback"]')).toBeNull()
  })

  it("ignores Enter, Esc and ⌘Enter while an IME composes (Safari: keyCode 229)", async () => {
    const { onClose } = await render()
    await type(fields()[0], "日本")
    await act(async () => key(fields()[0], "Enter", { keyCode: 229 } as KeyboardEventInit))
    await act(async () => key(fields()[0], "Escape", { keyCode: 229 } as KeyboardEventInit))
    await act(async () =>
      key(fields()[0], "Enter", { metaKey: true, keyCode: 229 } as KeyboardEventInit)
    )
    expect(fields()).toHaveLength(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(posts()).toEqual([])
  })

  it("returns focus to the row after Keep editing and after a failed save", async () => {
    await render()
    await type(fields()[0], "Title")
    await act(async () => key(fields()[0], "Enter"))
    await type(fields()[1], "row")
    await act(async () => key(fields()[1], "Escape"))
    const keep = [...host.querySelectorAll("button")].find((b) => b.textContent === "Keep editing")!
    await act(async () => keep.click())
    expect(document.activeElement).toBe(fields()[1])
    postStatus = 500
    await act(async () => key(fields()[1], "Enter", { metaKey: true }))
    expect(host.textContent).toContain("disk full")
    expect(document.activeElement).toBe(fields()[1])
  })

  it("focuses the first editable row when an existing point opens", async () => {
    await render(5)
    expect(document.activeElement).toBe(fields()[0])
  })

  it("never saves when the point to edit could not be loaded", async () => {
    topicStatus = 500
    await render(5)
    const save = [...host.querySelectorAll("button")].find((b) => b.textContent === "Save")!
    expect(save.disabled).toBe(true)
    expect(fields()).toHaveLength(0)
    await act(async () =>
      host
        .querySelector("section")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }))
    )
    expect(posts()).toEqual([])
    expect(document.activeElement).toBe(host.querySelector("section"))
  })

  it("refuses attachments named like pin assets", async () => {
    await render()
    const input = host.querySelector<HTMLInputElement>("input[type=file]")!
    const files = [
      new File(["x"], "pin.png"),
      new File(["z"], "State.JSON"),
      new File(["y"], "ok.txt"),
    ]
    Object.defineProperty(input, "files", { value: files, configurable: true })
    const attach = [...host.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.includes("Attach")
    )!
    await act(async () => attach.click())
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }))
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(host.textContent).toContain("pin.png, State.JSON: this name is kept for pins")
    expect([...host.querySelectorAll(".dr-file")].map((f) => f.textContent)).toEqual(["📎 ok.txt×"])
  })

  it("hides the pin action without a picker", async () => {
    await render()
    expect(host.textContent).not.toContain("📍")
  })
})
