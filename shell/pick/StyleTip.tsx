import { useLayoutEffect, useRef, useState } from "react"
import { sizeLine, tipCorner } from "./styles.ts"
import type { StyleLine } from "./styles.ts"

type Box = { x: number; y: number; width: number; height: number }

const INSET = 12

// The hovered element's style overview, in a corner of the app: the
// bottom-right one unless it would cover the element (see tipCorner). Its
// rendered size first, then what its stylesheets set, each with what the
// browser computed from it below.
export function StyleTip({ box, area, lines }: { box: Box; area: Box; lines: StyleLine[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { offsetWidth: width, offsetHeight: height } = el
    setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
  })
  const { x, y } = tipCorner(size, area, box, INSET)
  return (
    <div ref={ref} className="dr-style-tip" style={{ left: x, top: y }}>
      {[sizeLine(box), ...lines].map((line) => (
        <div key={line.prop} className="dr-style-line">
          <span className="dr-style-prop">{line.prop}</span>
          <span className="dr-style-value">
            {line.swatch && (
              <span className="dr-style-swatch" style={{ background: line.swatch }} />
            )}
            {line.value}
            {line.computed && <span className="dr-style-computed">{line.computed}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
