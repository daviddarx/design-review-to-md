// @vitest-environment dr-happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App.tsx"

// The test frame shows this very document, which a real render would walk
// into again through the frame; the pin goes without a picture.
vi.mock("modern-screenshot", () => ({
  domToCanvas: async () => {
    throw new Error("no render in tests")
  },
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeEventSource {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  close() {}
}

let root: Root
let host: HTMLDivElement

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("design-review:mode", "on")
  localStorage.setItem("design-review:review", "08.4")
  vi.stubGlobal("EventSource", FakeEventSource)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/__review/api/reviews") return json(["08.4"])
      return json({ meta: { nextFeedback: 1 }, feedbacks: [] })
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

const newFeedback = () =>
  [...host.querySelectorAll<HTMLButtonElement>(".dr-filters button")].find(
    (b) => b.textContent === "＋ New feedback"
  )!
const title = () => host.querySelector<HTMLTextAreaElement>(".dr-drawer textarea")

async function type(field: HTMLTextAreaElement, text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
    setter.call(field, text)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

const toggleReview = () =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true }))
  })

describe("App drawer", () => {
  it("New feedback on an open drawer keeps the draft and focuses it", async () => {
    await act(async () => root.render(<App />))
    await act(async () => newFeedback().click())
    await type(title()!, "Half-written")
    const drawer = host.querySelector(".dr-drawer")
    await act(async () => newFeedback().click())
    expect(host.querySelector(".dr-drawer")).toBe(drawer)
    expect(title()!.value).toBe("Half-written")
    expect(document.activeElement).toBe(title())
  })

  it("leaving review mode hides the drawer without losing the draft", async () => {
    await act(async () => root.render(<App />))
    await act(async () => newFeedback().click())
    await type(title()!, "Half-written")
    await toggleReview()
    expect(host.querySelector(".dr-panel-host")!.classList.contains("dr-hidden")).toBe(true)
    expect(title()!.value).toBe("Half-written")
    await toggleReview()
    expect(host.querySelector(".dr-panel-host")!.classList.contains("dr-hidden")).toBe(false)
    expect(title()!.value).toBe("Half-written")
  })
})

const ctrlP = () =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }))
  })

// The frame shows the shell's own document in tests: an element appended to
// `host` stands for the app's, and only it is pickable.
function appElement(): HTMLButtonElement {
  const frame = host.querySelector("iframe")!
  Object.defineProperty(frame, "contentDocument", { value: document, configurable: true })
  Object.defineProperty(frame, "contentWindow", { value: window, configurable: true })
  const app = document.createElement("button")
  app.textContent = "App button"
  host.append(app)
  return app
}

// Hover then click `el` while a pick runs.
async function pick(el: Element) {
  await act(async () => {
    el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 5, clientY: 6 }))
  })
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
  // capture → state → drawer
  await act(async () => {})
}

// The red pill on each drawer row's pin button.
const pins = () =>
  [...host.querySelectorAll(".dr-drawer .dr-action-count")].map((p) => p.textContent)

describe("Pin & add", () => {
  it("⌃P picks, and the click opens a new feedback whose title row is pinned", async () => {
    await act(async () => root.render(<App />))
    await ctrlP()
    expect(host.querySelector(".dr-picker-hint")).not.toBeNull()
    await pick(appElement())
    expect(host.querySelector(".dr-picker-hint")).toBeNull()
    expect(host.querySelector(".dr-drawer")).not.toBeNull()
    expect(pins()).toEqual(["1"])
  })

  it("Esc cancels the pick", async () => {
    await act(async () => root.render(<App />))
    await ctrlP()
    expect(host.querySelector(".dr-picker-hint")).not.toBeNull()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    await act(async () => {})
    expect(host.querySelector(".dr-picker-hint")).toBeNull()
    expect(host.querySelector(".dr-drawer")).toBeNull()
  })

  it("with a drawer open, adds a pinned row to it instead of replacing it", async () => {
    await act(async () => root.render(<App />))
    await act(async () => newFeedback().click())
    await type(title()!, "Half-written")
    const drawer = host.querySelector(".dr-drawer")!
    await ctrlP()
    expect(drawer.classList.contains("dr-hidden")).toBe(false)
    await pick(appElement())
    expect(host.querySelector(".dr-drawer")).toBe(drawer)
    expect(drawer.classList.contains("dr-hidden")).toBe(false)
    expect(title()!.value).toBe("Half-written")
    const inputs = drawer.querySelectorAll("textarea")
    expect(inputs).toHaveLength(2)
    expect(pins()).toEqual(["1"])
    expect(document.activeElement).toBe(inputs[1])
  })

  it("the tool's own UI is neither pinned nor acted on during a pick", async () => {
    await act(async () => root.render(<App />))
    await act(async () => newFeedback().click())
    await type(title()!, "Half-written")
    const drawer = host.querySelector(".dr-drawer")!
    const cancel = [...drawer.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!
    await ctrlP()
    await pick(cancel)
    // Cancel did not run: no discard prompt, the drawer and its draft remain.
    expect(host.querySelector(".dr-drawer")).toBe(drawer)
    expect([...drawer.querySelectorAll("button")].some((b) => b.textContent === "Discard")).toBe(
      false
    )
    expect(title()!.value).toBe("Half-written")
    // Nothing pinned, and the pick goes on.
    expect(pins()).toEqual([])
    expect(host.querySelector(".dr-picker-hint")).not.toBeNull()
  })

  it("⌃P does nothing outside review mode", async () => {
    localStorage.setItem("design-review:mode", "off")
    await act(async () => root.render(<App />))
    await ctrlP()
    expect(host.querySelector(".dr-picker-hint")).toBeNull()
  })
})
