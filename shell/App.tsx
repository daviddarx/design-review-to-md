import { useEffect, useState } from "react"
import { Panel } from "./panel/Panel.tsx"
import { readKey, writeKey } from "./prefs.ts"
import { Toolbar } from "./Toolbar.tsx"
import { useFrameUrl, initialFrameSrc } from "./useFrameUrl.ts"
import { useReviewMode } from "./useReviewMode.ts"

const noop = () => {}

// The app in a same-origin frame. Review off: the frame fills the window
// and nothing else shows. Review on: frame + panel side by side, the
// toolbar floating above the frame. The frame is always the first child,
// so toggling review mode never remounts (reloads) the app. The panel stays
// mounted while the List button hides it, so the toolbar's count stays live.
export function App() {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const [src] = useState(initialFrameSrc)
  const [review, setReview] = useReviewMode(frame)
  const [listOpen, setListOpen] = useState(true)
  const [topic, setTopic] = useState(() => readKey("topic"))
  const [openCount, setOpenCount] = useState(0)
  useFrameUrl(frame)

  useEffect(() => {
    if (topic) writeKey("topic", topic)
  }, [topic])

  return (
    <div className={review ? "dr-root dr-review" : "dr-root"}>
      <iframe ref={setFrame} className="dr-frame" src={src} title="App under review" />
      {review && (
        <div className={listOpen ? "dr-panel-host" : "dr-panel-host dr-hidden"}>
          <Panel
            topic={topic}
            onTopicChange={setTopic}
            onNewPoint={noop}
            onEditPoint={noop}
            onGoToPin={noop}
            onRestoreState={noop}
            onOpenSource={noop}
            onOpenCountChange={setOpenCount}
          />
        </div>
      )}
      {review && (
        <Toolbar
          bounds={frame}
          onPinAndAdd={noop}
          onNewPoint={noop}
          onToggleList={() => setListOpen((v) => !v)}
          onExit={() => setReview(false)}
          listCount={openCount}
        />
      )}
    </div>
  )
}
