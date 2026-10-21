import { useEffect, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import type { Op } from "../../model/ops.ts"
import type { PinRecord, PinRef } from "../../model/types.ts"
import { fileUrl } from "../api.ts"
import { pinRecordPath, singleLine } from "./listModel.ts"
import type { FlatRow, PinTarget } from "./listModel.ts"

export type RowItemProps = {
  row: FlatRow
  topic: string
  owner: { rowId: string; pin: PinRef } | undefined // the pin this row uses, own or inherited
  record: PinRecord | null | undefined // undefined: not fetched yet
  onLoadRecord(): Promise<PinRecord | null>
  onOp(op: Op): Promise<boolean>
  onEditPoint(n: number): void
  onGoToPin(rowId: string, target: PinTarget): void
  onRestoreState(rowId: string, target: PinTarget): void
  onOpenSource(rowId: string, target: PinTarget): void
}

// True while the user types: panel keys must not fire inside a field.
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

export function RowItem({
  row,
  topic,
  owner,
  record,
  onLoadRecord,
  onOp,
  onEditPoint,
  onGoToPin,
  onRestoreState,
  onOpenSource,
}: RowItemProps) {
  const [refining, setRefining] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shotOpen, setShotOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const label = row.rowId.split(".").at(-1)
  const pointNumber = Number(row.rowId.split(".")[0])
  const source = record?.steps.at(-1)?.element.source

  const run = async (op: Op) => {
    if (busy) return false
    setBusy(true)
    try {
      return await onOp(op)
    } finally {
      setBusy(false)
    }
  }

  const validate = () => {
    if (row.status !== "done") void run({ kind: "setStatus", rowId: row.rowId, status: "done" })
  }
  const startRefine = () => setRefining(row.text)
  const toggleHistory = () => setHistoryOpen((v) => !v)

  const submitRefine = async (li: HTMLElement | null) => {
    const text = singleLine(refining ?? "")
    if (text && text !== row.text) {
      if (!(await run({ kind: "refine", rowId: row.rowId, text }))) return
    }
    setRefining(null)
    li?.focus()
  }

  const target = async (): Promise<PinTarget | null> => {
    if (!owner) return null
    const rec = record === undefined ? await onLoadRecord() : record
    return {
      ownerRowId: owner.rowId,
      pin: owner.pin,
      recordPath: pinRecordPath(owner.pin, owner.rowId),
      record: rec,
    }
  }
  const withTarget = (fn: (rowId: string, t: PinTarget) => void) => async () => {
    const t = await target()
    if (t) fn(row.rowId, t)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLLIElement>) => {
    // The restore confirm owns the keyboard while it is open.
    if (confirming || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
    const key = e.key.toLowerCase()
    if (key === "v") validate()
    else if (key === "r") startRefine()
    else if (key === "h") toggleHistory()
    else return
    e.preventDefault()
  }

  // The pin record is fetched when the row is first hovered or focused, and
  // again after a reload dropped the cache while the row was still active.
  const prefetch = () => {
    if (owner && record === undefined) void onLoadRecord()
  }
  const liRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (liRef.current?.matches(":hover, :focus-within")) prefetch()
  })

  return (
    <li
      ref={liRef}
      // Joined, not concatenated: prettier-plugin-tailwindcss trims the
      // leading space of a class string inside a template literal.
      className={["dr-row", `dr-depth-${row.depth}`, busy && "dr-busy"].filter(Boolean).join(" ")}
      data-row-id={row.rowId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onMouseLeave={() => setShotOpen(false)}
    >
      {historyOpen && (
        <ol className="dr-history" aria-label={`History of ${row.rowId}`}>
          {row.history.length === 0 && <li className="dr-history-empty">No earlier versions</li>}
          {row.history.map((h, i) => (
            <li key={i}>
              <span className="dr-history-kind">{h.kind === "before" ? "Before:" : "Claude:"}</span>{" "}
              {h.text}
            </li>
          ))}
        </ol>
      )}

      <div className="dr-row-main">
        <span className="dr-row-num">{label}.</span>
        {refining === null ? (
          <span className="dr-row-text">{row.text}</span>
        ) : (
          <textarea
            className="dr-input dr-refine"
            aria-label={`Refine ${row.rowId}`}
            autoFocus
            rows={2}
            value={refining}
            disabled={busy}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setRefining(e.target.value)}
            onKeyDown={(e) => {
              const li = e.currentTarget.closest("li")
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void submitRefine(li)
              } else if (e.key === "Escape") {
                e.preventDefault()
                e.stopPropagation()
                setRefining(null)
                li?.focus()
              }
            }}
          />
        )}
        <span className="dr-row-tags">
          {row.history.length > 0 && !historyOpen && (
            <span className="dr-history-dot" title="Has history (H)" aria-hidden="true" />
          )}
          {row.pin && (
            <span className="dr-pin" title="Pinned">
              📍
            </span>
          )}
          {row.inheritedPinFrom && (
            <span
              className="dr-pin dr-pin-inherited"
              title={`Uses the pin of ${row.inheritedPinFrom}`}
            >
              📍 from {row.inheritedPinFrom}
            </span>
          )}
          {row.status && <span className={`dr-status dr-status-${row.status}`}>{row.status}</span>}
        </span>
      </div>

      {refining === null && (
        <div className="dr-row-actions">
          {row.depth === 0 && (
            <button type="button" title="Edit point" onClick={() => onEditPoint(pointNumber)}>
              Edit
            </button>
          )}
          {row.status !== "done" && (
            <button type="button" title="Validate (V)" onClick={validate}>
              Validate
            </button>
          )}
          <button type="button" title="Refine (R)" onClick={startRefine}>
            Refine
          </button>
          <button
            type="button"
            title="History (H)"
            aria-pressed={historyOpen}
            aria-label="History"
            onClick={toggleHistory}
          >
            🕘
          </button>
          {owner && (
            <>
              <button type="button" title="Go to pin" onClick={withTarget(onGoToPin)}>
                Go to pin
              </button>
              <button
                type="button"
                title="Screenshot"
                aria-expanded={shotOpen}
                onClick={() => setShotOpen((v) => !v)}
              >
                Screenshot
              </button>
              <button type="button" title="Restore state" onClick={() => setConfirming(true)}>
                Restore state
              </button>
              {source && (
                <button
                  type="button"
                  title={`Open ${source.file}:${source.line} in VS Code`}
                  onClick={withTarget(onOpenSource)}
                >
                  Open in VS Code
                </button>
              )}
            </>
          )}
        </div>
      )}

      {shotOpen && owner && (
        <a
          className="dr-shot"
          href={fileUrl(topic, owner.pin.screenshot)}
          target="_blank"
          rel="noreferrer"
          title="Open full size"
        >
          <img src={fileUrl(topic, owner.pin.screenshot)} alt={`Screenshot of ${owner.rowId}`} />
        </a>
      )}

      {confirming && owner && (
        <div
          className="dr-confirm"
          role="alertdialog"
          aria-label="Restore state"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return
            e.preventDefault()
            e.stopPropagation()
            setConfirming(false)
            e.currentTarget.closest("li")?.focus()
          }}
        >
          <span>Replace the app's current localStorage with the state saved at {owner.rowId}?</span>
          <span className="dr-confirm-actions">
            <button
              type="button"
              className="dr-button dr-button-primary"
              onClick={async () => {
                setConfirming(false)
                await withTarget(onRestoreState)()
              }}
            >
              Restore
            </button>
            <button
              type="button"
              className="dr-button"
              autoFocus
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </span>
        </div>
      )}
    </li>
  )
}
