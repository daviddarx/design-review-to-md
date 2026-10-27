// Nested iframes inside the app. A Storybook dev server renders every story
// in `#storybook-preview-iframe` inside its manager; the tool reaches into
// such frames as it does into the app's own: only same-origin ones (a
// cross-origin frame's `contentDocument` is null and it is left alone). A
// pin records the chain of iframes down to its element (`PinStep.frames`),
// and everything that finds the element again follows it from the app's
// document — top-down, since happy-dom has no `frameElement` and a browser
// does not need one.
import type { PinFrame } from "../../model/types.ts"
import { uniqueSelector } from "./inspect.ts"

export type Offset = { x: number; y: number }
// `win` is null only for a document without one (a detached one in tests).
export type Resolved = { doc: Document; win: Window | null; offset: Offset }

const isFrame = (el: Element | null): el is HTMLIFrameElement =>
  Boolean(el && (el.tagName === "IFRAME" || el.tagName === "FRAME"))

// The document an iframe shows, or null: not loaded, or not ours to look into.
export function docOf(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument
  } catch {
    return null
  }
}

function framesIn(doc: Document): HTMLIFrameElement[] {
  try {
    return Array.from(doc.querySelectorAll("iframe, frame")) as HTMLIFrameElement[]
  } catch {
    return []
  }
}

// Where a frame's content box starts in its own document's viewport.
export function frameOffset(frame: HTMLIFrameElement): Offset {
  const r = frame.getBoundingClientRect()
  return { x: r.left + frame.clientLeft, y: r.top + frame.clientTop }
}

// `doc` and every same-origin document in the iframes under it, outer first.
export function documentsOf(doc: Document | null | undefined): Document[] {
  if (!doc) return []
  const out: Document[] = [doc]
  for (const frame of framesIn(doc)) out.push(...documentsOf(docOf(frame)))
  return out
}

// The iframes from `root` down to `doc`, outermost first: [] when `doc` is
// `root`, null when `doc` is not under it (or behind a frame we cannot enter).
export function framesTo(root: Document, doc: Document): HTMLIFrameElement[] | null {
  if (root === doc) return []
  for (const frame of framesIn(root)) {
    const inner = docOf(frame)
    if (!inner) continue
    const rest = framesTo(inner, doc)
    if (rest) return [frame, ...rest]
  }
  return null
}

// What a pick records for `el`: each iframe between `root` and `el`'s
// document, as a selector in the document above it and the URL it showed.
export function frameChainOf(el: Element, root: Document): PinFrame[] | null {
  const frames = framesTo(root, el.ownerDocument)
  if (!frames) return null
  return frames.map((frame) => {
    let url: string | undefined
    try {
      url = docOf(frame)?.location.href
    } catch {
      url = undefined
    }
    return { selector: uniqueSelector(frame), ...(url ? { url } : {}) }
  })
}

// Where `doc`'s viewport sits in `root`'s, through the frames between them.
export function offsetWithin(root: Document, doc: Document): Offset | null {
  const frames = framesTo(root, doc)
  if (!frames) return null
  return frames.reduce(
    (off, frame) => {
      const o = frameOffset(frame)
      return { x: off.x + o.x, y: off.y + o.y }
    },
    { x: 0, y: 0 }
  )
}

// The document a record's frame chain leads to from `root`, with its window
// and where its viewport sits in `root`'s. Null when a frame is missing, is
// not an iframe, or cannot be entered (cross-origin): the pin's element is
// then out of reach, like one whose page is not showing.
export function resolveFrames(
  root: Document | null | undefined,
  frames: PinFrame[] | undefined
): Resolved | null {
  if (!root) return null
  let doc = root
  const offset = { x: 0, y: 0 }
  for (const { selector } of frames ?? []) {
    let frame: Element | null
    try {
      frame = doc.querySelector(selector)
    } catch {
      return null
    }
    if (!isFrame(frame)) return null
    const inner = docOf(frame)
    if (!inner) return null
    const o = frameOffset(frame)
    offset.x += o.x
    offset.y += o.y
    doc = inner
  }
  return { doc, win: doc.defaultView, offset }
}

// How often the frame tree is looked at while the tab is hidden, where
// animation frames do not run, so a nested frame loading there is still caught.
const WATCH_HIDDEN_MS = 500

// Hands every same-origin document the frame tree shows to `onNew` once, as
// soon as it is there — polled per animation frame, since a nested iframe
// (the Storybook preview) loads after its parent and a navigation brings a
// new document with no event the shell could listen for; the frame's own
// `load` and, while the tab is hidden, a slow timer stand in for the frames
// the browser then stops delivering.
// Returns what stops the watch.
export function watchDocuments(
  frame: HTMLIFrameElement,
  onNew: (doc: Document, win: Window) => void
): () => void {
  const seen = new WeakSet<Document>()
  let id = 0
  const look = () => {
    for (const doc of documentsOf(docOf(frame))) {
      if (seen.has(doc)) continue
      seen.add(doc)
      const win = doc.defaultView
      if (win) onNew(doc, win)
    }
  }
  const tick = () => {
    look()
    id = requestAnimationFrame(tick)
  }
  tick()
  frame.addEventListener("load", look)
  const timer = setInterval(() => document.hidden && look(), WATCH_HIDDEN_MS)
  return () => {
    cancelAnimationFrame(id)
    frame.removeEventListener("load", look)
    clearInterval(timer)
  }
}
