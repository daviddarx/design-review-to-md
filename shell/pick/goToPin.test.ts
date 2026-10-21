// @vitest-environment dr-happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PinRecord } from "../../model/types.ts"
import { goToPin } from "./goToPin.ts"

const record = (selector: string, inTool: boolean): PinRecord => ({
  version: 1,
  at: "t",
  steps: [
    {
      url: "http://localhost:3000/",
      path: inTool ? "(review tool)" : "/",
      viewport: { width: 800, height: 600, dpr: 1 },
      mouse: { x: 0, y: 0 },
      element: { selector, tag: "button", text: "", rect: { x: 0, y: 0, width: 1, height: 1 } },
      inTool,
    },
  ],
})

afterEach(() => {
  document.body.innerHTML = ""
})

describe("goToPin", () => {
  it("outlines a tool element where it is", async () => {
    document.body.innerHTML = `<div class="dr-toolbar"><button data-slot="x">Pin</button></div>`
    const flash = vi.fn()
    const frame = document.createElement("iframe")
    expect(await goToPin(frame, record('[data-slot="x"]', true), flash)).toBe("found")
    expect(flash).toHaveBeenCalledWith(document.querySelector("button"))
  })

  it("reports a selector that finds nothing as missing", async () => {
    const flash = vi.fn()
    const frame = document.createElement("iframe")
    expect(await goToPin(frame, record("#gone", true), flash)).toBe("missing")
    expect(await goToPin(frame, { version: 1, at: "t", steps: [] }, flash)).toBe("missing")
    expect(flash).not.toHaveBeenCalled()
  })
})

// A frame stand-in: `assign` "navigates" and fires `load` on the next tick.
function fakeFrame(pathname: string, doc: Document) {
  const listeners = new Set<() => void>()
  const location = {
    pathname,
    search: "",
    assign: vi.fn((to: string) => {
      location.pathname = to
      setTimeout(() => listeners.forEach((l) => l()), 0)
    }),
  }
  const frame = {
    contentWindow: { location },
    contentDocument: doc,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  return { frame: frame as unknown as HTMLIFrameElement, location }
}

describe("goToPin in the frame", () => {
  const appRecord = (selector: string, path: string): PinRecord => {
    const r = record(selector, false)
    r.steps[0].path = path
    return r
  }

  it("navigates to another path, waits for load, then finds and outlines", async () => {
    const doc = document.implementation.createHTMLDocument("app")
    doc.body.innerHTML = `<button data-slot="go">Go</button>`
    const el = doc.querySelector("button")!
    el.scrollIntoView = vi.fn()
    const { frame, location } = fakeFrame("/elsewhere", doc)
    const flash = vi.fn()
    expect(await goToPin(frame, appRecord('[data-slot="go"]', "/tickets"), flash)).toBe("found")
    expect(location.assign).toHaveBeenCalledWith("/tickets")
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center" })
    expect(flash).toHaveBeenCalledWith(el)
  })

  it("stays on the same path and reports a vanished element as missing", async () => {
    const doc = document.implementation.createHTMLDocument("app")
    const { frame, location } = fakeFrame("/tickets", doc)
    const flash = vi.fn()
    expect(await goToPin(frame, appRecord("#gone", "/tickets"), flash)).toBe("missing")
    expect(location.assign).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
  }, 6000)

  it("a tool pin brings the app back to the page it was on, then outlines", async () => {
    document.body.innerHTML = `<aside><button data-slot="t">Pin</button></aside>`
    const r = record('[data-slot="t"]', true)
    r.steps[0].url = "http://localhost:3000/concept-08-4?x=1"
    const { frame, location } = fakeFrame(
      "/elsewhere",
      document.implementation.createHTMLDocument("app")
    )
    const flash = vi.fn()
    expect(await goToPin(frame, r, flash)).toBe("found")
    expect(location.assign).toHaveBeenCalledWith("/concept-08-4?x=1")
    expect(flash).toHaveBeenCalledWith(document.querySelector("button"))
  })
})
