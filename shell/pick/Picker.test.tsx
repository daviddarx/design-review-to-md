// @vitest-environment dr-happy-dom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { CapturedPin } from "./capture.ts"
import { usePicker, type Picker } from "./Picker.tsx"
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
let picker: Picker

function Harness() {
  picker = usePicker(null)
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
  // A share that looks live but whose video never shows a frame — what a
  // "Stop sharing" between pick start and click leaves behind.
  const stream = new MediaStream()
  Object.assign(stream, { getVideoTracks: () => [{ readyState: "live" }] })
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia: async () => stream },
  })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (navigator as { mediaDevices?: unknown }).mediaDevices
})

describe("usePicker", () => {
  it("a video that never loads yields a pin without png, and the picker recovers", async () => {
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
    expect(result!.png).toBeUndefined()
    expect(result!.record.steps[0].path).toBe("(review tool)")
    expect(result!.pin).toEqual({ path: "(review tool)" })
    expect(picker.picking).toBe(false)
    expect(picker.hideToolbar).toBe(false)
    expect(host.querySelector(".dr-picker")!.classList.contains("dr-hidden")).toBe(false)

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
})
