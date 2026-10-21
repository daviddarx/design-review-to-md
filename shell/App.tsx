import { useState } from "react"
import { Toolbar } from "./Toolbar.tsx"
import { useFrameUrl, initialFrameSrc } from "./useFrameUrl.ts"
import { useReviewMode } from "./useReviewMode.ts"

// The app in a same-origin frame. Review off: the frame fills the window
// and nothing else shows. Review on: frame + panel slot side by side, the
// toolbar floating above. The frame is always the first child, so toggling
// review mode never remounts (reloads) the app.
export function App() {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const [src] = useState(initialFrameSrc)
  const [review, setReview] = useReviewMode(frame)
  const [listOpen, setListOpen] = useState(true)
  useFrameUrl(frame)

  return (
    <div className={review ? "dr-root dr-review" : "dr-root"}>
      <iframe ref={setFrame} className="dr-frame" src={src} title="App under review" />
      {review && listOpen && <aside className="dr-panel-slot" aria-label="Feedback panel" />}
      {review && (
        <Toolbar
          onPinAndAdd={() => {}}
          onNewPoint={() => {}}
          onToggleList={() => setListOpen((v) => !v)}
          onExit={() => setReview(false)}
          listCount={0}
        />
      )}
    </div>
  )
}
