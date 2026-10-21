// @vitest-environment dr-happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { PinStep } from "../../model/types.ts"
import { markerPoint } from "./PinMarkers.tsx"

const step = (over: Partial<PinStep> = {}): PinStep => ({
  url: "http://localhost:3000/tickets",
  path: "/tickets",
  viewport: { width: 800, height: 600, dpr: 1 },
  mouse: { x: 130, y: 220 },
  element: {
    selector: "#target",
    tag: "button",
    text: "",
    rect: { x: 100, y: 200, width: 100, height: 40 },
  },
  inTool: false,
  ...over,
})

const box = (x: number, y: number, width: number, height: number) => () =>
  new DOMRect(x, y, width, height)

// A frame stand-in at (500, 10) showing `pathname` with `doc` inside.
function fakeFrame(pathname: string, doc: Document) {
  return {
    contentWindow: { location: { pathname, search: "" } },
    contentDocument: doc,
    clientLeft: 0,
    clientTop: 0,
    getBoundingClientRect: box(500, 10, 800, 600),
  } as unknown as HTMLIFrameElement
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("markerPoint", () => {
  it("sits at the click's spot within the element, wherever the element is now", () => {
    const doc = document.implementation.createHTMLDocument("app")
    doc.body.innerHTML = `<button id="target">Go</button>`
    // Moved and twice as wide: the click was 30% across, 50% down.
    doc.querySelector("#target")!.getBoundingClientRect = box(0, 100, 200, 40)
    expect(markerPoint(step(), fakeFrame("/tickets", doc))).toEqual({
      x: 500 + 60,
      y: 10 + 120,
      exact: true,
    })
  })

  it("falls back to the recorded click when the element is gone", () => {
    const doc = document.implementation.createHTMLDocument("app")
    expect(markerPoint(step(), fakeFrame("/tickets", doc))).toEqual({
      x: 630,
      y: 230,
      exact: false,
    })
  })

  it("shows nothing while the frame is on another page", () => {
    const doc = document.implementation.createHTMLDocument("app")
    expect(markerPoint(step(), fakeFrame("/rooms", doc))).toBeNull()
  })

  it("places a tool pin in the shell, and nothing once its element is gone", () => {
    const tool = step({ path: "(review tool)", inTool: true })
    expect(markerPoint(tool, null)).toBeNull()
    document.body.innerHTML = `<div id="target"></div>`
    document.querySelector("#target")!.getBoundingClientRect = box(100, 200, 100, 40)
    expect(markerPoint(tool, null)).toEqual({ x: 130, y: 220, exact: true })
  })
})
