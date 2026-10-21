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
      return json({ meta: { nextPoint: 1, retired: [] }, points: [] })
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

const toolbarButton = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".dr-toolbar button")].find((b) =>
    b.textContent?.startsWith(label)
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
  it("New point on an open drawer keeps the draft and focuses it", async () => {
    await act(async () => root.render(<App />))
    await act(async () => toolbarButton("New point").click())
    await type(title()!, "Half-written")
    const drawer = host.querySelector(".dr-drawer")
    await act(async () => toolbarButton("New point").click())
    expect(host.querySelector(".dr-drawer")).toBe(drawer)
    expect(title()!.value).toBe("Half-written")
    expect(document.activeElement).toBe(title())
  })

  it("leaving review mode hides the drawer without losing the draft", async () => {
    await act(async () => root.render(<App />))
    await act(async () => toolbarButton("New point").click())
    await type(title()!, "Half-written")
    await toggleReview()
    expect(host.querySelector(".dr-toolbar")).toBeNull()
    expect(host.querySelector(".dr-panel-host")!.classList.contains("dr-hidden")).toBe(true)
    expect(title()!.value).toBe("Half-written")
    await toggleReview()
    expect(host.querySelector(".dr-panel-host")!.classList.contains("dr-hidden")).toBe(false)
    expect(title()!.value).toBe("Half-written")
  })
})
