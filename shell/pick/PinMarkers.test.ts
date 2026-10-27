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

  it("finds an element in an open popup whose id changed since the pick", () => {
    const doc = document.implementation.createHTMLDocument("app")
    doc.body.innerHTML = `
      <button data-slot="fav" aria-expanded="true" aria-controls="_r_9_">Fav</button>
      <div id="_r_9_"><button>Go</button></div>`
    doc.querySelector("#_r_9_ > button")!.getBoundingClientRect = box(0, 100, 100, 40)
    const inPopup = step({
      element: { ...step().element, selector: "#_r_2_ > button" },
      openers: [{ selector: '[data-slot="fav"]', controls: "_r_2_" }],
    })
    expect(markerPoint(inPopup, fakeFrame("/tickets", doc))).toEqual({
      x: 500 + 30,
      y: 10 + 120,
      exact: true,
    })
  })

  it("sits by the trigger of its closed popup, wherever the trigger moved", () => {
    const doc = document.implementation.createHTMLDocument("app")
    doc.body.innerHTML = `<button data-slot="fav" aria-expanded="false">Fav</button>`
    // Picked 50px left of the click; the trigger has since moved 300px left.
    doc.querySelector("button")!.getBoundingClientRect = box(-220, 180, 20, 20)
    const inPopup = step({
      openers: [
        {
          selector: '[data-slot="fav"]',
          controls: "_r_2_",
          rect: { x: 80, y: 180, width: 20, height: 20 },
        },
      ],
    })
    expect(markerPoint(inPopup, fakeFrame("/tickets", doc))).toEqual({
      x: 500 + 130 - 300,
      y: 10 + 220,
      exact: false,
    })
  })

  it("follows the step's frames into a nested iframe and adds its offset", () => {
    document.body.innerHTML = `<iframe id="storybook-preview-iframe" srcdoc="<p></p>"></iframe>`
    const preview = document.querySelector("iframe") as HTMLIFrameElement
    preview.getBoundingClientRect = box(20, 30, 600, 400)
    const previewDoc = preview.contentDocument!
    previewDoc.body.innerHTML = `<button id="target">Go</button>`
    previewDoc.querySelector("#target")!.getBoundingClientRect = box(0, 100, 200, 40)
    const nested = step({ frames: [{ selector: "#storybook-preview-iframe" }] })
    expect(markerPoint(nested, fakeFrame("/tickets", document))).toEqual({
      x: 500 + 20 + 60,
      y: 10 + 30 + 120,
      exact: true,
    })
    // A record without frames is looked up in the frame's own document.
    expect(markerPoint(step(), fakeFrame("/tickets", document))).toEqual({
      x: 630,
      y: 230,
      exact: false,
    })
  })

  it("falls back to the recorded click when the nested frame is gone", () => {
    const doc = document.implementation.createHTMLDocument("app")
    const nested = step({ frames: [{ selector: "#storybook-preview-iframe" }] })
    expect(markerPoint(nested, fakeFrame("/tickets", doc))).toEqual({
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
