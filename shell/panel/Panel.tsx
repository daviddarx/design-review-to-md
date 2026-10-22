import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react"
import type { Op } from "../../model/ops.ts"
import type { PinRecord, Feedback } from "../../model/types.ts"
import { applyOp, createReview, fileUrl, listReviews, readReview, useReviewFeed } from "../api.ts"
import { readKey, writeKey } from "../prefs.ts"
import { Icon } from "./icons.tsx"
import { counts, flattenRows, pinRecordPath } from "./listModel.ts"
import type { Filter, PinTarget } from "./listModel.ts"
import { FeedbackList } from "./FeedbackList.tsx"
import { ShortcutHelp } from "./ShortcutHelp.tsx"
import { ReviewSelect } from "./ReviewSelect.tsx"

export type PanelProps = {
  review: string | null
  onReviewChange(t: string): void
  onNewFeedback(): void
  onEditFeedback(n: number): void
  // Show pins / Restore state may answer with a notice for the panel to show
  // (the element is gone, the state file is missing).
  onTogglePins(rowId: string, target: PinTarget): PinAction
  onRestoreState(rowId: string, target: PinTarget): PinAction
  onOpenSource(rowId: string, target: PinTarget): PinAction
  onPeekPins(ownerRowId: string, records: PinRecord[] | null): void // Show pins hovered, null when it ends
  shownPinsOwner: string | null // the row whose pins Show pins keeps on screen
  onAllPins(groups: { owner: string; records: PinRecord[] }[]): void // every pinned row's pins, after each load
  drawer?: ReactNode // the feedback drawer, laid over everything but the resize edge
  reloadSignal?: number // a change refetches the review (after a drawer save)
}

type PinAction = void | Promise<string | null | void>

const DEFAULT_WIDTH = 440
const MIN_WIDTH = 320

function maxWidth() {
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.7))
}

function clampWidth(w: number) {
  return Math.min(Math.max(MIN_WIDTH, Math.round(w)), maxWidth())
}

// The width he chose; the window only ever narrows what is shown, never
// what is stored.
function readPreferredWidth(): number {
  const stored = Number(readKey("panel-width"))
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_WIDTH
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "review", label: "To review" },
  { value: "done", label: "Done" },
]

export const copyPromptText = (review: string) =>
  `Commit review folder (docs/review/${review}) and work through its open feedbacks — follow packages/design-review/AGENTS.md.`

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Docked right in review mode. The left edge resizes it, and the frame
// beside it narrows for real.
export function Panel({
  review,
  onReviewChange,
  onNewFeedback,
  onEditFeedback,
  onTogglePins,
  onRestoreState,
  onOpenSource,
  onPeekPins,
  shownPinsOwner,
  onAllPins,
  drawer,
  reloadSignal,
}: PanelProps) {
  const preferred = useRef(readPreferredWidth())
  const [width, setWidth] = useState(() => clampWidth(preferred.current))
  const [reviews, setReviews] = useState<string[]>([])
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([])
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null) // cleared by the next good load
  const [copied, setCopied] = useState(false)
  const [records, setRecords] = useState<Record<string, PinRecord | null>>({})
  const inflight = useRef(new Map<string, Promise<PinRecord | null>>())
  const loadSeq = useRef(0)
  const cacheGen = useRef(0) // bumped whenever the pin-record cache is dropped
  const drag = useRef(false)

  const setPreferredWidth = (w: number) => {
    preferred.current = clampWidth(w)
    setWidth(preferred.current)
  }
  const persistWidth = () => writeKey("panel-width", String(preferred.current))

  useEffect(() => {
    const onResize = () => setWidth(clampWidth(preferred.current))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const refreshReviews = useCallback(() => {
    listReviews().then(setReviews, (err) => setError(message(err)))
  }, [])
  useEffect(refreshReviews, [refreshReviews])

  // A sequence number drops responses that a newer load has overtaken. Each
  // load also drops the cached pin records, since a re-pin rewrites them.
  const load = useCallback(() => {
    if (!review) return
    const seq = ++loadSeq.current
    readReview(review).then(
      (data) => {
        if (seq !== loadSeq.current) return
        setFeedbacks(data.feedbacks)
        setLoaded(true)
        setLoadError(null)
        cacheGen.current++
        setRecords({})
        inflight.current.clear()
      },
      (err) => {
        if (seq === loadSeq.current) setLoadError(message(err))
      }
    )
  }, [review])

  // A new review starts from nothing.
  useEffect(() => {
    setFeedbacks([])
    setLoaded(false)
    setError(null)
    setLoadError(null)
    load()
  }, [load])

  useReviewFeed(review, load)

  const lastReload = useRef(reloadSignal)
  useEffect(() => {
    if (reloadSignal === lastReload.current) return
    lastReload.current = reloadSignal
    load()
  }, [reloadSignal, load])

  // The drawer covers the list, a pick included (the drawer is what is
  // pickable then).
  const covered = Boolean(drawer)

  // The drawer slides in over a dimming backdrop and slides back out before
  // it goes: the closed drawer stays rendered (inert, same tree position, so
  // not remounted) until its exit animation ends.
  const lastDrawer = useRef<ReactNode>(null)
  if (drawer) lastDrawer.current = drawer
  const [leaving, setLeaving] = useState<ReactNode>(null)
  const [wasOpen, setWasOpen] = useState(covered)
  if (covered !== wasOpen) {
    setWasOpen(covered)
    setLeaving(covered ? null : lastDrawer.current)
  }

  const tally = useMemo(() => counts(feedbacks), [feedbacks])
  const rows = useMemo(() => flattenRows(feedbacks, filter), [feedbacks, filter])

  const loadRecord = useCallback(
    (path: string): Promise<PinRecord | null> => {
      if (!review) return Promise.resolve(null)
      const pending = inflight.current.get(path)
      if (pending) return pending
      // A fetch overtaken by a reload must not refill the cache it cleared.
      const gen = cacheGen.current
      const promise = fetch(fileUrl(review, path))
        .then((res) => (res.ok ? (res.json() as Promise<PinRecord>) : null))
        .catch(() => null)
        .then((record) => {
          if (gen === cacheGen.current) setRecords((r) => ({ ...r, [path]: record }))
          return record
        })
      inflight.current.set(path, promise)
      return promise
    },
    [review]
  )

  // Every pin of the review, for the page to show while nothing is picked
  // out (all rows, whatever the filter).
  useEffect(() => {
    let live = true
    const pinned = flattenRows(feedbacks, "all").filter((r) => r.pins.length)
    void Promise.all(
      pinned.map(async (r) => {
        const paths = r.pins.map((pin, i) => pinRecordPath(pin, r.rowId, i, r.folder))
        const records = await Promise.all(paths.map(loadRecord))
        return { owner: r.rowId, records: records.filter((x): x is PinRecord => x !== null) }
      })
    ).then((groups) => live && onAllPins(groups))
    return () => {
      live = false
    }
  }, [feedbacks, loadRecord, onAllPins])

  // Ops refetch at once rather than waiting on the watcher; errors (409
  // locked, …) land in the inline message, never as a throw.
  const onOp = useCallback(
    async (rowId: string, op: Op): Promise<boolean> => {
      if (!review) return false
      try {
        await applyOp(review, Number(rowId.split(".")[0]), op)
        setError(null)
        load()
        return true
      } catch (err) {
        setError(message(err))
        return false
      }
    },
    [review, load]
  )

  const withNotice =
    (action: (rowId: string, t: PinTarget) => PinAction) => (rowId: string, t: PinTarget) => {
      Promise.resolve(action(rowId, t)).then(
        (notice) => setError(notice || null), // success clears an old notice
        (err) => setError(message(err))
      )
    }

  const onCreateReview = async (name: string) => {
    try {
      const created = await createReview(name)
      setError(null)
      refreshReviews()
      onReviewChange(created.name)
    } catch (err) {
      setError(message(err))
      throw err
    }
  }

  const copyPrompt = async () => {
    if (!review) return
    try {
      await navigator.clipboard.writeText(copyPromptText(review))
      setCopied(true)
    } catch (err) {
      setError(`Could not copy: ${message(err)}`)
    }
  }
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])

  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    drag.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) setPreferredWidth(window.innerWidth - e.clientX)
  }
  const onResizeEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) persistWidth()
    drag.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <aside className="dr-panel" aria-label="Feedback panel" style={{ width }}>
      <div
        className="dr-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={() => {
          setPreferredWidth(DEFAULT_WIDTH)
          persistWidth()
        }}
      />

      <header className="dr-panel-head" inert={covered}>
        <ReviewSelect
          reviews={reviews}
          review={review}
          onChange={onReviewChange}
          onCreate={onCreateReview}
          onOpen={refreshReviews}
        />
        <button
          type="button"
          className="dr-button"
          onClick={copyPrompt}
          disabled={!review}
          title={review ? copyPromptText(review) : undefined}
        >
          {/* Keeps the button as wide as "Copy prompt" while it reads "Copied". */}
          <span className="dr-swap" data-reserve="Copy prompt">
            {copied ? (
              <span className="dr-copied">
                <Icon name="validate" />
                Copied
              </span>
            ) : (
              <span>Copy prompt</span>
            )}
          </span>
        </button>
      </header>

      <div className="dr-filters" inert={covered}>
        <div className="dr-filter-tabs" role="radiogroup" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={filter === f.value}
              className="dr-chip"
              onClick={() => setFilter(f.value)}
            >
              {f.label}{" "}
              <span className="dr-chip-count">
                {f.value === "all" ? tally.open + tally.review + tally.done : tally[f.value]}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="dr-button dr-button-primary"
          onClick={onNewFeedback}
          disabled={!review}
        >
          ＋ New feedback
        </button>
      </div>

      {(error ?? loadError) && (
        <div className="dr-error" role="alert">
          <span>{error ?? loadError}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setError(null)
              setLoadError(null)
            }}
          >
            ×
          </button>
        </div>
      )}

      <div className="dr-panel-body" inert={covered}>
        {!review ? (
          <p className="dr-empty">Choose a review, or create one from the menu above.</p>
        ) : !loaded ? null : feedbacks.length === 0 ? (
          <p className="dr-empty">No feedback yet</p>
        ) : rows.length === 0 ? (
          <p className="dr-empty">Nothing here with this status.</p>
        ) : (
          <FeedbackList
            rows={rows}
            review={review}
            records={records}
            onLoadRecord={loadRecord}
            onOp={onOp}
            onEditFeedback={onEditFeedback}
            onTogglePins={withNotice(onTogglePins)}
            onRestoreState={withNotice(onRestoreState)}
            onOpenSource={withNotice(onOpenSource)}
            onPeekPins={onPeekPins}
            shownPinsOwner={shownPinsOwner}
          />
        )}
      </div>
      <footer className="dr-panel-foot" inert={covered}>
        <ShortcutHelp />
      </footer>
      {(drawer || leaving) && (
        <div
          className={["dr-drawer-layer", !drawer && "dr-leaving"].filter(Boolean).join(" ")}
          inert={!drawer}
          onAnimationEnd={(e) => {
            if (!drawer && (e.target as Element).classList.contains("dr-drawer")) setLeaving(null)
          }}
        >
          <div className="dr-drawer-backdrop" />
          {drawer ?? leaving}
        </div>
      )}
    </aside>
  )
}
