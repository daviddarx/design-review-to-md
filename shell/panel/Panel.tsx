import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react"
import type { Op } from "../../model/ops.ts"
import type { PinRecord, Point } from "../../model/types.ts"
import { applyOp, createTopic, fileUrl, listTopics, readTopic, useTopicFeed } from "../api.ts"
import { readKey, writeKey } from "../prefs.ts"
import { counts, flattenRows } from "./listModel.ts"
import type { Filter, PinTarget } from "./listModel.ts"
import { PointList } from "./PointList.tsx"
import { ShortcutHelp } from "./ShortcutHelp.tsx"
import { TopicSelect } from "./TopicSelect.tsx"

export type PanelProps = {
  topic: string | null
  onTopicChange(t: string): void
  onNewPoint(): void
  onEditPoint(n: number): void
  // Go to pin / Restore state may answer with a notice for the panel to show
  // (the element is gone, the state file is missing).
  onGoToPin(rowId: string, target: PinTarget): PinAction
  onRestoreState(rowId: string, target: PinTarget): PinAction
  onOpenSource(rowId: string, target: PinTarget): PinAction
  onHoverPin(ownerRowId: string, record: PinRecord | null): void // a pinned row's hover, null when it ends
  onOpenCountChange(n: number): void // feeds the toolbar's List count
  drawer?: ReactNode // the point drawer, laid over everything but the resize edge
  reloadSignal?: number // a change refetches the topic (after a drawer save)
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

export const copyPromptText = (topic: string) =>
  `Work through the open feedback in docs/review/${topic}/ — follow packages/design-review/AGENTS.md.`

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Docked right in review mode. The left edge resizes it, and the frame
// beside it narrows for real.
export function Panel({
  topic,
  onTopicChange,
  onNewPoint,
  onEditPoint,
  onGoToPin,
  onRestoreState,
  onOpenSource,
  onHoverPin,
  onOpenCountChange,
  drawer,
  reloadSignal,
}: PanelProps) {
  const preferred = useRef(readPreferredWidth())
  const [width, setWidth] = useState(() => clampWidth(preferred.current))
  const [topics, setTopics] = useState<string[]>([])
  const [points, setPoints] = useState<Point[]>([])
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

  const refreshTopics = useCallback(() => {
    listTopics().then(setTopics, (err) => setError(message(err)))
  }, [])
  useEffect(refreshTopics, [refreshTopics])

  // A sequence number drops responses that a newer load has overtaken. Each
  // load also drops the cached pin records, since a re-pin rewrites them.
  const load = useCallback(() => {
    if (!topic) return
    const seq = ++loadSeq.current
    readTopic(topic).then(
      (data) => {
        if (seq !== loadSeq.current) return
        setPoints(data.points)
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
  }, [topic])

  // A new topic starts from nothing.
  useEffect(() => {
    setPoints([])
    setLoaded(false)
    setError(null)
    setLoadError(null)
    load()
  }, [load])

  useTopicFeed(topic, load)

  const lastReload = useRef(reloadSignal)
  useEffect(() => {
    if (reloadSignal === lastReload.current) return
    lastReload.current = reloadSignal
    load()
  }, [reloadSignal, load])

  // The drawer covers the list, a pick included (the drawer is what is
  // pickable then).
  const covered = Boolean(drawer)

  const tally = useMemo(() => counts(points), [points])
  const rows = useMemo(() => flattenRows(points, filter), [points, filter])

  useEffect(() => {
    onOpenCountChange(tally.open)
  }, [tally.open, onOpenCountChange])

  const loadRecord = useCallback(
    (path: string): Promise<PinRecord | null> => {
      if (!topic) return Promise.resolve(null)
      const pending = inflight.current.get(path)
      if (pending) return pending
      // A fetch overtaken by a reload must not refill the cache it cleared.
      const gen = cacheGen.current
      const promise = fetch(fileUrl(topic, path))
        .then((res) => (res.ok ? (res.json() as Promise<PinRecord>) : null))
        .catch(() => null)
        .then((record) => {
          if (gen === cacheGen.current) setRecords((r) => ({ ...r, [path]: record }))
          return record
        })
      inflight.current.set(path, promise)
      return promise
    },
    [topic]
  )

  // Ops refetch at once rather than waiting on the watcher; errors (409
  // locked, …) land in the inline message, never as a throw.
  const onOp = useCallback(
    async (rowId: string, op: Op): Promise<boolean> => {
      if (!topic) return false
      try {
        await applyOp(topic, Number(rowId.split(".")[0]), op)
        setError(null)
        load()
        return true
      } catch (err) {
        setError(message(err))
        return false
      }
    },
    [topic, load]
  )

  const withNotice =
    (action: (rowId: string, t: PinTarget) => PinAction) => (rowId: string, t: PinTarget) => {
      Promise.resolve(action(rowId, t)).then(
        (notice) => setError(notice || null), // success clears an old notice
        (err) => setError(message(err))
      )
    }

  const onCreateTopic = async (name: string) => {
    try {
      const created = await createTopic(name)
      setError(null)
      refreshTopics()
      onTopicChange(created.name)
    } catch (err) {
      setError(message(err))
      throw err
    }
  }

  const copyPrompt = async () => {
    if (!topic) return
    try {
      await navigator.clipboard.writeText(copyPromptText(topic))
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
        <TopicSelect
          topics={topics}
          topic={topic}
          onChange={onTopicChange}
          onCreate={onCreateTopic}
          onOpen={refreshTopics}
        />
        <button type="button" className="dr-button" onClick={onNewPoint} disabled={!topic}>
          ＋ New feedback
        </button>
        <button
          type="button"
          className="dr-button"
          onClick={copyPrompt}
          disabled={!topic}
          title={topic ? copyPromptText(topic) : undefined}
        >
          {copied ? "Copied" : "Copy prompt"}
        </button>
        <ShortcutHelp />
      </header>

      <div className="dr-filters" role="radiogroup" aria-label="Filter by status" inert={covered}>
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
        {!topic ? (
          <p className="dr-empty">Choose a review, or create one from the menu above.</p>
        ) : !loaded ? null : points.length === 0 ? (
          <p className="dr-empty">
            No feedback yet. Add some with ＋ New feedback or Pin &amp; add.
          </p>
        ) : rows.length === 0 ? (
          <p className="dr-empty">Nothing here with this status.</p>
        ) : (
          <PointList
            rows={rows}
            topic={topic}
            records={records}
            onLoadRecord={loadRecord}
            onOp={onOp}
            onEditPoint={onEditPoint}
            onGoToPin={withNotice(onGoToPin)}
            onRestoreState={withNotice(onRestoreState)}
            onOpenSource={withNotice(onOpenSource)}
            onHoverPin={onHoverPin}
          />
        )}
      </div>
      {drawer}
    </aside>
  )
}
