import type { PinStep } from "../../model/types.ts"
import { resolveFrames } from "./frames.ts"

// The pinned element, or — when it only exists while something is hovered
// (a flyout row) — its nearest ancestor that is on the page now: the
// selector's `a > b > c` path, cut back one step at a time.
function nearestOnPage(doc: Document, selector: string): Element | null {
  const parts = selector.split(" > ")
  for (let n = parts.length; n > 0; n--) {
    try {
      const el = doc.querySelector(parts.slice(0, n).join(" > "))
      if (el) return el
    } catch {
      return null
    }
  }
  return null
}

// The app sees the pointer arrive on the pin's element as if it were really
// there: what opens on hover (the main navigation's flyout) opens, with no
// change to the app. The same pointer events a real hover sends — bubbling
// `over`, and `enter` on the element and each ancestor — so React's
// onPointerEnter/onMouseEnter fire too. CSS :hover cannot be faked and stays
// off. Returns what ends it (the matching `out` / `leave` events), or null
// for a pin with nothing to hover in the frame (or in the nested iframe its
// `frames` lead to).
export function replayHover(frame: HTMLIFrameElement | null, step: PinStep): (() => void) | null {
  if (step.inTool) return null
  let found: ReturnType<typeof resolveFrames>
  try {
    found = resolveFrames(frame?.contentDocument, step.frames)
  } catch {
    return null
  }
  if (!found?.win) return null
  const doc = found.doc
  const win = found.win as Window & typeof globalThis
  const el = nearestOnPage(doc, step.element.selector)
  if (!el) return null
  const chain: Element[] = []
  for (let n: Element | null = el; n; n = n.parentElement) chain.push(n)
  const { x, y } = step.mouse
  const init = { clientX: x, clientY: y, relatedTarget: null, composed: true }
  const Pointer = win.PointerEvent ?? win.MouseEvent
  const send = (over: string, enter: string) => {
    el.dispatchEvent(
      new Pointer(`pointer${over}`, {
        ...init,
        bubbles: true,
        pointerType: "mouse",
        isPrimary: true,
      })
    )
    el.dispatchEvent(new win.MouseEvent(`mouse${over}`, { ...init, bubbles: true }))
    const order = enter === "enter" ? [...chain].reverse() : chain
    for (const n of order) {
      n.dispatchEvent(new Pointer(`pointer${enter}`, { ...init, pointerType: "mouse" }))
      n.dispatchEvent(new win.MouseEvent(`mouse${enter}`, init))
    }
  }
  send("over", "enter")
  let ended = false
  return () => {
    if (ended || !el.isConnected) return
    ended = true
    send("out", "leave")
  }
}
