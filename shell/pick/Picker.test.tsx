// @vitest-environment dr-happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { grabPng, type CapturedPin } from "./capture.ts"
import { usePicker, type Picker } from "./Picker.tsx"

// A render that fails — a stalled font or image fetch ends the same way —
// once the test calls `failRender`.
vi.mock("./capture.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./capture.ts")>()
  return { ...actual, grabPng: vi.fn(actual.grabPng) }
})
let failRender = () => {}
vi.mock("modern-screenshot", () => ({
  createContext: async (_node: Node, options: object) => ({ ...options }),
  domToCanvas: () =>
    new Promise((_, reject) => {
      failRender = () => reject(new Error("render failed"))
    }),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let picker: Picker

// The frame shows the test's own document, so `#target` is the app's.
let frameDoc: Document | null = document
function fakeFrame(): HTMLIFrameElement {
  const frame = document.createElement("iframe")
  Object.defineProperty(frame, "contentDocument", { get: () => frameDoc })
  Object.defineProperty(frame, "contentWindow", { value: window })
  return frame
}
const frame = fakeFrame()

function Harness() {
  picker = usePicker(frame)
  return (
    <div>
      <button type="button" id="target">
        Target
      </button>
      {picker.layer}
    </div>
  )
}

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe("usePicker", () => {
  it("a failed render yields a pin without png, and the picker recovers", async () => {
    await act(async () => root.render(<Harness />))
    let pending!: Promise<CapturedPin | null>
    await act(async () => {
      pending = picker.startPick()
    })
    expect(picker.picking).toBe(true)
    const target = host.querySelector("#target")!
    await act(async () => {
      target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }))
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    let result: CapturedPin | null = null
    await act(async () => {
      result = await pending
    })
    expect(result).not.toBeNull()
    // Handed back before its picture: a loader marks the click meanwhile.
    expect(result!.finishing).toBeInstanceOf(Promise)
    expect(host.querySelector(".dr-pin-loader")).not.toBeNull()
    await act(async () => {
      failRender()
      await result!.finishing
    })
    expect(host.querySelector(".dr-pin-loader")).toBeNull()
    expect(result!.png).toBeUndefined()
    const here = location.pathname + location.search
    expect(result!.record.steps[0].path).toBe(here)
    expect(result!.record.steps[0].inTool).toBe(false)
    expect(result!.record.steps[0]).not.toHaveProperty("frames") // the app's own document
    expect(result!.pin).toEqual({ path: here })
    expect(picker.picking).toBe(false)

    // Not stuck: the next pick starts.
    let again!: Promise<CapturedPin | null>
    await act(async () => {
      again = picker.startPick()
    })
    expect(picker.picking).toBe(true)
    await act(async () => {
      picker.cancel()
      expect(await again).toBeNull()
    })
    expect(picker.picking).toBe(false)
  }, 5000)

  it("picks inside a nested iframe and records the frame path", async () => {
    await act(async () => root.render(<Harness />))
    // A Storybook-like preview iframe inside the app, loaded after the pick
    // started (the picker must still catch its clicks).
    let pending!: Promise<CapturedPin | null>
    await act(async () => {
      pending = picker.startPick()
    })
    host.insertAdjacentHTML(
      "beforeend",
      `<iframe id="storybook-preview-iframe" srcdoc="<p></p>"></iframe>`
    )
    const preview = host.querySelector("iframe") as HTMLIFrameElement
    preview.getBoundingClientRect = () => new DOMRect(20, 30, 600, 400)
    const previewDoc = preview.contentDocument!
    previewDoc.body.innerHTML = `<div id="storybook-root"><button data-slot="story">Story</button></div>`
    const story = previewDoc.querySelector("button")!
    story.getBoundingClientRect = () => new DOMRect(5, 7, 100, 20)
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    await act(async () => {
      story.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 10, clientY: 12 })
      )
      story.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 10, clientY: 12 })
      )
    })
    let result: CapturedPin | null = null
    await act(async () => {
      result = await pending
    })
    expect(result).not.toBeNull()
    const step = result!.record.steps[0]
    expect(step.frames).toEqual([{ selector: "#storybook-preview-iframe", url: "about:srcdoc" }])
    expect(step.element.selector).toBe('[data-slot="story"]')
    expect(step.mouse).toEqual({ x: 10, y: 12 }) // in the story's own viewport, like its rect
    expect(step.element.rect).toEqual({ x: 5, y: 7, width: 100, height: 20 })
    expect(step.path).toBe(location.pathname + location.search) // the app's, not the story's
    // The loader sits at the click, in shell coordinates.
    const loader = host.querySelector<HTMLElement>(".dr-pin-loader")!
    expect(loader.style.left).toBe("30px")
    expect(loader.style.top).toBe("42px")
    await act(async () => {
      failRender()
      await result!.finishing
    })
  }, 5000)

  it("a pick on a canvas is a spot: no style tip, a ringed mark", async () => {
    vi.mocked(grabPng).mockClear()
    await act(async () => root.render(<Harness />))
    host.insertAdjacentHTML("beforeend", `<canvas id="map"></canvas>`)
    let pending!: Promise<CapturedPin | null>
    await act(async () => {
      pending = picker.startPick()
    })
    const canvas = host.querySelector("canvas")!
    await act(async () => {
      canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }))
    })
    expect(document.querySelector(".dr-style-tip")).toBeNull()
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    let result: CapturedPin | null = null
    await act(async () => {
      result = await pending
    })
    expect(result!.record.steps[0].element.tag).toBe("canvas")
    const args = vi.mocked(grabPng).mock.calls[0]
    expect(args[5]).toBeUndefined() // tip
    expect(args[6]).toBe(true) // spot
    await act(async () => {
      failRender()
      await result!.finishing
    })
  }, 5000)

  it("an empty overlay over a canvas is picked as the canvas spot", async () => {
    vi.mocked(grabPng).mockClear()
    await act(async () => root.render(<Harness />))
    host.insertAdjacentHTML("beforeend", `<canvas id="map"></canvas><div id="overlay"></div>`)
    const canvas = host.querySelector("canvas")!
    const overlay = host.querySelector("#overlay")!
    document.elementsFromPoint = () => [overlay, canvas]
    let pending!: Promise<CapturedPin | null>
    await act(async () => {
      pending = picker.startPick()
    })
    await act(async () => {
      overlay.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }))
    })
    expect(document.querySelector(".dr-style-tip")).toBeNull()
    await act(async () => {
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    let result: CapturedPin | null = null
    await act(async () => {
      result = await pending
    })
    expect(result!.record.steps[0].element.tag).toBe("canvas")
    const args = vi.mocked(grabPng).mock.calls[0]
    expect(args[5]).toBeUndefined()
    expect(args[6]).toBe(true)
  }, 5000)

  it("does not pick the tool's own UI", async () => {
    frameDoc = document.implementation.createHTMLDocument("app") // the app is elsewhere
    await act(async () => root.render(<Harness />))
    let pending!: Promise<CapturedPin | null>
    await act(async () => {
      pending = picker.startPick()
    })
    const target = host.querySelector("#target")!
    await act(async () => {
      target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }))
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    expect(picker.picking).toBe(true)
    await act(async () => {
      picker.cancel()
      expect(await pending).toBeNull()
    })
    frameDoc = document
  })
})
