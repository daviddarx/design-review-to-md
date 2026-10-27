import { useEffect } from "react"
import { watchDocuments } from "./frames.ts"

const PATCHED = Symbol.for("design-review:keep-canvas-pixels")
const WEBGL = new Set(["webgl", "webgl2", "experimental-webgl"])

type CanvasProto = typeof HTMLCanvasElement.prototype & { [PATCHED]?: true }

// A WebGL canvas (the app's maps) drops its pixels once they are on screen,
// so a screenshot rendered from the DOM shows it blank. This asks every
// WebGL context `win` creates from now on to keep them. The app draws as
// before; only the tool's own copy of the canvas changes.
export function keepCanvasPixels(win: Window) {
  const proto = (win as typeof window).HTMLCanvasElement?.prototype as CanvasProto | undefined
  if (!proto || proto[PATCHED]) return
  const getContext = proto.getContext
  proto.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
    const keep =
      WEBGL.has(type) &&
      (options === undefined || (options !== null && typeof options === "object"))
    return getContext.call(
      this,
      type,
      keep ? { ...(options as object), preserveDrawingBuffer: true } : options
    )
  } as typeof proto.getContext
  proto[PATCHED] = true
}

// Every document the frame loads, nested same-origin iframes included, is
// patched as soon as it exists — before the app (hydrated later, its map
// later still) asks for a context.
export function useKeepCanvasPixels(frame: HTMLIFrameElement | null) {
  useEffect(() => {
    if (!frame) return
    return watchDocuments(frame, (_doc, win) => keepCanvasPixels(win))
  }, [frame])
}
