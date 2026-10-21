import { useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { readKey, writeKey } from "./prefs.ts"

export type ToolbarProps = {
  bounds: HTMLElement | null // the area the toolbar stays inside (the app frame)
  hidden?: boolean // out of a screenshot being taken
  onPinAndAdd(): void
  onNewPoint(): void
  onToggleList(): void
  onExit(): void
  listCount: number
}

type Pos = { x: number; y: number }
type Area = { left: number; top: number; right: number; bottom: number }

function readPos(): Pos | null {
  try {
    const v = JSON.parse(readKey("toolbar") ?? "null")
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null
  } catch {
    return null
  }
}

// The frame's box, or the window when the frame is not laid out — never
// clamp against a zero box.
function areaOf(bounds: HTMLElement | null): Area {
  const r = bounds?.getBoundingClientRect()
  if (r && r.width > 0 && r.height > 0) {
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
}

// Keeps the whole toolbar inside the area, so it never sits over the panel.
function clamp(pos: Pos, el: HTMLElement, area: Area): Pos {
  const { width, height } = el.getBoundingClientRect()
  if (!width || !height) return pos
  return {
    x: Math.min(Math.max(area.left, pos.x), Math.max(area.left, area.right - width)),
    y: Math.min(Math.max(area.top, pos.y), Math.max(area.top, area.bottom - height)),
  }
}

// Fixed dark pill. The grip drags it (pointer capture keeps the drag alive
// over the iframe); the position persists at `design-review:toolbar`. With
// no stored position it sits bottom-centre of the frame. It stays inside
// the frame, re-clamped whenever the frame resizes (the panel's drag).
export function Toolbar({
  bounds,
  hidden,
  onPinAndAdd,
  onNewPoint,
  onToggleList,
  onExit,
  listCount,
}: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const [pos, setPos] = useState<Pos | null>(readPos)
  const [area, setArea] = useState<Area>(() => areaOf(bounds))

  useEffect(() => {
    if (pos) writeKey("toolbar", JSON.stringify(pos))
  }, [pos])

  useEffect(() => {
    const onResize = () => {
      const next = areaOf(bounds)
      setArea(next)
      setPos((p) => (p && ref.current ? clamp(p, ref.current, next) : p))
    }
    onResize() // a stored position may come from a larger window
    window.addEventListener("resize", onResize)
    const observer = bounds ? new ResizeObserver(onResize) : null
    if (bounds) observer?.observe(bounds)
    return () => {
      window.removeEventListener("resize", onResize)
      observer?.disconnect()
    }
  }, [bounds])

  const onPointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || !ref.current) return
    e.preventDefault()
    const rect = ref.current.getBoundingClientRect()
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!drag.current || !ref.current) return
    const { dx, dy } = drag.current
    setPos(clamp({ x: e.clientX - dx, y: e.clientY - dy }, ref.current, areaOf(bounds)))
  }
  const endDrag = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      ref={ref}
      className={["dr-toolbar", !pos && "dr-toolbar-default", hidden && "dr-hidden"]
        .filter(Boolean)
        .join(" ")}
      style={pos ? { left: pos.x, top: pos.y } : { left: (area.left + area.right) / 2 }}
      role="toolbar"
      aria-label="Design review"
    >
      <span
        className="dr-grip"
        aria-hidden="true"
        title="Drag to move"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <button
        type="button"
        className="dr-tool-button"
        onClick={onPinAndAdd}
        title="Pick an element and add a point (⌃P)"
      >
        Pin &amp; add
      </button>
      <button type="button" className="dr-tool-button" onClick={onNewPoint}>
        New point
      </button>
      <button type="button" className="dr-tool-button" onClick={onToggleList}>
        List <span className="dr-count">{listCount}</span>
      </button>
      <button type="button" className="dr-tool-button" onClick={onExit} title="Exit review (⌃R)">
        Exit
      </button>
    </div>
  )
}
