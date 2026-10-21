import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
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
  onGoToPin(rowId: string, target: PinTarget): void
  onRestoreState(rowId: string, target: PinTarget): void
  onOpenSource(rowId: string, target: PinTarget): void
  onOpenCountChange(n: number): void // feeds the toolbar's List count
}

const DEFAULT_WIDTH = 440
const MIN_WIDTH = 320

function maxWidth() {
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.7))
}

function clampWidth(w: number) {
  return Math.min(Math.max(MIN_WIDTH, Math.round(w)), maxWidth())
}

function readWidth(): number {
  const stored = Number(readKey("panel-width"))
  return clampWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_WIDTH)
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "review", label: "To review" },
  { value: "done", label: "Done" },
]

export const copyPromptText = (topic: string) =>
  `Work through the open points in docs/review/${topic}/ — follow packages/design-review/AGENTS.md.`

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
  onOpenCountChange,
}: PanelProps) {
  const [width, setWidth] = useState(readWidth)
  const [topics, setTopics] = useState<string[]>([])
  const [points, setPoints] = useState<Point[]>([])
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [records, setRecords] = useState<Record<string, PinRecord | null>>({})
  const inflight = useRef(new Map<string, Promise<PinRecord | null>>())
  const loadSeq = useRef(0)
  const drag = useRef(false)

  useEffect(() => {
    writeKey("panel-width", String(width))
  }, [width])

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w))
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
        setRecords({})
        inflight.current.clear()
      },
      (err) => {
        if (seq === loadSeq.current) setError(message(err))
      }
    )
  }, [topic])

  // A new topic starts from nothing.
  useEffect(() => {
    setPoints([])
    setLoaded(false)
    setError(null)
    load()
  }, [load])

  useTopicFeed(topic, load)

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
      const promise = fetch(fileUrl(topic, path))
        .then((res) => (res.ok ? (res.json() as Promise<PinRecord>) : null))
        .catch(() => null)
        .then((record) => {
          setRecords((r) => ({ ...r, [path]: record }))
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
    if (drag.current) setWidth(clampWidth(window.innerWidth - e.clientX))
  }
  const onResizeEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
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
        onDoubleClick={() => setWidth(clampWidth(DEFAULT_WIDTH))}
      />

      <header className="dr-panel-head">
        <TopicSelect
          topics={topics}
          topic={topic}
          onChange={onTopicChange}
          onCreate={onCreateTopic}
          onOpen={refreshTopics}
        />
        <button type="button" className="dr-button" onClick={onNewPoint} disabled={!topic}>
          ＋ New point
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

      <div className="dr-filters" role="radiogroup" aria-label="Filter by status">
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

      {error && (
        <div className="dr-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      <div className="dr-panel-body">
        {!topic ? (
          <p className="dr-empty">Choose a topic, or create one from the menu above.</p>
        ) : !loaded ? null : points.length === 0 ? (
          <p className="dr-empty">No points yet. Add one with ＋ New point or Pin &amp; add.</p>
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
            onGoToPin={onGoToPin}
            onRestoreState={onRestoreState}
            onOpenSource={onOpenSource}
          />
        )}
      </div>
    </aside>
  )
}
