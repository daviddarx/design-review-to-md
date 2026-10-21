import { useEffect, useMemo, useRef, useState } from "react"
import type { PinRecord } from "../model/types.ts"
import { fileUrl, openEditor } from "./api.ts"
import { PointDrawer } from "./drawer/PointDrawer.tsx"
import type { CapturedPin } from "./drawer/draft.ts"
import { statePathOf } from "./panel/listModel.ts"
import type { PinTarget } from "./panel/listModel.ts"
import { Panel } from "./panel/Panel.tsx"
import { restoreLocalStorage } from "./pick/capture.ts"
import { goToPin } from "./pick/goToPin.ts"
import { PinMarkers } from "./pick/PinMarkers.tsx"
import type { Marker } from "./pick/PinMarkers.tsx"
import { usePicker } from "./pick/Picker.tsx"
import { readKey, writeKey } from "./prefs.ts"
import { Toolbar } from "./Toolbar.tsx"
import { useFrameUrl, initialFrameSrc } from "./useFrameUrl.ts"
import { useReviewMode } from "./useReviewMode.ts"
import { useShortcut } from "./useShortcut.ts"

type DrawerState = { key: number; pointNumber?: number; capture?: CapturedPin }

export const PIN_MISSING =
  "Not on screen as it was — the faded pin marks where you clicked. Restore state to see it as it was."
export const TOOL_PIN_MISSING = "That part of the review tool is not open now."

// ⌃P — Control, never Command (⌘P stays the browser's print).
export function isPinAndAdd(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "p"
}

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
  const [appendCapture, setAppendCapture] = useState<{ seq: number; capture: CapturedPin }>()
  const [drawerMarkers, setDrawerMarkers] = useState<Marker[]>([])
  const [hoverMarker, setHoverMarker] = useState<Marker | null>(null)
  const drawerSeq = useRef(0)
  const appendSeq = useRef(0)
  const drawerRef = useRef(drawer)
  useFrameUrl(frame)
  const picker = usePicker(frame)

  useEffect(() => {
    drawerRef.current = drawer
  }, [drawer])

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

  // Pin & add: pick first, then a new point whose title row carries the
  // pin — or, with a drawer already open, a new row in it (never a remount,
  // which would throw the draft away).
  const pinAndAdd = () => {
    if (!topic) return setListOpen(true)
    void picker.startPick().then((capture) => {
      if (!capture) return
      setListOpen(true)
      if (drawerRef.current) setAppendCapture({ seq: ++appendSeq.current, capture })
      else setDrawer({ key: ++drawerSeq.current, capture })
    })
  }

  useShortcut(frame, review, isPinAndAdd, pinAndAdd)

  // Leaving review mode ends a pick.
  useEffect(() => {
    if (!review) picker.cancel()
  }, [review, picker.cancel])

  // Only the row that set the hover marker may clear it: leaving one row and
  // entering the next can arrive in either order.
  const onHoverPin = (ownerRowId: string, record: PinRecord | null) => {
    const step = record?.steps[0]
    if (step) setHoverMarker({ key: `hover:${ownerRowId}`, label: ownerRowId, step })
    else setHoverMarker((m) => (m?.label === ownerRowId ? null : m))
  }
  const markers = useMemo(
    () => (hoverMarker ? [...drawerMarkers, hoverMarker] : drawerMarkers),
    [drawerMarkers, hoverMarker]
  )

  const onGoToPin = async (_rowId: string, target: PinTarget) => {
    if (!frame) return
    if (!target.record) return `No pin record for ${target.ownerRowId} — it cannot be found again.`
    const result = await goToPin(frame, target.record, picker.flash)
    if (result === "found") return null
    return target.record.steps[0]?.inTool ? TOOL_PIN_MISSING : PIN_MISSING
  }

  // After the panel's own confirm. The snapshot is gitignored, so a pin
  // made on another machine has none.
  const onRestoreState = async (_rowId: string, target: PinTarget) => {
    if (!topic || !frame) return
    const res = await fetch(fileUrl(topic, statePathOf(target.recordPath))).catch(() => null)
    if (!res?.ok) {
      return `No saved state for ${target.ownerRowId} on this machine — state files are not committed.`
    }
    const snapshot: unknown = await res.json().catch(() => null)
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return `The saved state of ${target.ownerRowId} is unreadable.`
    }
    restoreLocalStorage(snapshot as Record<string, unknown>)
    frame.contentWindow?.location.reload()
    return null
  }

  // Only an API error (a refused file or line) reaches the panel's notice;
  // a missing `code` binary is only logged by the server.
  const onOpenSource = async (_rowId: string, target: PinTarget) => {
    const source = target.record?.steps.at(-1)?.element.source
    if (source) await openEditor(source.file, source.line)
    return null
  }

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
            onGoToPin={onGoToPin}
            onRestoreState={onRestoreState}
            onOpenSource={onOpenSource}
            onHoverPin={onHoverPin}
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
                  startPick={() => picker.startPick()}
                  appendCapture={appendCapture}
                  focusSignal={drawerFocus}
                  onSaved={() => setReloadSignal((n) => n + 1)}
                  onClose={() => setDrawer(null)}
                  onPinsChange={setDrawerMarkers}
                />
              )
            }
          />
        </div>
      )}
      {review && (
        <Toolbar
          bounds={frame}
          hidden={picker.hideToolbar}
          onPinAndAdd={pinAndAdd}
          onNewPoint={() => openDrawer()}
          onToggleList={() => setListOpen((v) => !v)}
          onExit={() => setReview(false)}
          listCount={openCount}
        />
      )}
      <PinMarkers frame={frame} markers={markers} hidden={!review || picker.picking} />
      {picker.layer}
    </div>
  )
}
