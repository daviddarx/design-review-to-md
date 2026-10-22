import { useEffect, useMemo, useRef, useState } from "react"
import type { PinRecord } from "../model/types.ts"
import { fileUrl, openEditor } from "./api.ts"
import { FeedbackDrawer } from "./drawer/FeedbackDrawer.tsx"
import type { CapturedPin } from "./drawer/draft.ts"
import { statePathOf } from "./panel/listModel.ts"
import type { PinTarget } from "./panel/listModel.ts"
import { Panel } from "./panel/Panel.tsx"
import { restoreLocalStorage } from "./pick/capture.ts"
import { goToPin } from "./pick/goToPin.ts"
import { useKeepCanvasPixels } from "./pick/keepCanvasPixels.ts"
import { PinMarkers } from "./pick/PinMarkers.tsx"
import type { Marker } from "./pick/PinMarkers.tsx"
import { usePicker } from "./pick/Picker.tsx"
import { readKey, writeKey } from "./prefs.ts"
import { useFrameUrl, initialFrameSrc } from "./useFrameUrl.ts"
import { useReviewMode } from "./useReviewMode.ts"
import { useShortcut } from "./useShortcut.ts"

type DrawerState = { key: number; feedbackNumber?: number; capture?: CapturedPin }

// The pins of one list row, drawn on the page.
type OwnedMarkers = { owner: string; markers: Marker[] }

function ownedMarkers(owner: string, records: PinRecord[], tag: string): OwnedMarkers {
  const markers = records.flatMap((record, i) => {
    const step = record.steps[0]
    return step ? [{ key: `${tag}:${owner}:${i}`, label: owner, step }] : []
  })
  return { owner, markers }
}

export const PIN_MISSING =
  "Not on screen as it was — the faded pin marks where you clicked. Restore the corresponding app state to see it as it was."
export const TOOL_PIN_MISSING = "That part of the review tool is not open now."

// ⌃P — Control, never Command (⌘P stays the browser's print).
export function isPinAndAdd(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "p"
}

// The app in a same-origin frame. Review off: the frame fills the window
// and nothing else shows. Review on: frame + panel side by side. The frame
// is always the first child, so toggling review mode never remounts
// (reloads) the app. Once shown, the panel stays mounted — hidden when
// leaving review mode — so an open drawer keeps its draft.
export function App() {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const [src] = useState(initialFrameSrc)
  const [reviewMode, setReviewMode] = useReviewMode(frame)
  const [review, setReview] = useState(() => readKey("review") ?? readKey("topic")) // "topic": the key before the rename
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  const [reloadSignal, setReloadSignal] = useState(0)
  const [drawerFocus, setDrawerFocus] = useState(0)
  const [panelMounted, setPanelMounted] = useState(reviewMode)
  if (reviewMode && !panelMounted) setPanelMounted(true)
  const [appendCapture, setAppendCapture] = useState<{ seq: number; capture: CapturedPin }>()
  const [drawerMarkers, setDrawerMarkers] = useState<Marker[]>([])
  const [peeked, setPeeked] = useState<OwnedMarkers | null>(null) // Show pins hovered
  const [shown, setShown] = useState<OwnedMarkers | null>(null) // Show pins toggled on
  const drawerSeq = useRef(0)
  const appendSeq = useRef(0)
  const drawerRef = useRef(drawer)
  useFrameUrl(frame)
  useKeepCanvasPixels(frame) // the app's maps show in screenshots
  const picker = usePicker(frame)

  useEffect(() => {
    drawerRef.current = drawer
  }, [drawer])

  // Needs a review. An open drawer is never replaced (that would throw its
  // draft away): it is focused instead.
  const openDrawer = (open: { feedbackNumber?: number; capture?: CapturedPin } = {}) => {
    if (drawer) return setDrawerFocus((n) => n + 1)
    if (!review) return
    setDrawer({ key: ++drawerSeq.current, ...open })
  }

  // One drawer belongs to one review.
  useEffect(() => setDrawer(null), [review])

  // Pin & add: pick first, then a new feedback whose title row carries the
  // pin — or, with a drawer already open, a new row in it (never a remount,
  // which would throw the draft away).
  const pinAndAdd = () => {
    if (!review) return
    void picker.startPick().then((capture) => {
      if (!capture) return
      if (drawerRef.current) setAppendCapture({ seq: ++appendSeq.current, capture })
      else setDrawer({ key: ++drawerSeq.current, capture })
    })
  }

  useShortcut(frame, reviewMode, isPinAndAdd, pinAndAdd)

  // Leaving review mode ends a pick.
  useEffect(() => {
    if (!reviewMode) picker.cancel()
  }, [reviewMode, picker.cancel])

  // Only the button that set the peeked markers may clear them: leaving one
  // and entering the next can arrive in either order.
  const onPeekPins = (ownerRowId: string, records: PinRecord[] | null) => {
    if (records) setPeeked(ownedMarkers(ownerRowId, records, "peek"))
    else setPeeked((m) => (m?.owner === ownerRowId ? null : m))
  }
  const markers = useMemo(() => {
    const out = [...drawerMarkers, ...(shown?.markers ?? [])]
    if (peeked && peeked.owner !== shown?.owner) out.push(...peeked.markers)
    return out
  }, [drawerMarkers, shown, peeked])

  // Show pins on: the frame goes to the first pin's page and outlines its
  // element, and the row's pins stay drawn until it is switched off (or
  // another row's are switched on).
  const onTogglePins = async (_rowId: string, target: PinTarget) => {
    if (shown?.owner === target.ownerRowId) {
      setShown(null)
      return null
    }
    if (!frame) return
    const records = target.pins.flatMap((p) => (p.record ? [p.record] : []))
    if (!records.length) return `No pin record for ${target.ownerRowId} — it cannot be found again.`
    setShown(ownedMarkers(target.ownerRowId, records, "shown"))
    const result = await goToPin(frame, records[0], picker.flash)
    if (result === "found") return null
    return records[0].steps[0]?.inTool ? TOOL_PIN_MISSING : PIN_MISSING
  }
  useEffect(() => setShown(null), [review])

  // After the panel's own confirm; the first pin's snapshot. It is
  // gitignored, so a pin made on another machine has none.
  const onRestoreState = async (_rowId: string, target: PinTarget) => {
    const first = target.pins[0]
    if (!review || !frame || !first) return
    const res = await fetch(fileUrl(review, statePathOf(first.recordPath))).catch(() => null)
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
    const source = target.pins.map((p) => p.record?.steps.at(-1)?.element.source).find(Boolean)
    if (source) await openEditor(source.file, source.line)
    return null
  }

  useEffect(() => {
    if (review) writeKey("review", review)
  }, [review])

  return (
    <div className={reviewMode ? "dr-root dr-review" : "dr-root"}>
      <iframe ref={setFrame} className="dr-frame" src={src} title="App under review" />
      {panelMounted && (
        <div className={["dr-panel-host", !reviewMode && "dr-hidden"].filter(Boolean).join(" ")}>
          <Panel
            review={review}
            onReviewChange={setReview}
            onNewFeedback={() => openDrawer()}
            onEditFeedback={(n) => openDrawer({ feedbackNumber: n })}
            onTogglePins={onTogglePins}
            onRestoreState={onRestoreState}
            onOpenSource={onOpenSource}
            onPeekPins={onPeekPins}
            shownPinsOwner={shown?.owner ?? null}
            reloadSignal={reloadSignal}
            drawer={
              drawer &&
              review && (
                <FeedbackDrawer
                  key={drawer.key}
                  review={review}
                  feedbackNumber={drawer.feedbackNumber}
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
      <PinMarkers frame={frame} markers={markers} hidden={!reviewMode || picker.picking} />
      {picker.layer}
    </div>
  )
}
