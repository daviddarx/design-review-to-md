// @vitest-environment dr-happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { PinStep } from "../../model/types.ts"
import { replayHover } from "./replayHover.ts"

const step = (selector: string, inTool = false): PinStep => ({
  url: "http://localhost/x",
  path: "/x",
  viewport: { width: 100, height: 100, dpr: 1 },
  mouse: { x: 5, y: 6 },
  element: { selector, tag: "a", text: "", rect: { x: 0, y: 0, width: 10, height: 10 } },
  inTool,
})

// The frame's document is this one: what matters is which document the
// events land in, not that it is a real frame.
const frame = { contentDocument: document, contentWindow: window } as unknown as HTMLIFrameElement
const listeners: [string, EventListener][] = []
afterEach(() => {
  for (const [type, fn] of listeners.splice(0)) document.removeEventListener(type, fn, true)
  document.body.innerHTML = ""
})

function setup(html: string) {
  document.body.innerHTML = html
  const seen: string[] = []
  for (const type of ["pointerover", "pointerenter", "pointerout", "pointerleave"]) {
    const fn = (e: Event) => void seen.push(`${type}:${(e.target as Element).id}`)
    document.addEventListener(type, fn, true)
    listeners.push([type, fn])
  }
  return seen
}

describe("replayHover", () => {
  it("sends over/enter to the element and its ancestors, and out/leave when ended", () => {
    const seen = setup('<nav id="nav"><a id="item">Tickets</a></nav>')
    const end = replayHover(frame, step("#nav > a"))!
    expect(seen.filter((s) => s.startsWith("pointerover"))).toEqual(["pointerover:item"])
    expect(seen).toContain("pointerenter:nav")
    expect(seen).toContain("pointerenter:item")
    seen.length = 0
    end()
    end() // once
    expect(seen.filter((s) => s.startsWith("pointerout"))).toEqual(["pointerout:item"])
    expect(seen).toContain("pointerleave:nav")
  })

  it("falls back to the nearest ancestor on the page", () => {
    const seen = setup('<nav id="nav"></nav>')
    expect(replayHover(frame, step("#nav > div > a"))).not.toBeNull()
    expect(seen).toContain("pointerover:nav")
  })

  it("hovers an element inside a nested iframe", () => {
    setup(`<iframe id="storybook-preview-iframe" srcdoc="<p></p>"></iframe>`)
    const previewDoc = document.querySelector("iframe")!.contentDocument!
    previewDoc.body.innerHTML = '<nav id="nav"><a id="item">Tickets</a></nav>'
    const seen: string[] = []
    previewDoc.addEventListener("pointerover", (e) => seen.push((e.target as Element).id), true)
    const nested = { ...step("#nav > a"), frames: [{ selector: "#storybook-preview-iframe" }] }
    const end = replayHover(frame, nested)
    expect(end).not.toBeNull()
    expect(seen).toEqual(["item"])
  })

  it("does nothing for a pin behind a frame it cannot reach", () => {
    setup(`<iframe id="foreign"></iframe>`)
    expect(replayHover(frame, { ...step("#nav"), frames: [{ selector: "#foreign" }] })).toBeNull()
  })

  it("does nothing for a pin in the review tool", () => {
    setup('<nav id="nav"></nav>')
    expect(replayHover(frame, step("#nav", true))).toBeNull()
  })
})
