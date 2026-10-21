import { useEffect, useState } from "react"
import type { PinStep } from "../../model/types.ts"

// A pin to draw: where the click of `step` landed, labelled (the owning row,
// or nothing for a drawer row not saved yet).
export type Marker = { key: string; label: string; step: PinStep }

type Point = { x: number; y: number; exact: boolean }
type Placed = { key: string; label: string } & Point

function query(doc: Document | null | undefined, selector: string): Element | null {
  try {
    return doc?.querySelector(selector) ?? null
  } catch {
    return null
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

// Where the pin's click sits now, in shell coordinates. On the element when
// it is there, at the same spot within it (so it follows scrolling and
// resizing); otherwise, for an app pin on its own page, at the click's
// recorded viewport position (`exact: false`). Nothing for an app pin while
// the frame shows another page, or a tool pin whose element is gone.
export function markerPoint(step: PinStep, frame: HTMLIFrameElement | null): Point | null {
  let doc: Document | null | undefined = document
  let off = { x: 0, y: 0 }
  if (!step.inTool) {
    const win = frame?.contentWindow
    if (!frame || !win) return null
    try {
      if (win.location.pathname + win.location.search !== step.path) return null
    } catch {
      return null
    }
    doc = frame.contentDocument
    const r = frame.getBoundingClientRect()
    off = { x: r.left + frame.clientLeft, y: r.top + frame.clientTop }
  }
  const { mouse } = step
  const was = step.element.rect
  const el = query(doc, step.element.selector)
  const now = el?.getBoundingClientRect()
  if (now && (now.width || now.height)) {
    const fx = was.width ? clamp01((mouse.x - was.x) / was.width) : 0.5
    const fy = was.height ? clamp01((mouse.y - was.y) / was.height) : 0.5
    return { x: off.x + now.x + fx * now.width, y: off.y + now.y + fy * now.height, exact: true }
  }
  if (step.inTool) return null
  return { x: off.x + mouse.x, y: off.y + mouse.y, exact: false }
}

const same = (a: Placed[], b: Placed[]) =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.key === b[i].key &&
      p.label === b[i].label &&
      p.x === b[i].x &&
      p.y === b[i].y &&
      p.exact === b[i].exact
  )

// The pins of the open drawer and of the hovered list row, drawn where the
// clicks landed. One animation-frame loop follows scrolling, layout and
// navigation; it only runs while there is something to draw.
export function PinMarkers({
  frame,
  markers,
  hidden,
}: {
  frame: HTMLIFrameElement | null
  markers: Marker[]
  hidden: boolean
}) {
  const [placed, setPlaced] = useState<Placed[]>([])

  useEffect(() => {
    if (hidden || markers.length === 0) {
      setPlaced([])
      return
    }
    let id = 0
    const tick = () => {
      const next = markers.flatMap((m) => {
        const p = markerPoint(m.step, frame)
        return p ? [{ key: m.key, label: m.label, ...p }] : []
      })
      setPlaced((prev) => (same(prev, next) ? prev : next))
      id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [frame, markers, hidden])

  if (placed.length === 0) return null
  return (
    <div className="dr-markers" aria-hidden="true">
      {placed.map((p) => (
        <div
          key={p.key}
          className={["dr-marker", !p.exact && "dr-marker-approx"].filter(Boolean).join(" ")}
          style={{ left: p.x, top: p.y }}
        >
          <span>{p.label}</span>
        </div>
      ))}
    </div>
  )
}
