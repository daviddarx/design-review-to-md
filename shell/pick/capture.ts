// A picture of what is on screen, rendered from the DOM, and the app's
// localStorage.
import { domToCanvas } from "modern-screenshot"
import type { PinRecord, PinRef } from "../../model/types.ts"

// What a pick hands back. No `png` when the render failed or timed out: the
// pin still records where and what, just without a picture. The pick hands
// it back at once; the picture and the record's source are written into it
// afterwards, and `finishing` settles once they are (saving waits for it).
export type CapturedPin = {
  pin: PinRef
  record: PinRecord
  png?: string
  state: string
  finishing?: Promise<void>
}

const OUTLINE = "#e11d48"

// A capture that has not finished by then (a stalled image or font fetch) is
// given up: the pin goes on without a picture instead of freezing the tool.
export const CAPTURE_MS = 5000

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(`${what} timed out`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id))
}

// What `doc` shows in its window, rendered from the DOM rather than from the
// screen (screen capture made Chrome ask to share the tab and then pinned its
// "Sharing this tab" bar to the window). Inner scroll positions are kept.
function renderViewport(doc: Document, scale: number, skip?: Element): Promise<HTMLCanvasElement> {
  const win = doc.defaultView
  if (!win) return Promise.reject(new Error("Document has no window"))
  return domToCanvas(doc.documentElement, {
    width: win.innerWidth,
    height: win.innerHeight,
    scale,
    timeout: CAPTURE_MS,
    features: { restoreScrollPosition: true },
    filter: skip ? (node) => node !== skip : null,
  })
}

// The app's viewport, or with `withShell` the whole tool window with the
// app's render laid over the frame's box (the library cannot see into it on
// its own terms). Cropped to `crop` with `outline` stroked in red and a dot
// where the click landed; all three are in the shell window's CSS pixels.
export async function grabPng(
  frame: HTMLIFrameElement | null,
  withShell: boolean,
  crop: DOMRect,
  outline: DOMRect,
  click: { x: number; y: number }
): Promise<string> {
  const scale = window.devicePixelRatio || 1
  const render = async () => {
    const app = frame?.contentDocument ? await renderViewport(frame.contentDocument, scale) : null
    if (!withShell) {
      if (!app) throw new Error("No app document")
      return { canvas: app, origin: crop }
    }
    const shell = await renderViewport(document, scale, frame ?? undefined)
    if (app && frame) {
      const box = frame.getBoundingClientRect()
      shell
        .getContext("2d")
        ?.drawImage(app, box.x * scale, box.y * scale, box.width * scale, box.height * scale)
    }
    return { canvas: shell, origin: new DOMRect(0, 0, window.innerWidth, window.innerHeight) }
  }
  const { canvas: source, origin } = await withTimeout(render(), CAPTURE_MS, "Screenshot")
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(crop.width * scale))
  canvas.height = Math.max(1, Math.round(crop.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("No 2D canvas")
  ctx.drawImage(
    source,
    (crop.x - origin.x) * scale,
    (crop.y - origin.y) * scale,
    crop.width * scale,
    crop.height * scale,
    0,
    0,
    canvas.width,
    canvas.height
  )
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 2 * scale
  ctx.strokeRect(
    (outline.x - crop.x) * scale,
    (outline.y - crop.y) * scale,
    outline.width * scale,
    outline.height * scale
  )
  ctx.beginPath()
  ctx.arc((click.x - crop.x) * scale, (click.y - crop.y) * scale, 5 * scale, 0, 2 * Math.PI)
  ctx.fillStyle = OUTLINE
  ctx.fill()
  ctx.strokeStyle = "#fff"
  ctx.stroke()
  return canvas.toDataURL("image/png").split(",")[1] ?? ""
}

// Every localStorage key but the tool's own, as one JSON object.
export function snapshotLocalStorage(): string {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key === null || key.startsWith("design-review:")) continue
    const value = localStorage.getItem(key)
    if (value !== null) out[key] = value
  }
  return JSON.stringify(out)
}

// Restore state: the app's keys become exactly the snapshot's; the tool's
// own keys are left alone.
export function restoreLocalStorage(snapshot: Record<string, unknown>) {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key !== null && !key.startsWith("design-review:")) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
  for (const [key, value] of Object.entries(snapshot)) {
    if (!key.startsWith("design-review:") && typeof value === "string") {
      localStorage.setItem(key, value)
    }
  }
}
