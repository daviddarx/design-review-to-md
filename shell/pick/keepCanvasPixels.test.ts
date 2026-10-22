import { describe, expect, it, vi } from "vitest"
import { keepCanvasPixels } from "./keepCanvasPixels.ts"

function fakeWindow() {
  const getContext = vi.fn((_type: string, _options?: unknown) => null)
  class Canvas {}
  Object.assign(Canvas.prototype, { getContext })
  return { win: { HTMLCanvasElement: Canvas } as unknown as Window, getContext, Canvas }
}

describe("keepCanvasPixels", () => {
  it("asks WebGL contexts to keep their drawing buffer, and leaves 2D ones alone", () => {
    const { win, getContext, Canvas } = fakeWindow()
    keepCanvasPixels(win)
    keepCanvasPixels(win) // once only
    const canvas = new Canvas() as HTMLCanvasElement
    canvas.getContext("webgl2", { antialias: true })
    canvas.getContext("webgl")
    canvas.getContext("2d", { alpha: false })
    expect(getContext.mock.calls).toEqual([
      ["webgl2", { antialias: true, preserveDrawingBuffer: true }],
      ["webgl", { preserveDrawingBuffer: true }],
      ["2d", { alpha: false }],
    ])
  })
})
