import { useEffect, useRef, useState } from "react"
import type { Op } from "../../model/ops.ts"
import type { PinRecord, PinRef } from "../../model/types.ts"
import { fileUrl } from "../api.ts"
import { ActionButton } from "./icons.tsx"
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
  // The pin's owner row and its record; null when the hover ends.
  onHoverPin(ownerRowId: string, record: PinRecord | null): void
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
  onHoverPin,
}: RowItemProps) {
  const [refining, setRefining] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shotOpen, setShotOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

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

  // Validate and Refine answer Claude's work, so only a row waiting for
  // review offers them; History only shows on a row that has some.
  const reviewing = row.status === "review"
  const validate = () => void run({ kind: "setStatus", rowId: row.rowId, status: "done" })
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
      recordPath: pinRecordPath(owner.pin, owner.rowId, row.folder),
      record: rec,
    }
  }
  const withTarget = (fn: (rowId: string, t: PinTarget) => void) => async () => {
    const t = await target()
    if (t) fn(row.rowId, t)
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

  // Hovering a pinned row shows its pin where the click landed. The record
  // may still be loading; it is shown only if the pointer is still here.
  const hoverIn = async () => {
    prefetch()
    if (!owner) return
    const rec = record === undefined ? await onLoadRecord() : record
    if (rec && liRef.current?.matches(":hover")) onHoverPin(owner.rowId, rec)
  }
  // A row that unmounts under the pointer (a reload) never sees mouseleave.
  const hoverEnd = useRef(() => {})
  hoverEnd.current = () => owner && onHoverPin(owner.rowId, null)
  useEffect(() => () => hoverEnd.current(), [])
  const hoverOut = () => {
    setShotOpen(false)
    if (owner) onHoverPin(owner.rowId, null)
  }

  return (
    <li
      ref={liRef}
      // Joined, not concatenated: prettier-plugin-tailwindcss trims the
      // leading space of a class string inside a template literal.
      className={["dr-row", `dr-depth-${row.depth}`, busy && "dr-busy"].filter(Boolean).join(" ")}
      data-row-id={row.rowId}
      tabIndex={0}
      onMouseEnter={() => void hoverIn()}
      onFocus={prefetch}
      onMouseLeave={hoverOut}
    >
      <span className="dr-row-num">{row.rowId}</span>
      <div className="dr-row-head">
        {row.status && <span className={`dr-status dr-status-${row.status}`}>{row.status}</span>}
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
        {refining === null && (
          <span className="dr-row-actions">
            {row.depth === 0 && (
              <ActionButton
                icon="edit"
                label="Edit feedback"
                onClick={() => onEditPoint(pointNumber)}
              />
            )}
            {reviewing && <ActionButton icon="validate" label="Validate" onClick={validate} />}
            {reviewing && <ActionButton icon="refine" label="Refine" onClick={startRefine} />}
            {row.history.length > 0 && (
              <ActionButton
                icon="history"
                label="History"
                pressed={historyOpen}
                onClick={toggleHistory}
              />
            )}
            {owner && (
              <>
                <ActionButton icon="pin" label="Go to pin" onClick={withTarget(onGoToPin)} />
                {owner.pin.screenshot && (
                  <ActionButton
                    icon="screenshot"
                    label="Screenshot"
                    pressed={shotOpen}
                    onClick={() => setShotOpen((v) => !v)}
                  />
                )}
                <ActionButton
                  icon="restore"
                  label="Restore state"
                  onClick={() => setConfirming(true)}
                />
                {source && (
                  <ActionButton
                    icon="source"
                    label="Open in VS Code"
                    tip={`Open ${source.file}:${source.line} in VS Code`}
                    onClick={withTarget(onOpenSource)}
                  />
                )}
              </>
            )}
          </span>
        )}
      </div>

      {historyOpen && (
        <ol className="dr-history" aria-label={`History of ${row.rowId}`}>
          {row.history.map((h, i) => (
            <li key={i}>
              <span className="dr-history-kind">{h.kind === "before" ? "Before:" : "Claude:"}</span>{" "}
              {h.text}
            </li>
          ))}
        </ol>
      )}

      {refining === null ? (
        <div className="dr-row-text">{row.text}</div>
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

      {row.attachments.length > 0 && (
        <ul className="dr-files" aria-label="Attachments">
          {row.attachments.map((a) => (
            <li key={a.path} className="dr-file">
              <a href={fileUrl(topic, a.path)} target="_blank" rel="noreferrer">
                📎 {a.name}
              </a>
            </li>
          ))}
        </ul>
      )}

      {shotOpen && owner?.pin.screenshot && (
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
