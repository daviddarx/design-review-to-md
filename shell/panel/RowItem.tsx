import { useEffect, useRef, useState } from "react"
import type { Op } from "../../model/ops.ts"
import { parsePinAssetName } from "../../model/pins.ts"
import type { PinRecord, PinRef, Status } from "../../model/types.ts"
import { fileUrl } from "../api.ts"
import type { Asset } from "../api.ts"
import { bytesToBase64, pinAssets } from "../drawer/draft.ts"
import type { DraftFile } from "../drawer/draft.ts"
import type { CapturedPin } from "../pick/capture.ts"
import { Flyout } from "./Flyout.tsx"
import { ActionButton, ActionGroup } from "./icons.tsx"
import { historyByRound, oneLine, singleLine } from "./listModel.ts"
import type { FlatRow, PinTarget } from "./listModel.ts"

export type RowItemProps = {
  row: FlatRow
  review: string
  owner: { rowId: string; pins: PinRef[] } | undefined // the pins this row uses, own or inherited
  recordPaths: string[] // one per pin of `owner`
  records: (PinRecord | null | undefined)[] // undefined: not fetched yet
  pinsShown: boolean // Show pins is on for `owner`
  onLoadRecords(): Promise<(PinRecord | null)[]>
  onOp(op: Op, assets?: Asset[]): Promise<boolean>
  reopenTo: Status // the status Devalidate gives a done row back
  onDeleteFeedback(n: number): Promise<boolean>
  startPick?: () => Promise<CapturedPin | null> // Refine's Pin; none without it
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
  reopenTo,
  onDeleteFeedback,
  startPick,
  onTogglePins,
  onOpenSource,
  onPeekPins,
}: RowItemProps) {
  const [refining, setRefining] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shotOpen, setShotOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shotButton, setShotButton] = useState<HTMLButtonElement | null>(null)
  // Refining can also add pins and files, sent with the new text on Save.
  const [refinePins, setRefinePins] = useState<CapturedPin[]>([])
  const [refineFiles, setRefineFiles] = useState<DraftFile[]>([])
  const [refineError, setRefineError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Delete asks for a second click on the same button.
  const [armed, setArmed] = useState(false)

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
  const history = historyByRound(note ? row.history.slice(0, -1) : row.history)
  const validate = () => void run({ kind: "setStatus", rowId: row.rowId, status: "done" })
  const devalidate = () => void run({ kind: "setStatus", rowId: row.rowId, status: reopenTo })
  const startRefine = () => setRefining(row.text)
  const toggleHistory = () => setHistoryOpen((v) => !v)

  const endRefine = () => {
    setRefining(null)
    setRefinePins([])
    setRefineFiles([])
    setRefineError(null)
  }

  // The new text, then each added pin, then the added files, one op each.
  // What went through leaves the draft, so a retry after a failure does not
  // send it twice.
  const submitRefine = async () => {
    if (busy) return
    const text = singleLine(refining ?? "")
    const rowId = row.rowId
    setBusy(true)
    try {
      // A pin made a moment ago may still be taking its picture.
      await Promise.all(refinePins.map((c) => c.finishing))
      if (text && text !== row.text) {
        if (!(await onOp({ kind: "refine", rowId, text }))) return
      }
      for (const c of refinePins) {
        if (!(await onOp({ kind: "addPin", rowId, pin: c.pin }, pinAssets(c, rowId, 0)))) return
        setRefinePins((pins) => pins.filter((p) => p !== c))
      }
      if (refineFiles.length) {
        const assets = refineFiles.map((f) => ({ rowId, ...f }))
        if (!(await onOp({ kind: "attach", rowId }, assets))) return
      }
      endRefine()
    } finally {
      setBusy(false)
    }
  }

  const pinMore = async () => {
    if (!startPick) return
    try {
      const captured = await startPick()
      if (captured) setRefinePins((pins) => [...pins, captured])
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : String(err))
    }
  }

  // The picker writes pin.png, pin-2.json, state.json, …; an attachment may
  // not take those names in any case.
  const addFiles = async (all: File[]) => {
    const refused = all.filter((f) => parsePinAssetName(f.name.toLowerCase()) !== null)
    const picked = all.filter((f) => !refused.includes(f))
    setRefineError(
      refused.length
        ? `${refused.map((f) => f.name).join(", ")}: this name is kept for pins — rename the file and attach it again.`
        : null
    )
    const read = await Promise.all(
      picked.map(async (f) => ({
        name: f.name,
        dataBase64: bytesToBase64(new Uint8Array(await f.arrayBuffer())),
      }))
    )
    const names = new Set(read.map((f) => f.name))
    setRefineFiles((files) => [...files.filter((f) => !names.has(f.name)), ...read])
  }

  const remove = async () => {
    if (!armed) return setArmed(true)
    setArmed(false)
    setBusy(true)
    try {
      if (row.depth === 0) await onDeleteFeedback(feedbackNumber)
      else await onOp({ kind: "deleteRow", rowId: row.rowId })
    } finally {
      setBusy(false)
    }
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
          button lands where Delete was. */}
      <div className={refining === null ? "dr-row-body" : "dr-row-body dr-row-refining"}>
        {refining === null ? (
          <div className="dr-row-text">{row.text}</div>
        ) : (
          // One line of text (wrapped as it grows), with Pin, Attach and Save
          // joined to it as a group.
          <div className="dr-refine-group" role="group">
            <textarea
              className="dr-input dr-grow dr-refine"
              rows={1}
              aria-label={`Refine ${row.rowId}`}
              autoFocus
              value={refining}
              disabled={busy}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setRefining(oneLine(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void submitRefine()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  e.stopPropagation()
                  endRefine()
                }
              }}
            />
            {startPick && (
              <ActionButton
                icon="pin"
                label={`Pin ${row.rowId} to an element`}
                tip={refinePins.length ? `Pin once more (${refinePins.length} added)` : "Add a pin"}
                count={refinePins.length}
                disabled={busy}
                onClick={() => void pinMore()}
              />
            )}
            <ActionButton
              icon="attach"
              label={`Attach a file to ${row.rowId}`}
              tip="Attach a file"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            />
            <ActionButton
              icon="save"
              label={`Save refinement of ${row.rowId}`}
              tip="Save"
              className="dr-action-primary"
              disabled={busy}
              onClick={() => void submitRefine()}
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = ""
                void addFiles(files)
              }}
            />
          </div>
        )}
        {refining !== null && refineFiles.length > 0 && (
          <ul className="dr-files" aria-label={`Files to attach to ${row.rowId}`}>
            {refineFiles.map((f) => (
              <li key={f.name} className="dr-file">
                {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setRefineFiles((files) => files.filter((x) => x !== f))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {refining !== null && refineError && (
          <p className="dr-refine-error" role="alert">
            {refineError}
          </p>
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

      {/* The group, then Delete on its own, the last action of every row. */}
      {refining === null && (
        <div className="dr-row-side">
          <ActionGroup>
            {validatable && <ActionButton icon="validate" label="Validate" onClick={validate} />}
            {row.status === "done" && (
              <ActionButton
                icon="devalidate"
                label="Devalidate"
                tip={`Devalidate: back to ${reopenTo}`}
                onClick={devalidate}
              />
            )}
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
          <ActionButton
            icon="remove"
            label={row.depth === 0 ? "Delete feedback" : "Delete row"}
            tip={
              armed
                ? "Click again to delete"
                : row.depth === 0
                  ? `Delete feedback ${feedbackNumber} and its files`
                  : `Delete ${row.rowId} and its files`
            }
            className={armed ? "dr-action-danger" : undefined}
            disabled={busy}
            onClick={() => void remove()}
            onMouseLeave={() => setArmed(false)}
            onBlur={() => setArmed(false)}
          />
        </div>
      )}

      {shotOpen && owner && shots.length === 1 && (
        <Flyout
          anchor={shotButton}
          maxWidth={columnWidth()}
          className="dr-shot"
          label={`Screenshot of ${owner.rowId}`}
          onDismiss={() => setShotOpen(false)}
        >
          <a href={fileUrl(review, shots[0])} target="_blank" rel="noreferrer">
            <img src={fileUrl(review, shots[0])} alt="" title="Open in a new tab" />
          </a>
        </Flyout>
      )}
      {/* Several: a list as wide as one screenshot would be, each a small
          thumbnail and its name, opening in a new tab. */}
      {shotOpen && owner && shots.length > 1 && (
        <Flyout
          anchor={shotButton}
          width={columnWidth()}
          className="dr-shot-list"
          label={`Screenshots of ${owner.rowId}`}
          onDismiss={() => setShotOpen(false)}
        >
          <ul>
            {shots.map((shot) => {
              const name = decodeURIComponent(shot.split("/").at(-1) ?? shot)
              const [head, tail] = splitForMiddleTruncation(name)
              return (
                <li key={shot}>
                  <a href={fileUrl(review, shot)} target="_blank" rel="noreferrer" title={name}>
                    <img src={fileUrl(review, shot)} alt="" />
                    <span className="dr-shot-name">
                      <span className="dr-shot-head">{head}</span>
                      <span className="dr-shot-tail">{tail}</span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </Flyout>
      )}
    </li>
  )
}

// A long name gives way in its middle: the head ellipsises, the last
// characters (the pin's number and the extension) always show.
function splitForMiddleTruncation(name: string): [string, string] {
  const keep = Math.min(name.length, 10)
  return [name.slice(0, name.length - keep), name.slice(name.length - keep)]
}
