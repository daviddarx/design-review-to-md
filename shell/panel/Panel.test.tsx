// @vitest-environment dr-happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseFeedback } from "../../model/markdown.ts"
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
let reviewStatus: number
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
  reviewStatus = 200
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
      if (url === "/__review/api/reviews") return json(["08.4"])
      if (url === "/__review/api/reviews/08.4") {
        if (reviewStatus !== 200) return json({ error: "cannot read review" }, reviewStatus)
        return json({ meta: { nextFeedback: 6 }, feedbacks: [parseFeedback(SPEC)] })
      }
      if (method === "DELETE") return json({ ok: true })
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

const noop = () => {}

async function render(extra: Partial<PanelProps> = {}) {
  await act(async () => {
    root.render(
      <Panel
        review="08.4"
        onReviewChange={() => {}}
        onNewFeedback={() => {}}
        onTogglePins={() => {}}
        onOpenSource={() => {}}
        onPeekPins={() => {}}
        shownPinsOwner={null}
        onAllPins={noop}
        {...extra}
      />
    )
  })
}

const row = (id: string) => host.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!
const action = (id: string, label: string) =>
  row(id).querySelector<HTMLButtonElement>(`.dr-action[aria-label="${label}"]`)
const opCalls = () => calls.filter((c) => c.url.endsWith("/ops"))

function type(field: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value)
  field.dispatchEvent(new Event("input", { bubbles: true }))
}

function key(el: HTMLElement, k: string, extra: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...extra }))
}

describe("Panel", () => {
  it("renders a row's attachment lines as links to the file", async () => {
    await render()
    // Grey chips under the text, as in the drawer; no button for them.
    expect(action("5.d", "Attached files")).toBeNull()
    const link = row("5.d").querySelector<HTMLAnchorElement>(".dr-row-files a")!
    // On a line of their own, the status tag below them.
    expect(link.parentElement!.nextElementSibling!.classList.contains("dr-row-meta")).toBe(true)
    expect(link.textContent).toBe("5.d-my shot.png")
    expect(link.getAttribute("href")).toBe(
      "/__review/files/08.4/05-main-navigation/5.d-my%20shot.png"
    )
    expect(link.target).toBe("_blank")
  })

  it("lists the review's rows with counts", async () => {
    await render()
    const ids = [...host.querySelectorAll("[data-row-id]")].map((el) =>
      el.getAttribute("data-row-id")
    )
    expect(ids).toEqual(["5", "5.a", "5.b", "5.c", "5.d"])
    expect(host.querySelector(".dr-filters")?.textContent).toBe(
      "All 4Open 2To review 1Done 1＋ New feedback"
    )
    // Only the row the pins belong to has Show pins.
    expect(action("5", "Show pins")).not.toBeNull()
    expect(action("5.a", "Show pins")).toBeNull()
  })

  it("Validate on a row to review validates it, then refetches", async () => {
    await render()
    const before = calls.filter((c) => c.url === "/__review/api/reviews/08.4").length
    await act(async () => action("5.c", "Validate")!.click())
    expect(opCalls()).toEqual([
      {
        url: "/__review/api/reviews/08.4/feedbacks/5/ops",
        method: "POST",
        body: { op: { kind: "setStatus", rowId: "5.c", status: "done" }, assets: [] },
      },
    ])
    expect(calls.filter((c) => c.url === "/__review/api/reviews/08.4").length).toBe(before + 1)
  })

  it("Refine opens the field; Enter sends one line", async () => {
    await render()
    await act(async () => action("5.c", "Refine")!.click())
    const field = row("5.c").querySelector<HTMLInputElement>("input.dr-refine")!
    expect(field.type).toBe("text")
    expect(field.value).toContain("Search field")
    await act(async () => type(field, "Align the search field"))
    await act(async () => key(field, "Enter"))
    expect(opCalls()[0].body).toEqual({
      op: { kind: "refine", rowId: "5.c", text: "Align the search field" },
      assets: [],
    })
  })

  it("Refine's save button, joined to the field, sends it too", async () => {
    await render()
    await act(async () => action("5.c", "Refine")!.click())
    const field = row("5.c").querySelector<HTMLInputElement>("input.dr-refine")!
    await act(async () => type(field, "Align it"))
    const save = row("5.c").querySelector<HTMLButtonElement>(
      '[aria-label="Save refinement of 5.c"]'
    )!
    expect(save.getAttribute("data-tip")).toBe("Save")
    await act(async () => save.click())
    expect(opCalls()[0].body).toEqual({
      op: { kind: "refine", rowId: "5.c", text: "Align it" },
      assets: [],
    })
  })

  it("shows the pins of the filter: on All none of a done row's", async () => {
    const spec = `# 7. Header \`open\`

📍 /concept-08-4

- a. Logo \`done\`
  📍 /concept-08-4
  - 1. Mark \`open\`
- b. Menu \`open\`
`
    held.set(
      "/__review/api/reviews/08.4",
      Promise.resolve(json({ meta: { nextFeedback: 8 }, feedbacks: [parseFeedback(spec)] }))
    )
    const owners: string[][] = []
    await render({ onAllPins: (groups) => owners.push(groups.map((g) => g.owner)) })
    expect(owners.at(-1)).toEqual(["7"])
    const tab = (label: string) =>
      Array.from(host.querySelectorAll<HTMLButtonElement>(".dr-tab")).find((b) =>
        b.textContent!.startsWith(label)
      )!
    await act(async () => tab("Done").click())
    expect(owners.at(-1)).toEqual(["7.a"])
    // On Open, the done row's pin still covers its open sub-row.
    await act(async () => tab("Open").click())
    expect(owners.at(-1)).toEqual(["7", "7.a"])
    await act(async () => tab("All").click())
    expect(owners.at(-1)).toEqual(["7"])
  })

  it("a row not done offers Validate, only one to review Refine; only one with history History", async () => {
    await render()
    const labels = (id: string) =>
      [...row(id).querySelectorAll(".dr-action")].map((b) => b.getAttribute("aria-label"))
    expect(labels("5.a")).toEqual(["Devalidate", "Screenshot", "Delete row"])
    expect(labels("5.b")).toEqual(["Validate", "History", "Screenshot", "Delete row"])
    expect(labels("5.c")).toEqual(["Validate", "Refine", "Show pins", "Screenshot", "Delete row"])
  })

  it("Devalidate puts a done row back where Validate took it from, else to review", async () => {
    await render()
    expect(action("5.a", "Devalidate")!.getAttribute("data-tip")).toBe("Devalidate: back to review")
    await act(async () => action("5.a", "Devalidate")!.click())
    expect(opCalls().at(-1)!.body).toEqual({
      op: { kind: "setStatus", rowId: "5.a", status: "review" },
      assets: [],
    })
    await act(async () => action("5.b", "Validate")!.click())
    expect(opCalls().at(-1)!.body).toMatchObject({
      op: { kind: "setStatus", rowId: "5.b", status: "done" },
    })
    // The reload now reads 5.b as done.
    held.set(
      "/__review/api/reviews/08.4",
      Promise.resolve(
        json({
          meta: { nextFeedback: 6 },
          feedbacks: [parseFeedback(SPEC.replace("100% `open`", "100% `done`"))],
        })
      )
    )
    await act(async () =>
      FakeEventSource.last!.onmessage!({ data: JSON.stringify({ review: "08.4" }) })
    )
    expect(action("5.b", "Devalidate")!.getAttribute("data-tip")).toBe("Devalidate: back to open")
  })

  it("loads every listed row's pin records without a hover, done rows too", async () => {
    const spec = `# 7. Header \`open\`

- a. Logo \`done\`
  📍 /concept-08-4 — ![](07-header/7.a-pin.png)
  - 1. Mark \`done\`
- b. Menu \`open\`
`
    held.set(
      "/__review/api/reviews/08.4",
      Promise.resolve(json({ meta: { nextFeedback: 8 }, feedbacks: [parseFeedback(spec)] }))
    )
    await render()
    expect(calls.filter((c) => c.url.endsWith("/07-header/7.a-pin.json"))).toHaveLength(1)
  })

  it("letters typed on a row do nothing", async () => {
    await render()
    for (const k of ["v", "r", "h"]) await act(async () => key(row("5.c"), k))
    expect(opCalls()).toEqual([])
    expect(row("5.c").querySelector("textarea")).toBeNull()
  })

  it("History shows the history under the text", async () => {
    await render()
    await act(async () => action("5.b", "History")!.click())
    const history = row("5.b").querySelector(".dr-history")!
    expect(history.textContent).toContain("Before: Active state is hard to see")
    expect(history.previousElementSibling?.classList.contains("dr-row-meta")).toBe(true)
  })

  it("a row to review shows Claude's latest note; History keeps the earlier ones", async () => {
    const spec = `# 7. Header \`open\`

- a. Shadow \`review\`
  - Before: Add a shadow
  - Claude: Kept it soft
  - Before: Stronger shadow
  - Claude: Shadow on the label
- b. Border \`review\`
  - Claude: Only on hover
- c. Blur \`open\`
  - Claude: Kept 2px
`
    held.set(
      "/__review/api/reviews/08.4",
      Promise.resolve(json({ meta: { nextFeedback: 8 }, feedbacks: [parseFeedback(spec)] }))
    )
    await render()
    expect(row("7.a").querySelector(".dr-row-note")!.textContent).toBe(
      "Claude: Shadow on the label"
    )
    await act(async () => action("7.a", "History")!.click())
    expect(row("7.a").querySelector(".dr-history")!.textContent).not.toContain("on the label")
    expect(row("7.a").querySelectorAll(".dr-history > li")).toHaveLength(3)
    // Its only note is shown, so there is no history left to open.
    expect(row("7.b").querySelector(".dr-row-note")!.textContent).toBe("Claude: Only on hover")
    expect(action("7.b", "History")).toBeNull()
    // Not waiting for review: the note stays in History.
    expect(row("7.c").querySelector(".dr-row-note")).toBeNull()
    expect(action("7.c", "History")).not.toBeNull()
  })

  it("the status tag ends the line under the text; no Edit, Delete apart on every row", async () => {
    await render()
    expect(row("5.c").querySelector(".dr-row-meta")!.lastElementChild!.textContent).toBe("review")
    expect(host.querySelector('[aria-label="Edit feedback"]')).toBeNull()
    expect(action("5", "Delete feedback")!.parentElement!.classList.contains("dr-row-side")).toBe(
      true
    )
    expect(action("5.c", "Delete row")!.parentElement!.classList.contains("dr-row-side")).toBe(true)
  })

  it("Delete asks for a second click: a row goes by deleteRow, a feedback with its folder", async () => {
    await render()
    const del = action("5.c", "Delete row")!
    await act(async () => del.click())
    expect(opCalls()).toEqual([])
    expect(del.classList.contains("dr-action-danger")).toBe(true)
    expect(del.getAttribute("data-tip")).toBe("Click again to delete")
    await act(async () => del.click())
    expect(opCalls()[0].body).toEqual({ op: { kind: "deleteRow", rowId: "5.c" }, assets: [] })

    // Leaving the button disarms it.
    const feedback = action("5", "Delete feedback")!
    await act(async () => feedback.click())
    await act(async () => feedback.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })))
    expect(feedback.classList.contains("dr-action-danger")).toBe(false)
    await act(async () => feedback.click())
    await act(async () => feedback.click())
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      "/__review/api/reviews/08.4/feedbacks/5",
    ])
  })

  it("Refine adds pins and files, sent after the text; Save is primary, where Delete was", async () => {
    const capture = {
      pin: { path: "/concept-08-4" },
      record: { version: 1, at: "t", steps: [] },
      state: "{}",
      png: "cG5n",
      finishing: Promise.resolve(),
    }
    await render({ startPick: async () => capture as never })
    await act(async () => action("5.c", "Refine")!.click())
    const group = row("5.c").querySelector(".dr-row-refining > .dr-refine-group")!
    const save = group.querySelector<HTMLButtonElement>('[aria-label="Save refinement of 5.c"]')!
    expect(save.classList.contains("dr-action-primary")).toBe(true)
    expect([...group.querySelectorAll(".dr-action")].at(-1)).toBe(save)

    await act(async () =>
      group.querySelector<HTMLButtonElement>('[aria-label="Pin 5.c to an element"]')!.click()
    )
    const input = group.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(["hi"], "note.txt")
    Object.defineProperty(input, "files", { value: [file] })
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })))
    expect(row("5.c").querySelector(".dr-files")!.textContent).toContain("note.txt")

    await act(async () => type(group.querySelector<HTMLInputElement>("input.dr-refine")!, "Align"))
    await act(async () => save.click())
    const ops = opCalls().map((c) => c.body as { op: { kind: string }; assets: { name: string }[] })
    expect(ops.map((o) => o.op.kind)).toEqual(["refine", "addPin", "attach"])
    expect(ops[1].assets.map((a) => a.name)).toEqual(["pin.png", "pin.json", "state.json"])
    expect(ops[2].assets.map((a) => a.name)).toEqual(["note.txt"])
    expect(row("5.c").querySelector(".dr-refine-group")).toBeNull()
  })

  it("a tab reserves its bold label's width", async () => {
    await render()
    const labels = Array.from(host.querySelectorAll(".dr-tab-label"))
    expect(labels.map((l) => [l.textContent, l.getAttribute("data-reserve")])).toEqual([
      ["All", "All"],
      ["Open", "Open"],
      ["To review", "To review"],
      ["Done", "Done"],
    ])
  })

  it("an API error shows inline", async () => {
    await render()
    opStatus = 409
    await act(async () => action("5.c", "Validate")!.click())
    expect(host.querySelector(".dr-error")?.textContent).toContain("5.b is locked")
  })

  it("Show pins is pressed on the row whose pins it shows", async () => {
    await render({ shownPinsOwner: "5" })
    expect(action("5", "Show pins")!.getAttribute("aria-pressed")).toBe("true")
    expect(action("5.c", "Show pins")!.getAttribute("aria-pressed")).toBe("false")
  })

  it("the screenshot floats while toggled, opens in a new tab, and stays on mouse-out", async () => {
    await render()
    const button = action("5.c", "Screenshot")!
    await act(async () => button.click())
    const link = document.querySelector<HTMLAnchorElement>(
      '.dr-flyout[aria-label="Screenshot of 5.c"] a'
    )!
    expect(link.target).toBe("_blank")
    expect(link.querySelector("img")).not.toBeNull()
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
    })
    expect(document.querySelector(".dr-flyout")).not.toBeNull()
    await act(async () => button.click())
    expect(document.querySelector(".dr-flyout")).toBeNull()
  })

  it("several screenshots open as a list: thumbnail and name, each in a new tab", async () => {
    const spec = `# 7. Header \`open\`

- a. Logo \`review\`
  📍 /concept-08-4 — ![](07-header/7.a-pin.png)
  📍 /concept-08-4 — ![](07-header/7.a-pin-2.png)
`
    held.set(
      "/__review/api/reviews/08.4",
      Promise.resolve(json({ meta: { nextFeedback: 8 }, feedbacks: [parseFeedback(spec)] }))
    )
    await render()
    await act(async () => action("7.a", "Screenshot")!.click())
    expect(document.querySelector(".dr-flyout.dr-shot")).toBeNull()
    const links = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        '.dr-flyout.dr-shot-list[aria-label="Screenshots of 7.a"] a'
      ),
    ]
    expect(links.map((l) => [l.title, l.target, Boolean(l.querySelector("img"))])).toEqual([
      ["7.a-pin.png", "_blank", true],
      ["7.a-pin-2.png", "_blank", true],
    ])
    expect(links[1].querySelector(".dr-shot-tail")!.textContent).toBe("a-pin-2.png".slice(-10))
  })

  it("Esc closes the screenshot flyout", async () => {
    await render()
    await act(async () => action("5.c", "Screenshot")!.click())
    expect(document.querySelector(".dr-flyout.dr-shot")).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(document.querySelector(".dr-flyout")).toBeNull()
  })

  it("a busy row keeps its depth class and gains dr-busy", async () => {
    await render()
    const op = deferred()
    held.set("/__review/api/reviews/08.4/feedbacks/5/ops", op.promise)
    await act(async () => action("5.c", "Validate")!.click())
    expect(row("5.c").classList.contains("dr-depth-1")).toBe(true)
    expect(row("5.c").classList.contains("dr-busy")).toBe(true)
    await act(async () => op.resolve(json({})))
    expect(row("5.c").classList.contains("dr-busy")).toBe(false)
  })

  it("a pin-record fetch overtaken by a reload does not refill the cache", async () => {
    // Every pin's record is fetched with the review; this one is held.
    const record = deferred()
    held.set("/__review/files/08.4/05-main-navigation/5.c-pin.json", record.promise)
    await render()
    expect(calls.some((c) => c.url.endsWith("5.c-pin.json"))).toBe(true)
    await act(async () => FakeEventSource.last!.onmessage!({ data: '{"review":"08.4"}' }))
    const source = { file: "src/x.tsx", line: 3 }
    const step = { element: { source } }
    await act(async () => record.resolve(json({ version: 1, at: "", steps: [step] })))
    expect(row("5.c").querySelector('[aria-label="Open in VS Code"]')).toBeNull()
  })

  it("a successful load clears an earlier load error", async () => {
    reviewStatus = 500
    await render()
    expect(host.querySelector(".dr-error")?.textContent).toContain("cannot read review")
    reviewStatus = 200
    await act(async () => FakeEventSource.last!.onmessage!({ data: '{"review":"08.4"}' }))
    expect(host.querySelector(".dr-error")).toBeNull()
  })

  it("Show pins's notice shows inline and can be dismissed", async () => {
    const onTogglePins = vi.fn(async () => "Pinned element not found — the page changed since.")
    await render({ onTogglePins })
    const go = [...row("5.c").querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Show pins"
    )!
    await act(async () => go.click())
    await act(async () => {})
    expect(onTogglePins).toHaveBeenCalledWith(
      "5.c",
      expect.objectContaining({
        ownerRowId: "5.c",
        pins: [expect.objectContaining({ recordPath: "05-main-navigation/5.c-pin.json" })],
      })
    )
    const alert = host.querySelector(".dr-error")!
    expect(alert.textContent).toContain("Pinned element not found — the page changed since.")
    await act(async () => alert.querySelector("button")!.click())
    expect(host.querySelector(".dr-error")).toBeNull()
  })

  it("a successful Show pins clears an earlier notice", async () => {
    const answers = ["Pinned element not found — the page changed since.", null]
    await render({ onTogglePins: async () => answers.shift() })
    const go = [...row("5.c").querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Show pins"
    )!
    await act(async () => go.click())
    await act(async () => {})
    expect(host.querySelector(".dr-error")).not.toBeNull()
    await act(async () => go.click())
    await act(async () => {})
    expect(host.querySelector(".dr-error")).toBeNull()
  })

  it("a closed drawer slides out before it unmounts, over a fading backdrop", async () => {
    await render({ drawer: <section className="dr-drawer">Draft</section> })
    expect(host.querySelector(".dr-drawer-layer .dr-drawer-backdrop")).not.toBeNull()
    await render({ drawer: null })
    const layer = host.querySelector(".dr-drawer-layer")!
    expect(layer.classList.contains("dr-leaving")).toBe(true)
    expect(layer.textContent).toBe("Draft")
    await act(async () => {
      layer.querySelector(".dr-drawer")!.dispatchEvent(new Event("animationend", { bubbles: true }))
    })
    expect(host.querySelector(".dr-drawer-layer")).toBeNull()
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
