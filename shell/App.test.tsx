// @vitest-environment dr-happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App.tsx"
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
  localStorage.setItem("design-review:topic", "08.4")
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
      if (url === "/__review/api/topics") return json(["08.4"])
      return json({ meta: { nextPoint: 1 }, points: [] })
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

// Hover then click `el` while a pick runs; the shell's own UI is pickable.
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

const pins = () => [...host.querySelectorAll(".dr-drawer .dr-pin")].map((p) => p.textContent)

describe("Pin & add", () => {
  it("⌃P picks, and the click opens a new point whose title row is pinned", async () => {
    await act(async () => root.render(<App />))
    await ctrlP()
    expect(host.querySelector(".dr-picker-hint")).not.toBeNull()
    // The click is the pick's: Copy prompt must not run.
    const copy = [...host.querySelectorAll("button")].find((b) => b.textContent === "Copy prompt")!
    await pick(copy)
    expect(copy.textContent).toBe("Copy prompt")
    expect(host.querySelector(".dr-picker-hint")).toBeNull()
    expect(host.querySelector(".dr-drawer")).not.toBeNull()
    expect(pins()).toEqual(["📍 new"])
    expect(host.querySelector(".dr-drawer .dr-pin")!.getAttribute("title")).toBe(
      "New pin: (review tool)"
    )
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
    // Stays on screen during the pick, so its own elements can be pinned.
    expect(drawer.classList.contains("dr-hidden")).toBe(false)
    await pick(host.querySelector(".dr-resize")!)
    expect(host.querySelector(".dr-drawer")).toBe(drawer)
    expect(drawer.classList.contains("dr-hidden")).toBe(false)
    expect(title()!.value).toBe("Half-written")
    const inputs = drawer.querySelectorAll("textarea")
    expect(inputs).toHaveLength(2)
    expect(pins()).toEqual(["📍 new"])
    expect(document.activeElement).toBe(inputs[1])
  })

  it("an element of the open drawer is pinned, not acted on", async () => {
    await act(async () => root.render(<App />))
    await act(async () => newFeedback().click())
    await type(title()!, "Half-written")
    const drawer = host.querySelector(".dr-drawer")!
    const cancel = [...drawer.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!
    await ctrlP()
    await pick(cancel)
    // Cancel did not run: no discard prompt, the drawer and its draft remain.
    expect(host.querySelector(".dr-drawer")).toBe(drawer)
    expect(drawer.querySelector(".dr-drawer-confirm")).toBeNull()
    expect(title()!.value).toBe("Half-written")
    expect(pins()).toEqual(["📍 new"])
    expect(host.querySelector(".dr-drawer .dr-pin")!.getAttribute("title")).toBe(
      "New pin: (review tool)"
    )
  })

  it("⌃P does nothing outside review mode", async () => {
    localStorage.setItem("design-review:mode", "off")
    await act(async () => root.render(<App />))
    await ctrlP()
    expect(host.querySelector(".dr-picker-hint")).toBeNull()
  })
})
