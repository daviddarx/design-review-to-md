// @vitest-environment dr-happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parsePoint } from "../../model/markdown.ts"
import { Panel, type PanelProps } from "./Panel.tsx"

const SPEC = `# 5. Main navigation

📍 /concept-08-4/tickets — ![](05-main-navigation/5-pin.png)

- a. Icons are too small \`done\`
- b. Still too faint on hover, make it the brand blue at 100% \`open\`
  - Before: Active state is hard to see
  - Claude: 100% fails contrast on the hover fill, kept 80%
- c. Search field next to it is misaligned \`review\`
  📍 /concept-08-4/tickets — ![](05-main-navigation/5.c-pin.png)
- d. Compare with [5.d-reference.png](05-main-navigation/5.d-reference.png) \`open\`
  📎 [5.d-my shot.png](05-main-navigation/5.d-my%20shot.png)
`

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeEventSource {
  static last: FakeEventSource | null = null
  constructor() {
    FakeEventSource.last = this
  }
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  close() {}
}

type Call = { url: string; method: string; body: unknown }

let root: Root
let host: HTMLDivElement
let calls: Call[]
let opStatus: number
let topicStatus: number
// One-shot: the next request to a URL answers with this promise instead.
let held: Map<string, Promise<Response>>

function deferred() {
  let resolve!: (r: Response) => void
  const promise = new Promise<Response>((r) => (resolve = r))
  return { promise, resolve }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  calls = []
  opStatus = 200
  topicStatus = 200
  held = new Map()
  localStorage.clear()
  vi.stubGlobal("EventSource", FakeEventSource)
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const hold = held.get(url)
      if (hold) {
        held.delete(url)
        return hold
      }
      if (url === "/__review/api/topics") return json(["08.4"])
      if (url === "/__review/api/topics/08.4") {
        if (topicStatus !== 200) return json({ error: "cannot read topic" }, topicStatus)
        return json({ meta: { nextPoint: 6 }, points: [parsePoint(SPEC)] })
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

async function render(extra: Partial<PanelProps> = {}) {
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
        onHoverPin={() => {}}
        {...extra}
      />
    )
  })
}

const row = (id: string) => host.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!
const action = (id: string, label: string) =>
  row(id).querySelector<HTMLButtonElement>(`.dr-action[aria-label="${label}"]`)
const opCalls = () => calls.filter((c) => c.url.endsWith("/ops"))

function key(el: HTMLElement, k: string, extra: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }))
}

describe("Panel", () => {
  it("renders a row's attachment lines as links to the file", async () => {
    await render()
    const link = row("5.d").querySelector<HTMLAnchorElement>(".dr-files a")!
    expect(link.textContent).toBe("📎 5.d-my shot.png")
    expect(link.getAttribute("href")).toBe(
      "/__review/files/08.4/05-main-navigation/5.d-my%20shot.png"
    )
    expect(link.target).toBe("_blank")
  })

  it("lists the topic's rows with counts", async () => {
    await render()
    const ids = [...host.querySelectorAll("[data-row-id]")].map((el) =>
      el.getAttribute("data-row-id")
    )
    expect(ids).toEqual(["5", "5.a", "5.b", "5.c", "5.d"])
    expect(host.querySelector(".dr-filters")?.textContent).toBe(
      "All 4Open 2To review 1Done 1＋ New feedback"
    )
    expect(row("5.a").textContent).toContain("📍 from 5")
  })

  it("Validate on a row to review validates it, then refetches", async () => {
    await render()
    const before = calls.filter((c) => c.url === "/__review/api/topics/08.4").length
    await act(async () => action("5.c", "Validate")!.click())
    expect(opCalls()).toEqual([
      {
        url: "/__review/api/topics/08.4/points/5/ops",
        method: "POST",
        body: { op: { kind: "setStatus", rowId: "5.c", status: "done" }, assets: [] },
      },
    ])
    expect(calls.filter((c) => c.url === "/__review/api/topics/08.4").length).toBe(before + 1)
  })

  it("Refine opens the field; Enter sends one line", async () => {
    await render()
    await act(async () => action("5.c", "Refine")!.click())
    const field = row("5.c").querySelector("textarea")!
    expect(field.value).toContain("Search field")
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
      setter.call(field, "Align the\nsearch field")
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => key(field, "Enter"))
    expect(opCalls()[0].body).toEqual({
      op: { kind: "refine", rowId: "5.c", text: "Align the search field" },
      assets: [],
    })
  })

  it("only a row to review offers Validate and Refine; only a row with history offers History", async () => {
    await render()
    const labels = (id: string) =>
      [...row(id).querySelectorAll(".dr-action")].map((b) => b.getAttribute("aria-label"))
    expect(labels("5.a")).toEqual(["Go to pin", "Screenshot", "Restore state"])
    expect(labels("5.b")).toEqual(["History", "Go to pin", "Screenshot", "Restore state"])
    expect(labels("5.c")).toEqual([
      "Validate",
      "Refine",
      "Go to pin",
      "Screenshot",
      "Restore state",
    ])
  })

  it("letters typed on a row do nothing", async () => {
    await render()
    for (const k of ["v", "r", "h"]) await act(async () => key(row("5.c"), k))
    expect(opCalls()).toEqual([])
    expect(row("5.c").querySelector("textarea")).toBeNull()
  })

  it("History shows the history above the text", async () => {
    await render()
    await act(async () => action("5.b", "History")!.click())
    const history = row("5.b").querySelector(".dr-history")!
    expect(history.textContent).toContain("Before: Active state is hard to see")
    expect(history.nextElementSibling?.classList.contains("dr-row-text")).toBe(true)
  })

  it("an API error shows inline", async () => {
    await render()
    opStatus = 409
    await act(async () => action("5.c", "Validate")!.click())
    expect(host.querySelector(".dr-error")?.textContent).toContain("5.b is locked")
  })

  it("↓ moves focus to the next row", async () => {
    await render()
    row("5.a").focus()
    await act(async () => key(row("5.a"), "ArrowDown"))
    expect(document.activeElement).toBe(row("5.b"))
  })

  it("a busy row keeps its depth class and gains dr-busy", async () => {
    await render()
    const op = deferred()
    held.set("/__review/api/topics/08.4/points/5/ops", op.promise)
    await act(async () => action("5.c", "Validate")!.click())
    expect(row("5.c").classList.contains("dr-depth-1")).toBe(true)
    expect(row("5.c").classList.contains("dr-busy")).toBe(true)
    await act(async () => op.resolve(json({})))
    expect(row("5.c").classList.contains("dr-busy")).toBe(false)
  })

  it("a pin-record fetch overtaken by a reload does not refill the cache", async () => {
    await render()
    const record = deferred()
    held.set("/__review/files/08.4/05-main-navigation/5.c-pin.json", record.promise)
    await act(async () => row("5.c").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
    expect(calls.some((c) => c.url.endsWith("5.c-pin.json"))).toBe(true)
    await act(async () => FakeEventSource.last!.onmessage!({ data: '{"topic":"08.4"}' }))
    const source = { file: "src/x.tsx", line: 3 }
    const step = { element: { source } }
    await act(async () => record.resolve(json({ version: 1, at: "", steps: [step] })))
    expect(row("5.c").querySelector('[aria-label="Open in VS Code"]')).toBeNull()
  })

  it("a successful load clears an earlier load error", async () => {
    topicStatus = 500
    await render()
    expect(host.querySelector(".dr-error")?.textContent).toContain("cannot read topic")
    topicStatus = 200
    await act(async () => FakeEventSource.last!.onmessage!({ data: '{"topic":"08.4"}' }))
    expect(host.querySelector(".dr-error")).toBeNull()
  })

  it("Go to pin's notice shows inline and can be dismissed", async () => {
    const onGoToPin = vi.fn(async () => "Pinned element not found — the page changed since.")
    await render({ onGoToPin })
    const go = [...row("5.c").querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Go to pin"
    )!
    await act(async () => go.click())
    await act(async () => {})
    expect(onGoToPin).toHaveBeenCalledWith(
      "5.c",
      expect.objectContaining({ ownerRowId: "5.c", recordPath: "05-main-navigation/5.c-pin.json" })
    )
    const alert = host.querySelector(".dr-error")!
    expect(alert.textContent).toContain("Pinned element not found — the page changed since.")
    await act(async () => alert.querySelector("button")!.click())
    expect(host.querySelector(".dr-error")).toBeNull()
  })

  it("a successful Go to pin clears an earlier notice", async () => {
    const answers = ["Pinned element not found — the page changed since.", null]
    await render({ onGoToPin: async () => answers.shift() })
    const go = [...row("5.c").querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Go to pin"
    )!
    await act(async () => go.click())
    await act(async () => {})
    expect(host.querySelector(".dr-error")).not.toBeNull()
    await act(async () => go.click())
    await act(async () => {})
    expect(host.querySelector(".dr-error")).toBeNull()
  })

  it("the restore confirm takes Esc from anywhere inside", async () => {
    await render()
    const restore = [...row("5.c").querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Restore state"
    )!
    await act(async () => restore.click())
    const confirm = row("5.c").querySelector<HTMLElement>(".dr-confirm")!
    const primary = confirm.querySelector<HTMLElement>(".dr-button-primary")!
    await act(async () => key(primary, "Escape"))
    expect(row("5.c").querySelector(".dr-confirm")).toBeNull()
  })

  it("a narrow window shows a narrower panel but keeps the stored width", async () => {
    localStorage.setItem("design-review:panel-width", "600")
    const innerWidth = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 })
    try {
      await render()
      await act(async () => window.dispatchEvent(new Event("resize")))
      expect(host.querySelector<HTMLElement>(".dr-panel")!.style.width).toBe("350px")
      expect(localStorage.getItem("design-review:panel-width")).toBe("600")
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: innerWidth })
    }
  })

  it("a drag stores the new width", async () => {
    await render()
    const handle = host.querySelector<HTMLElement>(".dr-resize")!
    const pointer = (type: string, clientX: number) =>
      handle.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX })
      )
    await act(async () => {
      pointer("pointerdown", window.innerWidth - 400)
      pointer("pointermove", window.innerWidth - 500)
      pointer("pointerup", window.innerWidth - 500)
    })
    expect(localStorage.getItem("design-review:panel-width")).toBe("500")
  })
})
