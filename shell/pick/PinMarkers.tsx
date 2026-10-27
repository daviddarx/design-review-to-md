import { useEffect, useRef, useState } from "react"
import type { PinStep } from "../../model/types.ts"
import { resolveFrames } from "./frames.ts"
import { followOpeners } from "./goToPin.ts"
import { replayHover } from "./replayHover.ts"

// A pin to draw: where the click of `step` landed, labelled with its row.
// With `onRemove` (the open drawer's pins) a hover shows × and a click
// takes the pin off.
export type Marker = { key: string; label: string; step: PinStep; onRemove?: () => void }

type Spot = { x: number; y: number; exact: boolean }
type Placed = { key: string; label: string } & Spot

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
// resizing). Otherwise, for an app pin on its own page, by the trigger of
// the closed popup it was in, at the same offset from it as when picked;
// failing that, at the click's recorded viewport position (`exact: false`). Nothing for an app pin while
// the frame shows another page, or a tool pin whose element is gone. An
// element in a nested iframe (the step's `frames`) is looked for there, its
// frames' offsets added; with that frame gone the recorded click stands.
export function markerPoint(step: PinStep, frame: HTMLIFrameElement | null): Spot | null {
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
    const r = frame.getBoundingClientRect()
    off = { x: r.left + frame.clientLeft, y: r.top + frame.clientTop }
    const nested = resolveFrames(frame.contentDocument, step.frames)
    doc = nested?.doc
    if (nested) off = { x: off.x + nested.offset.x, y: off.y + nested.offset.y }
  }
  const { mouse } = step
  const was = step.element.rect
  const { selector, trigger } = followOpeners(doc, step.openers ?? [], step.element.selector)
  const el = query(doc, selector)
  const now = el?.getBoundingClientRect()
  if (now && (now.width || now.height)) {
    const fx = was.width ? clamp01((mouse.x - was.x) / was.width) : 0.5
    const fy = was.height ? clamp01((mouse.y - was.y) / was.height) : 0.5
    return { x: off.x + now.x + fx * now.width, y: off.y + now.y + fy * now.height, exact: true }
  }
  if (step.inTool) return null
  const then = trigger?.opener.rect
  const t = then && trigger.el.getBoundingClientRect()
  if (then && t && (t.width || t.height)) {
    return { x: off.x + t.x + mouse.x - then.x, y: off.y + t.y + mouse.y - then.y, exact: false }
  }
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

// The pins of the open drawer and of the list's Show pins, drawn where the
// clicks landed. One animation-frame loop follows scrolling, layout and
// navigation; it only runs while there is something to draw.
//
// Hovering a pin hovers its element in the app too (replayHover), so what
// only shows on hover — the main navigation extended — shows as it was
// pinned. Meanwhile the pin holds still: the app moving under it must not
// pull it from under the pointer (that would end the hover, and restart it).
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
  const held = useRef<Placed | null>(null)
  const endHover = useRef<(() => void) | null>(null)

  const hoverIn = (p: Placed, step: PinStep) => {
    endHover.current?.()
    held.current = p
    endHover.current = replayHover(frame, step)
  }
  const hoverOut = () => {
    held.current = null
    endHover.current?.()
    endHover.current = null
  }
  useEffect(() => () => endHover.current?.(), [])

  useEffect(() => {
    if (hidden || markers.length === 0) {
      held.current = null
      endHover.current?.()
      endHover.current = null
      setPlaced([])
      return
    }
    let id = 0
    const tick = () => {
      const next = markers.flatMap((m) => {
        if (held.current?.key === m.key) return [held.current]
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
  const byKey = new Map(markers.map((m) => [m.key, m]))
  return (
    <div className="dr-markers">
      {placed.map((p) => {
        const marker = byKey.get(p.key)
        const onRemove = marker?.onRemove
        const className = ["dr-marker", !p.exact && "dr-marker-approx"].filter(Boolean).join(" ")
        const common = {
          style: { left: p.x, top: p.y },
          onMouseEnter: () => marker && hoverIn(p, marker.step),
          onMouseLeave: hoverOut,
        }
        return onRemove ? (
          <button
            key={p.key}
            type="button"
            className={`${className} dr-marker-removable`}
            aria-label={`Remove this pin of ${p.label}`}
            title="Remove this pin"
            onClick={() => {
              hoverOut()
              onRemove()
            }}
            {...common}
          >
            <span>{p.label}</span>
          </button>
        ) : (
          <div key={p.key} className={className} aria-hidden="true" {...common}>
            <span>{p.label}</span>
          </div>
        )
      })}
    </div>
  )
}
