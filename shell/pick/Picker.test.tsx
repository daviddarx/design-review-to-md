// @vitest-environment dr-happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CapturedPin } from "./capture.ts"
import { usePicker, type Picker } from "./Picker.tsx"

// A render that fails — a stalled font or image fetch ends the same way —
// once the test calls `failRender`.
let failRender = () => {}
vi.mock("modern-screenshot", () => ({
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
