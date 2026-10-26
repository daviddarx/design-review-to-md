import { useEffect, useRef, useState } from "react"
import type { Op } from "../../model/ops.ts"
import type { PinRecord, PinRef } from "../../model/types.ts"
import { fileUrl } from "../api.ts"
import { Flyout } from "./Flyout.tsx"
import { ActionButton, ActionGroup } from "./icons.tsx"
import { singleLine } from "./listModel.ts"
import type { FlatRow, PinTarget } from "./listModel.ts"

export type RowItemProps = {
  row: FlatRow
  review: string
  owner: { rowId: string; pins: PinRef[] } | undefined // the pins this row uses, own or inherited
  recordPaths: string[] // one per pin of `owner`
  records: (PinRecord | null | undefined)[] // undefined: not fetched yet
  pinsShown: boolean // Show pins is on for `owner`
  onLoadRecords(): Promise<(PinRecord | null)[]>
  onOp(op: Op): Promise<boolean>
  onEditFeedback(n: number): void
  onTogglePins(rowId: string, target: PinTarget): void
  onOpenSource(rowId: string, target: PinTarget): void
  // Hovering Show pins shows the owner's pins for as long as it lasts; null
  // when it ends.
  onPeekPins(ownerRowId: string, records: PinRecord[] | null): void
}

export function RowItem({
  row,
  review,
  owner,
  recordPaths,
  records,
  pinsShown,
  onLoadRecords,
  onOp,
  onEditFeedback,
  onTogglePins,
  onOpenSource,
  onPeekPins,
}: RowItemProps) {
  const [refining, setRefining] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shotOpen, setShotOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shotButton, setShotButton] = useState<HTMLButtonElement | null>(null)

  const feedbackNumber = Number(row.rowId.split(".")[0])
  const fetched = records.every((r) => r !== undefined)
  const source = records.map((r) => r?.steps.at(-1)?.element.source).find(Boolean)

  const run = async (op: Op) => {
    if (busy) return false
    setBusy(true)
    try {
      return await onOp(op)
    } finally {
      setBusy(false)
    }
  }

  // Any row not done can be validated; Refine answers Claude's work, so only
  // a row waiting for review offers it. History only shows on a row that
  // has some.
  const reviewing = row.status === "review"
  const validatable = reviewing || row.status === "open"
  // A row waiting for review shows Claude's latest note under its text;
  // History keeps the rest.
  const last = row.history.at(-1)
  const note = reviewing && last?.kind === "claude" ? last : null
  const history = note ? row.history.slice(0, -1) : row.history
  const validate = () => void run({ kind: "setStatus", rowId: row.rowId, status: "done" })
  const startRefine = () => setRefining(row.text)
  const toggleHistory = () => setHistoryOpen((v) => !v)

  const submitRefine = async () => {
    const text = singleLine(refining ?? "")
    if (text && text !== row.text) {
      if (!(await run({ kind: "refine", rowId: row.rowId, text }))) return
    }
    setRefining(null)
  }

  const loaded = async () => (fetched ? records.map((r) => r ?? null) : await onLoadRecords())

  const target = async (): Promise<PinTarget | null> => {
    if (!owner) return null
    const recs = await loaded()
    return {
      ownerRowId: owner.rowId,
      pins: owner.pins.map((pin, i) => ({
        pin,
        recordPath: recordPaths[i],
        record: recs[i] ?? null,
      })),
    }
  }
  const withTarget = (fn: (rowId: string, t: PinTarget) => void) => async () => {
    const t = await target()
    if (t) fn(row.rowId, t)
  }

  // The pin records are fetched when the row is first hovered or focused,
  // and again after a reload dropped the cache while the row was still active.
  const prefetch = () => {
    if (owner && !fetched) void onLoadRecords()
  }
  const liRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (liRef.current?.matches(":hover, :focus-within")) prefetch()
  })

  // Hovering Show pins shows them where the clicks landed. The records may
  // still be loading; they are shown only if the pointer is still there.
  const peekButton = useRef<HTMLButtonElement>(null)
  const peekIn = async () => {
    if (!owner) return
    const recs = (await loaded()).filter((r): r is PinRecord => r !== null)
    if (recs.length && peekButton.current?.matches(":hover")) onPeekPins(owner.rowId, recs)
  }
  // A row that unmounts under the pointer (a reload) never sees mouseleave.
  const peekEnd = useRef(() => {})
  peekEnd.current = () => owner && onPeekPins(owner.rowId, null)
  useEffect(() => () => peekEnd.current(), [])

  // A flyout is at most as wide as the row's text column.
  const columnWidth = () => liRef.current?.querySelector(".dr-row-body")?.clientWidth || 320
  const shots = owner?.pins.flatMap((p) => (p.screenshot ? [p.screenshot] : [])) ?? []

  return (
    <li
      ref={liRef}
      // Joined, not concatenated: prettier-plugin-tailwindcss trims the
      // leading space of a class string inside a template literal.
      className={["dr-row", `dr-depth-${row.depth}`, busy && "dr-busy"].filter(Boolean).join(" ")}
      data-row-id={row.rowId}
      onMouseEnter={prefetch}
      onFocus={prefetch}
    >
      <span className="dr-row-num">{row.rowId}</span>

      {/* Refining, the column also takes the actions' place, and the save
          button lands where the row's last button was. */}
      <div className={refining === null ? "dr-row-body" : "dr-row-body dr-row-refining"}>
        {refining === null ? (
          <div className="dr-row-text">{row.text}</div>
        ) : (
          // One line, with its save button joined to it as a group.
          <div className="dr-refine-group" role="group">
            <input
              type="text"
              className="dr-input dr-refine"
              aria-label={`Refine ${row.rowId}`}
              autoFocus
              value={refining}
              disabled={busy}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setRefining(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void submitRefine()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  e.stopPropagation()
                  setRefining(null)
                }
              }}
            />
            <ActionButton
              icon="save"
              label={`Save refinement of ${row.rowId}`}
              tip="Save"
              disabled={busy}
              onClick={() => void submitRefine()}
            />
            {row.depth > 0 && <span className="dr-action-slot" aria-hidden="true" />}
          </div>
        )}

        {note && (
          <div className="dr-row-note">
            <span className="dr-history-kind">Claude:</span> {note.text}
          </div>
        )}

        {/* Under the text: the files as links on a line of their own, then
            the status. */}
        {row.attachments.length > 0 && (
          <div className="dr-row-files">
            {row.attachments.map((a) => (
              <a key={a.path} href={fileUrl(review, a.path)} target="_blank" rel="noreferrer">
                {a.name}
              </a>
            ))}
          </div>
        )}
        {row.status && (
          <div className="dr-row-meta">
            <span className={`dr-status dr-status-${row.status}`}>{row.status}</span>
          </div>
        )}

        {historyOpen && (
          <ol className="dr-history" aria-label={`History of ${row.rowId}`}>
            {history.map((h, i) => (
              <li key={i}>
                <span className="dr-history-kind">
                  {h.kind === "before" ? "Before:" : "Claude:"}
                </span>{" "}
                {h.text}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* The actions keep their places from row to row: a row without Edit
          (last, apart from the group) leaves its slot empty. */}
      {refining === null && (
        <div className="dr-row-side">
          <ActionGroup>
            {validatable && <ActionButton icon="validate" label="Validate" onClick={validate} />}
            {reviewing && <ActionButton icon="refine" label="Refine" onClick={startRefine} />}
            {history.length > 0 && (
              <ActionButton
                icon="history"
                label="History"
                pressed={historyOpen}
                onClick={toggleHistory}
              />
            )}
            {owner && (
              <>
                {/* Only on the row the pins belong to, as in the drawer. */}
                {!row.inheritedPinFrom && (
                  <ActionButton
                    ref={peekButton}
                    icon="pin"
                    label="Show pins"
                    data-pins-toggle // read by App: a press elsewhere in the panel switches it off
                    tip={owner.pins.length > 1 ? `Show the ${owner.pins.length} pins` : "Show pin"}
                    pressed={pinsShown}
                    onMouseEnter={() => void peekIn()}
                    onMouseLeave={() => onPeekPins(owner.rowId, null)}
                    onClick={withTarget(onTogglePins)}
                  />
                )}
                {shots.length > 0 && (
                  <ActionButton
                    ref={setShotButton}
                    icon="screenshot"
                    label="Screenshot"
                    pressed={shotOpen}
                    onClick={() => setShotOpen((v) => !v)}
                  />
                )}
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
          </ActionGroup>
          {row.depth === 0 ? (
            <ActionButton
              icon="edit"
              label="Edit feedback"
              className="dr-action-primary"
              onClick={() => onEditFeedback(feedbackNumber)}
            />
          ) : (
            <span className="dr-action-slot" aria-hidden="true" />
          )}
        </div>
      )}

      {shotOpen && owner && shots.length > 0 && (
        <Flyout
          anchor={shotButton}
          maxWidth={columnWidth()}
          className="dr-shot"
          label={`Screenshot of ${owner.rowId}`}
          onDismiss={() => setShotOpen(false)}
        >
          {shots.map((shot) => (
            <a key={shot} href={fileUrl(review, shot)} target="_blank" rel="noreferrer">
              <img src={fileUrl(review, shot)} alt="" title="Open in a new tab" />
            </a>
          ))}
        </Flyout>
      )}
    </li>
  )
}
