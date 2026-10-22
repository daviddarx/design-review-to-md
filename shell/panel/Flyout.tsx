import { useEffect, useRef, useState } from "react"
import type { ComponentProps, ReactNode } from "react"

// `shown` waits for the box's own pictures: one still loading would widen
// the box as it arrives, and the box would slide in from the right.
type Place = { left: number; top: number; shown: boolean }

const GAP = 4

// A box floating over everything, right-aligned under `anchor` (above it
// when there is no room below). Fixed, so no scrolling list clips it; one
// animation-frame loop keeps it on the anchor while the list scrolls. As
// wide as `width`, or as its content up to `maxWidth`. Hover handlers and
// the like pass through.
export function Flyout({
  anchor,
  width,
  maxWidth,
  className,
  label,
  onDismiss,
  children,
  ...rest
}: {
  anchor: HTMLElement | null
  width?: number
  maxWidth?: number
  className?: string
  label: string
  onDismiss?: () => void // Esc, or a press outside the box and its anchor
  children: ReactNode
} & Omit<ComponentProps<"div">, "className" | "children" | "style" | "role">) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<Place | null>(null)

  useEffect(() => {
    if (!anchor) return
    let id = 0
    const tick = () => {
      const a = anchor.getBoundingClientRect()
      const h = ref.current?.offsetHeight ?? 0
      const w = ref.current?.offsetWidth ?? width ?? 0
      const below = a.bottom + GAP
      const top = below + h > window.innerHeight && a.top - GAP - h >= 0 ? a.top - GAP - h : below
      const left = Math.max(GAP, a.right - w)
      const shown = [...(ref.current?.querySelectorAll("img") ?? [])].every((img) => img.complete)
      setPlace((p) =>
        p && p.left === left && p.top === top && p.shown === shown ? p : { left, top, shown }
      )
      id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [anchor, width])

  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  })
  const dismissable = Boolean(onDismiss)
  useEffect(() => {
    if (!dismissable) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor?.contains(t)) dismiss.current?.()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      dismiss.current?.()
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [anchor, dismissable])

  return (
    <div
      ref={ref}
      className={["dr-flyout", className].filter(Boolean).join(" ")}
      role="dialog"
      aria-label={label}
      style={{
        width,
        maxWidth,
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        visibility: place?.shown ? undefined : "hidden",
      }}
      {...rest}
    >
      {children}
    </div>
  )
}
