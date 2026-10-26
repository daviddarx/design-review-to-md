import { sizeLine } from "./styles.ts"
import type { StyleLine } from "./styles.ts"

type Box = { x: number; y: number; width: number; height: number }

const INSET = 12

// The hovered element's style overview, in the app's bottom-right corner:
// its rendered size first, then what its stylesheets set.
export function StyleTip({ box, area, lines }: { box: Box; area: Box; lines: StyleLine[] }) {
  return (
    <div
      className="dr-style-tip"
      style={{
        right: window.innerWidth - (area.x + area.width) + INSET,
        bottom: window.innerHeight - (area.y + area.height) + INSET,
      }}
    >
      {[sizeLine(box), ...lines].map((line) => (
        <div key={line.prop} className="dr-style-line">
          <span className="dr-style-prop">{line.prop}</span>
          <span className="dr-style-value">
            {line.swatch && (
              <span className="dr-style-swatch" style={{ background: line.swatch }} />
            )}
            {line.value}
          </span>
        </div>
      ))}
    </div>
  )
}
