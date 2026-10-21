import { useEffect, useRef, useState } from "react"
import { PointDrawer } from "./drawer/PointDrawer.tsx"
import type { CapturedPin } from "./drawer/draft.ts"
import { Panel } from "./panel/Panel.tsx"
import { readKey, writeKey } from "./prefs.ts"
import { Toolbar } from "./Toolbar.tsx"
import { useFrameUrl, initialFrameSrc } from "./useFrameUrl.ts"
import { useReviewMode } from "./useReviewMode.ts"

const noop = () => {}

type DrawerState = { key: number; pointNumber?: number; capture?: CapturedPin }

// The app in a same-origin frame. Review off: the frame fills the window
// and nothing else shows. Review on: frame + panel side by side, the
// toolbar floating above the frame. The frame is always the first child,
// so toggling review mode never remounts (reloads) the app. Once shown, the
// panel stays mounted — hidden by List and by leaving review mode — so the
// toolbar's count stays live and an open drawer keeps its draft.
export function App() {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const [src] = useState(initialFrameSrc)
  const [review, setReview] = useReviewMode(frame)
  const [listOpen, setListOpen] = useState(true)
  const [topic, setTopic] = useState(() => readKey("topic"))
  const [openCount, setOpenCount] = useState(0)
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  const [reloadSignal, setReloadSignal] = useState(0)
  const [drawerFocus, setDrawerFocus] = useState(0)
  const [panelMounted, setPanelMounted] = useState(review)
  if (review && !panelMounted) setPanelMounted(true)
  const drawerSeq = useRef(0)
  useFrameUrl(frame)

  // The drawer lives inside the panel, so opening it shows the panel. With
  // no topic yet, New point only reveals the panel, which asks for one. An
  // open drawer is never replaced (that would throw its draft away): it is
  // focused instead.
  const openDrawer = (open: { pointNumber?: number; capture?: CapturedPin } = {}) => {
    setListOpen(true)
    if (drawer) return setDrawerFocus((n) => n + 1)
    if (!topic) return
    setDrawer({ key: ++drawerSeq.current, ...open })
  }

  // One drawer belongs to one topic.
  useEffect(() => setDrawer(null), [topic])

  useEffect(() => {
    if (topic) writeKey("topic", topic)
  }, [topic])

  return (
    <div className={review ? "dr-root dr-review" : "dr-root"}>
      <iframe ref={setFrame} className="dr-frame" src={src} title="App under review" />
      {panelMounted && (
        <div
          className={["dr-panel-host", !(review && listOpen) && "dr-hidden"]
            .filter(Boolean)
            .join(" ")}
        >
          <Panel
            topic={topic}
            onTopicChange={setTopic}
            onNewPoint={() => openDrawer()}
            onEditPoint={(n) => openDrawer({ pointNumber: n })}
            onGoToPin={noop}
            onRestoreState={noop}
            onOpenSource={noop}
            onOpenCountChange={setOpenCount}
            reloadSignal={reloadSignal}
            drawer={
              drawer &&
              topic && (
                <PointDrawer
                  key={drawer.key}
                  topic={topic}
                  pointNumber={drawer.pointNumber}
                  initialCapture={drawer.capture}
                  focusSignal={drawerFocus}
                  onSaved={() => setReloadSignal((n) => n + 1)}
                  onClose={() => setDrawer(null)}
                />
              )
            }
          />
        </div>
      )}
      {review && (
        <Toolbar
          bounds={frame}
          onPinAndAdd={noop}
          onNewPoint={() => openDrawer()}
          onToggleList={() => setListOpen((v) => !v)}
          onExit={() => setReview(false)}
          listCount={openCount}
        />
      )}
    </div>
  )
}
