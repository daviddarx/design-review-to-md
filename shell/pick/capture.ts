// A picture of what is on screen, rendered from the DOM, and the app's
// localStorage.
import { createContext, domToCanvas } from "modern-screenshot"
import type { PinRecord, PinRef } from "../../model/types.ts"
import { docOf, frameOffset } from "./frames.ts"
import { tipCorner } from "./styles.ts"
import type { StyleLine } from "./styles.ts"

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

// The render clones the page on the main thread, an element at a time; left
// alone, a page of a few thousand elements froze the tool for seconds (the
// drawer's fields took no typing). It hands the thread back this often.
const SLICE_MS = 12

const nextTask = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(null)
  })

function yieldEvery(ms: number): () => Promise<void> {
  let since = performance.now()
  return async () => {
    if (performance.now() - since < ms) return
    await nextTask()
    since = performance.now()
  }
}

// The library reads each tag's default styles from a sandbox iframe. Its own
// loads from `srcdoc`, which lands later and empties the sandbox mid-render
// once the render yields; this one is written at once, in standards mode.
function sandboxIn(doc: Document): HTMLIFrameElement | undefined {
  const frame = doc.createElement("iframe")
  frame.width = "0"
  frame.height = "0"
  frame.style.visibility = "hidden"
  frame.style.position = "fixed"
  doc.body.append(frame)
  const inner = frame.contentDocument
  if (!inner) {
    frame.remove()
    return undefined
  }
  inner.open()
  inner.write('<!DOCTYPE html><meta charset="UTF-8"><title></title><body>')
  inner.close()
  return frame
}

const isIframe = (node: Node): node is HTMLIFrameElement =>
  (node as Element).tagName === "IFRAME" || (node as Element).tagName === "FRAME"

// What `doc` shows in its window, rendered from the DOM rather than from the
// screen (screen capture made Chrome ask to share the tab and then pinned its
// "Sharing this tab" bar to the window). Inner scroll positions are kept.
// Every same-origin iframe in it (a Storybook story) is rendered on its own
// and laid over the frame's content box: left to the library, the frame's
// document is inlined where the element was and lands elsewhere (an inline
// iframe sits on a baseline, its document does not). A cross-origin frame is
// the library's to draw, which is blank.
async function renderViewport(
  doc: Document,
  scale: number,
  skip?: Element
): Promise<HTMLCanvasElement> {
  const win = doc.defaultView
  if (!win) throw new Error("Document has no window")
  const nested = Array.from(doc.querySelectorAll("iframe, frame")).filter(
    (f): f is HTMLIFrameElement => isIframe(f) && f !== skip && Boolean(docOf(f))
  )
  const context = await createContext(doc.documentElement, {
    width: win.innerWidth,
    height: win.innerHeight,
    scale,
    timeout: CAPTURE_MS,
    features: { restoreScrollPosition: true },
    filter: (node) => node !== skip && !nested.includes(node as HTMLIFrameElement),
    // Every property but the custom ones: their values are already resolved
    // in the others, and copying them (Tailwind registers hundreds, inherited
    // by every element) took most of the render's time and size.
    includeStyleProperties: Array.from(win.getComputedStyle(doc.documentElement)).filter(
      (name) => !name.startsWith("--")
    ),
    onCloneEachNode: yieldEvery(SLICE_MS),
    autoDestruct: true,
  })
  const sandbox = sandboxIn(doc)
  if (sandbox) context.sandbox = sandbox
  let canvas: HTMLCanvasElement
  try {
    canvas = await domToCanvas(context)
  } finally {
    sandbox?.remove() // already gone after a render that finished
  }
  const ctx = canvas.getContext("2d")
  for (const frame of nested) {
    const inner = docOf(frame)
    if (!inner || !ctx) continue
    const sub = await renderViewport(inner, scale).catch(() => null)
    if (!sub) continue
    const o = frameOffset(frame)
    ctx.drawImage(
      sub,
      o.x * scale,
      o.y * scale,
      frame.clientWidth * scale,
      frame.clientHeight * scale
    )
  }
  return canvas
}

// The app's viewport, or with `withShell` the whole tool window with the
// app's render laid over the frame's box (the library cannot see into it on
// its own terms). Cropped to `crop` with `outline` stroked in red and a dot
// where the click landed (with `spot`, ringed too, so it shows on a window
// full of canvas); all three are in the shell window's CSS pixels.
// `tip`, when given, is the picker's style overview, drawn in the corner
// it showed in on screen: bottom-right unless that covers the element.
export async function grabPng(
  frame: HTMLIFrameElement | null,
  withShell: boolean,
  crop: DOMRect,
  outline: DOMRect,
  click: { x: number; y: number },
  tip?: StyleLine[],
  spot = false
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
  if (spot) {
    ctx.beginPath()
    ctx.arc((click.x - crop.x) * scale, (click.y - crop.y) * scale, 12 * scale, 0, 2 * Math.PI)
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 2 * scale
    ctx.stroke()
  }
  if (tip?.length) {
    const { width, height } = outline
    const box = { x: outline.x - crop.x, y: outline.y - crop.y, width, height }
    drawTip(ctx, tip, scale, crop.width, crop.height, box)
  }
  return canvas.toDataURL("image/png").split(",")[1] ?? ""
}

// The style overview's box (see .dr-style-tip), in CSS pixels times `scale`:
// a two-column grid, the computed value below the one written, long values
// wrapped, its corner `TIP.inset` from the picture's bottom-right one.
const TIP = {
  inset: 12,
  padX: 10,
  padY: 8,
  gap: 12,
  rowGap: 3,
  line: 16,
  maxWidth: 420,
  swatch: 10,
  font: "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []
  let line = ""
  for (const ch of text) {
    if (line && ctx.measureText(line + ch).width > width) {
      out.push(line)
      line = ""
    }
    line += ch
  }
  out.push(line)
  return out
}

function drawTip(
  ctx: CanvasRenderingContext2D,
  lines: StyleLine[],
  scale: number,
  width: number,
  height: number,
  outline: { x: number; y: number; width: number; height: number }
) {
  ctx.save()
  ctx.scale(scale, scale)
  ctx.font = TIP.font
  ctx.textBaseline = "middle"
  const widest = (texts: string[]) => Math.max(0, ...texts.map((t) => ctx.measureText(t).width))
  const propW = widest(lines.map((l) => l.prop))
  const swatchW = (l: StyleLine) => (l.swatch ? TIP.swatch + 6 : 0)
  const valueRoom = Math.max(
    40,
    Math.min(TIP.maxWidth, width - 2 * TIP.inset) - 2 * TIP.padX - propW - TIP.gap
  )
  const rows = lines.map((l) => ({
    l,
    value: wrap(ctx, l.value, valueRoom - swatchW(l)),
    computed: l.computed ? wrap(ctx, l.computed, valueRoom) : [],
  }))
  const valueW = Math.max(
    ...rows.map((r) => Math.max(swatchW(r.l) + widest(r.value), widest(r.computed)))
  )
  const boxW = 2 * TIP.padX + propW + TIP.gap + valueW
  const span = (r: (typeof rows)[number]) => r.value.length + r.computed.length
  const lineCount = rows.reduce((n, r) => n + span(r), 0)
  const boxH = 2 * TIP.padY + lineCount * TIP.line + (rows.length - 1) * TIP.rowGap
  const area = { x: 0, y: 0, width, height }
  const { x, y } = tipCorner({ width: boxW, height: boxH }, area, outline, TIP.inset)

  ctx.shadowColor = "rgb(15 23 42 / 0.3)"
  ctx.shadowBlur = 20
  ctx.shadowOffsetY = 6
  ctx.fillStyle = "#1e293b"
  ctx.beginPath()
  ctx.roundRect(x, y, boxW, boxH, 6)
  ctx.fill()
  ctx.shadowColor = "transparent"

  let top = y + TIP.padY
  const valueX = x + TIP.padX + propW + TIP.gap
  for (const r of rows) {
    const { l } = r
    const mid = top + TIP.line / 2
    ctx.fillStyle = "#94a3b8"
    ctx.fillText(l.prop, x + TIP.padX, mid)
    const below = mid + r.value.length * TIP.line
    r.computed.forEach((part, i) => ctx.fillText(part, valueX, below + i * TIP.line))
    if (l.swatch) {
      ctx.fillStyle = l.swatch
      ctx.fillRect(valueX, mid - TIP.swatch / 2, TIP.swatch, TIP.swatch)
      ctx.strokeStyle = "rgb(255 255 255 / 0.4)"
      ctx.lineWidth = 1
      ctx.strokeRect(valueX + 0.5, mid - TIP.swatch / 2 + 0.5, TIP.swatch - 1, TIP.swatch - 1)
    }
    ctx.fillStyle = "#f1f5f9"
    r.value.forEach((part, i) => ctx.fillText(part, valueX + swatchW(l), mid + i * TIP.line))
    top += span(r) * TIP.line + TIP.rowGap
  }
  ctx.restore()
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
