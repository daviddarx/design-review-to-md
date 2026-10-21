import { useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { readKey, writeKey } from "./prefs.ts"

export type ToolbarProps = {
  onPinAndAdd(): void
  onNewPoint(): void
  onToggleList(): void
  onExit(): void
  listCount: number
}

type Pos = { x: number; y: number }

function readPos(): Pos | null {
  try {
    const v = JSON.parse(readKey("toolbar") ?? "null")
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null
  } catch {
    return null
  }
}

// Keeps the whole toolbar inside the window.
function clamp(pos: Pos, el: HTMLElement): Pos {
  const { width, height } = el.getBoundingClientRect()
  if (!width || !height) return pos // not laid out — never clamp against a zero box
  return {
    x: Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - width)),
    y: Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - height)),
  }
}

// Fixed dark pill. The grip drags it (pointer capture keeps the drag alive
// over the iframe); the position persists at `design-review:toolbar`. With
// no stored position it sits bottom-centre.
export function Toolbar({
  onPinAndAdd,
  onNewPoint,
  onToggleList,
  onExit,
  listCount,
}: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const [pos, setPos] = useState<Pos | null>(readPos)

  useEffect(() => {
    if (pos) writeKey("toolbar", JSON.stringify(pos))
  }, [pos])

  useEffect(() => {
    const onResize = () => setPos((p) => (p && ref.current ? clamp(p, ref.current) : p))
    onResize() // a stored position may come from a larger window
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

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
    setPos(clamp({ x: e.clientX - dx, y: e.clientY - dy }, ref.current))
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
      className={pos ? "dr-toolbar" : "dr-toolbar dr-toolbar-default"}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
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
      <button type="button" className="dr-tool-button" onClick={onPinAndAdd}>
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
