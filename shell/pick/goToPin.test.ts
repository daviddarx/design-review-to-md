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
