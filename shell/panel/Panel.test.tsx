// @vitest-environment dr-happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parsePoint } from "../../model/markdown.ts"
import { Panel } from "./Panel.tsx"

const SPEC = `# 5. Main navigation

📍 /concept-08-4/tickets — ![](05-main-navigation/5-pin.png)

- a. Icons are too small \`done\`
- b. Still too faint on hover, make it the brand blue at 100% \`open\`
  - Before: Active state is hard to see
  - Claude: 100% fails contrast on the hover fill, kept 80%
- c. Search field next to it is misaligned \`review\`
  📍 /concept-08-4/tickets — ![](05-main-navigation/5.c-pin.png)
- d. Compare with [5.d-reference.png](05-main-navigation/5.d-reference.png) \`open\`
`

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeEventSource {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  close() {}
}

type Call = { url: string; method: string; body: unknown }

let root: Root
let host: HTMLDivElement
let calls: Call[]
let opStatus: number

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  calls = []
  opStatus = 200
  vi.stubGlobal("EventSource", FakeEventSource)
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url === "/__review/api/topics") return json(["08.4"])
      if (url === "/__review/api/topics/08.4") {
        return json({ meta: { nextPoint: 6, retired: [] }, points: [parsePoint(SPEC)] })
      }
      if (url.endsWith("/ops")) {
        return opStatus === 200 ? json({}) : json({ error: "5.b is locked" }, opStatus)
      }
      return json({}, 404)
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

async function render() {
  const onOpenCountChange = vi.fn()
  await act(async () => {
    root.render(
      <Panel
        topic="08.4"
        onTopicChange={() => {}}
        onNewPoint={() => {}}
        onEditPoint={() => {}}
        onGoToPin={() => {}}
        onRestoreState={() => {}}
        onOpenSource={() => {}}
        onOpenCountChange={onOpenCountChange}
      />
    )
  })
  return { onOpenCountChange }
}

const row = (id: string) => host.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!
const opCalls = () => calls.filter((c) => c.url.endsWith("/ops"))

function key(el: HTMLElement, k: string, extra: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }))
}

describe("Panel", () => {
  it("lists the topic's rows with counts and reports the open count", async () => {
    const { onOpenCountChange } = await render()
    const ids = [...host.querySelectorAll("[data-row-id]")].map((el) =>
      el.getAttribute("data-row-id")
    )
    expect(ids).toEqual(["5", "5.a", "5.b", "5.c", "5.d"])
    expect(host.querySelector(".dr-filters")?.textContent).toBe("All 4Open 2To review 1Done 1")
    expect(row("5.a").textContent).toContain("📍 from 5")
    expect(onOpenCountChange).toHaveBeenLastCalledWith(2)
  })

  it("V on a focused row validates it, then refetches", async () => {
    await render()
    const before = calls.filter((c) => c.url === "/__review/api/topics/08.4").length
    await act(async () => key(row("5.b"), "v"))
    expect(opCalls()).toEqual([
      {
        url: "/__review/api/topics/08.4/points/5/ops",
        method: "POST",
        body: { op: { kind: "setStatus", rowId: "5.b", status: "done" }, assets: [] },
      },
    ])
    expect(calls.filter((c) => c.url === "/__review/api/topics/08.4").length).toBe(before + 1)
  })

  it("R opens the refine field; Enter sends one line", async () => {
    await render()
    await act(async () => key(row("5.d"), "r"))
    const field = row("5.d").querySelector("textarea")!
    expect(field.value).toContain("Compare with")
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(field, "Use the\nreference")
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => key(field, "Enter"))
    expect(opCalls()[0].body).toEqual({
      op: { kind: "refine", rowId: "5.d", text: "Use the reference" },
      assets: [],
    })
  })

  it("keys typed inside a field do not act on the row", async () => {
    await render()
    await act(async () => key(row("5.d"), "r"))
    await act(async () => key(row("5.d").querySelector("textarea")!, "v"))
    expect(opCalls()).toEqual([])
  })

  it("H shows the history above the text", async () => {
    await render()
    await act(async () => key(row("5.b"), "h"))
    const history = row("5.b").querySelector(".dr-history")!
    expect(history.textContent).toContain("Before: Active state is hard to see")
    expect(row("5.b").firstElementChild).toBe(history)
  })

  it("an API error shows inline", async () => {
    await render()
    opStatus = 409
    await act(async () => key(row("5.b"), "v"))
    expect(host.querySelector(".dr-error")?.textContent).toContain("5.b is locked")
  })

  it("↓ moves focus to the next row", async () => {
    await render()
    row("5.a").focus()
    await act(async () => key(row("5.a"), "ArrowDown"))
    expect(document.activeElement).toBe(row("5.b"))
  })
})
