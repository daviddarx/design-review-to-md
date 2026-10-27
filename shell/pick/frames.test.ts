// @vitest-environment dr-happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  documentsOf,
  frameChainOf,
  framesTo,
  offsetWithin,
  resolveFrames,
  watchDocuments,
} from "./frames.ts"

// happy-dom gives an iframe a document of its own only with `srcdoc`; one
// without stands in for a cross-origin frame (contentDocument is null).
const SRCDOC = 'srcdoc="<p></p>"'

const box = (x: number, y: number, width: number, height: number) => () =>
  new DOMRect(x, y, width, height)

// A Storybook-like tree: the manager document holds the preview iframe,
// which holds the story (and, for depth, one more iframe inside it).
function storybook() {
  document.body.innerHTML = `<div id="manager"><iframe id="storybook-preview-iframe" ${SRCDOC}></iframe></div>`
  const preview = document.querySelector("iframe") as HTMLIFrameElement
  preview.getBoundingClientRect = box(200, 50, 600, 400)
  const previewDoc = preview.contentDocument!
  previewDoc.body.innerHTML = `<div id="storybook-root"><button id="btn">Go</button><iframe data-slot="inner" ${SRCDOC}></iframe></div>`
  const inner = previewDoc.querySelector("iframe") as HTMLIFrameElement
  inner.getBoundingClientRect = box(10, 20, 100, 100)
  const innerDoc = inner.contentDocument!
  innerDoc.body.innerHTML = `<i id="deep">x</i>`
  return { preview, previewDoc, inner, innerDoc }
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("documentsOf", () => {
  it("lists the document and every same-origin one under it, outer first", () => {
    const { previewDoc, innerDoc } = storybook()
    expect(documentsOf(document)).toEqual([document, previewDoc, innerDoc])
    expect(documentsOf(null)).toEqual([])
  })

  it("skips a frame it cannot look into", () => {
    document.body.innerHTML = `<iframe src="https://elsewhere.test/"></iframe>`
    expect(documentsOf(document)).toEqual([document])
  })
})

describe("framesTo / frameChainOf", () => {
  it("is the chain of iframes from the root down to the element's document", () => {
    const { preview, previewDoc, inner, innerDoc } = storybook()
    expect(framesTo(document, document)).toEqual([])
    expect(framesTo(document, previewDoc)).toEqual([preview])
    expect(framesTo(document, innerDoc)).toEqual([preview, inner])
    expect(frameChainOf(previewDoc.querySelector("#btn")!, document)).toEqual([
      { selector: "#storybook-preview-iframe", url: "about:srcdoc" },
    ])
    expect(frameChainOf(innerDoc.querySelector("#deep")!, document)).toEqual([
      { selector: "#storybook-preview-iframe", url: "about:srcdoc" },
      { selector: '[data-slot="inner"]', url: "about:srcdoc" },
    ])
  })

  it("is empty for an element in the root document and null for one elsewhere", () => {
    storybook()
    expect(frameChainOf(document.querySelector("#manager")!, document)).toEqual([])
    const other = document.implementation.createHTMLDocument("other")
    expect(frameChainOf(other.body, document)).toBeNull()
  })
})

describe("resolveFrames", () => {
  it("follows the chain and sums the frames' offsets", () => {
    const { previewDoc, innerDoc } = storybook()
    expect(resolveFrames(document, undefined)).toEqual({
      doc: document,
      win: window,
      offset: { x: 0, y: 0 },
    })
    expect(resolveFrames(document, [])).toMatchObject({ doc: document })
    expect(resolveFrames(document, [{ selector: "#storybook-preview-iframe" }])).toEqual({
      doc: previewDoc,
      win: previewDoc.defaultView,
      offset: { x: 200, y: 50 },
    })
    expect(
      resolveFrames(document, [
        { selector: "#storybook-preview-iframe" },
        { selector: '[data-slot="inner"]' },
      ])
    ).toEqual({ doc: innerDoc, win: innerDoc.defaultView, offset: { x: 210, y: 70 } })
  })

  it("counts a frame's border in", () => {
    const { preview, previewDoc } = storybook()
    Object.defineProperty(preview, "clientLeft", { value: 2 })
    Object.defineProperty(preview, "clientTop", { value: 3 })
    expect(resolveFrames(document, [{ selector: "#storybook-preview-iframe" }])).toEqual({
      doc: previewDoc,
      win: previewDoc.defaultView,
      offset: { x: 202, y: 53 },
    })
  })

  it("is null for a missing, non-iframe, cross-origin or unparsable frame, or no root", () => {
    storybook()
    document.body.insertAdjacentHTML("beforeend", `<iframe id="foreign"></iframe>`)
    expect(resolveFrames(document, [{ selector: "#gone" }])).toBeNull()
    expect(resolveFrames(document, [{ selector: "#manager" }])).toBeNull()
    expect(resolveFrames(document, [{ selector: "#foreign" }])).toBeNull()
    expect(resolveFrames(document, [{ selector: "#[" }])).toBeNull()
    expect(resolveFrames(null, [])).toBeNull()
  })
})

describe("offsetWithin", () => {
  it("is where the document's viewport sits in the root's", () => {
    const { previewDoc, innerDoc } = storybook()
    expect(offsetWithin(document, document)).toEqual({ x: 0, y: 0 })
    expect(offsetWithin(document, previewDoc)).toEqual({ x: 200, y: 50 })
    expect(offsetWithin(document, innerDoc)).toEqual({ x: 210, y: 70 })
    expect(offsetWithin(document, document.implementation.createHTMLDocument("x"))).toBeNull()
  })
})

describe("watchDocuments", () => {
  it("reports each document in the frame once, nested ones as they appear", async () => {
    const seen = vi.fn()
    const frame = {
      contentDocument: document,
      contentWindow: window,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as HTMLIFrameElement
    const stop = watchDocuments(frame, seen)
    expect(seen).toHaveBeenCalledWith(document, window)
    expect(seen).toHaveBeenCalledTimes(1)
    const { previewDoc, innerDoc } = storybook() // the preview loads after the manager
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    expect(seen.mock.calls.map((c) => c[0])).toEqual([document, previewDoc, innerDoc])
    stop()
    document.body.innerHTML = `<iframe ${SRCDOC}></iframe>`
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    expect(seen).toHaveBeenCalledTimes(3)
  })
})
