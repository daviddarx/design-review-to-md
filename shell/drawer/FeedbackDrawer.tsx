import { useEffect, useMemo, useRef, useState } from "react"
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent } from "react"
import { parsePinAssetName } from "../../model/pins.ts"
import type { Feedback, PinRecord } from "../../model/types.ts"
import { applyOp, createFeedback, deleteFeedback, fileUrl, readReview } from "../api.ts"
import { pinRecordPath } from "../panel/listModel.ts"
import {
  addCapture,
  appendCaptured,
  appendChild,
  buildCreate,
  buildOps,
  bytesToBase64,
  displayIds,
  dropSavedFile,
  find,
  flatten,
  fromFeedback,
  hasChanges,
  indent,
  insertSiblingAfter,
  newDraft,
  outdent,
  pinCount,
  problem,
  remove,
  removePin,
  savedFileName,
  updateNode,
} from "./draft.ts"
import type { CapturedPin, DraftNode, PinKey } from "./draft.ts"
import type { Marker } from "../pick/PinMarkers.tsx"
import { ActionButton, ActionGroup } from "../panel/icons.tsx"

export type FeedbackDrawerProps = {
  review: string
  feedbackNumber?: number // set: edit that saved feedback; unset: a new one
  initialCapture?: CapturedPin // Pin & add: the title row arrives pinned
  startPick?: (mode: "pin") => Promise<CapturedPin | null> // no 📍 without it
  // Pin & add while this drawer is open: each new `seq` appends a top-level
  // row carrying the capture, and focuses it.
  appendCapture?: { seq: number; capture: CapturedPin }
  focusSignal?: number // a change pulls focus back into the drawer (New feedback while open)
  onSaved?(): void
  onClose(): void
  onPinsChange?(markers: Marker[]): void // this feedback's pins, drawn on the page
}

// The picker writes these names itself (pin.png, pin-2.json, state.json, …);
// an attachment may not take them in any case (on a case-insensitive disk
// "PIN.png" would overwrite "pin.png").
const reserved = (f: File) => parsePinAssetName(f.name.toLowerCase()) !== null

// Focus target meaning "the row focused last, else the first editable row".
const BACK = "\u0000back"

// An IME is composing (Safari reports keyCode 229 without isComposing).
const composing = (e: ReactKeyboardEvent) =>
  e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Rows are single lines in the markdown.
const oneLine = (s: string) => s.replace(/\r?\n/g, " ")

function addedId(before: DraftNode, after: DraftNode): string | null {
  const old = new Set(flatten(before).map((f) => f.node.id))
  return flatten(after).find((f) => !old.has(f.node.id))?.node.id ?? null
}

// One feedback, over the panel's list at full panel width. The title row is
// the root; Enter / Tab / Shift+Tab / ⌘Enter / Esc drive it like an outliner.
export function FeedbackDrawer({
  review,
  feedbackNumber,
  initialCapture,
  startPick,
  appendCapture,
  focusSignal,
  onSaved,
  onClose,
  onPinsChange,
}: FeedbackDrawerProps) {
  const [tree, setTree] = useState<DraftNode>(() => newDraft(initialCapture))
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [loading, setLoading] = useState(feedbackNumber !== undefined)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [nextNumber, setNextNumber] = useState<number | null>(null) // a new feedback's
  const [savedRecords, setSavedRecords] = useState<Record<string, PinRecord | null>>({})
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(() =>
    feedbackNumber === undefined ? tree.id : null
  )
  const rootRef = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const attachTo = useRef<string | null>(null)
  const lastFocused = useRef<string | null>(null)
  const loadFailed = feedbackNumber !== undefined && !feedback && !loading

  const loadFeedback = async (n: number) => {
    const data = await readReview(review)
    const found = data.feedbacks.find((p) => p.number === n)
    if (!found) throw new Error(`Feedback ${n} no longer exists.`)
    setFeedback(found)
    setTree(fromFeedback(found))
  }

  // A new feedback shows the number it will get.
  useEffect(() => {
    if (feedbackNumber !== undefined) return
    let live = true
    readReview(review)
      .then((data) => live && setNextNumber(data.meta.nextFeedback))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [review, feedbackNumber])

  // The records of the saved pins, so they show on the page too.
  useEffect(() => {
    if (!feedback) return
    let live = true
    const wanted = flatten(fromFeedback(feedback)).flatMap(({ node }) =>
      node.savedPins.map((pin, i) => ({
        key: `${node.savedRowId}:${i}`,
        path: pinRecordPath(pin, node.savedRowId as string, i, feedback.folder),
      }))
    )
    void Promise.all(
      wanted.map(async ({ key, path }) => {
        const res = await fetch(fileUrl(review, path)).catch(() => null)
        const record = res?.ok ? ((await res.json().catch(() => null)) as PinRecord | null) : null
        return [key, record] as const
      })
    ).then((pairs) => live && setSavedRecords(Object.fromEntries(pairs)))
    return () => {
      live = false
    }
  }, [review, feedback])

  useEffect(() => {
    if (feedbackNumber === undefined) return
    let live = true
    readReview(review)
      .then((data) => {
        if (!live) return
        const found = data.feedbacks.find((p) => p.number === feedbackNumber)
        if (!found) return setError(`Feedback ${feedbackNumber} no longer exists.`)
        setFeedback(found)
        setTree(fromFeedback(found))
      })
      .catch((err) => live && setError(message(err)))
      .finally(() => {
        if (!live) return
        setLoading(false)
        setFocusId(BACK)
      })
    return () => {
      live = false
    }
  }, [review, feedbackNumber])

  // Focus never falls to <body>: the wanted row, else the first editable
  // row, else the drawer itself.
  useEffect(() => {
    if (!focusId) return
    setFocusId(null)
    const root = rootRef.current
    if (!root) return
    const wanted = focusId === BACK ? lastFocused.current : focusId
    const byId = (id: string | null) =>
      id ? root.querySelector<HTMLElement>(`[data-node-input="${id}"]`) : null
    const el = byId(wanted) ?? root.querySelector<HTMLElement>("[data-node-input]") ?? root
    // No scrolling into view: while the drawer slides in, that would scroll
    // its layer sideways and make the slide jump.
    el.focus({ preventScroll: true })
  }, [focusId, tree])

  const seenSignal = useRef(focusSignal)
  useEffect(() => {
    if (focusSignal === seenSignal.current) return
    seenSignal.current = focusSignal
    setFocusId(BACK)
  }, [focusSignal])

  const ids = useMemo(() => displayIds(tree, feedback, nextNumber), [tree, feedback, nextNumber])

  const takeOffPin = (id: string, key: PinKey) => {
    setTree((t) => removePin(t, id, key))
    setConfirmDiscard(false)
  }

  // Every pin of this feedback, saved or new, shows where its click landed
  // until the drawer closes; a click on one takes it off.
  useEffect(() => {
    onPinsChange?.(
      flatten(tree).flatMap(({ node }) => {
        const label = ids.get(node.id) ?? ""
        const marker = (key: string, step: PinRecord["steps"][number] | undefined, pin: PinKey) =>
          step ? [{ key, label, step, onRemove: () => takeOffPin(node.id, pin) }] : []
        return [
          ...node.keptPins.flatMap((i) =>
            marker(`${node.id}:s${i}`, savedRecords[`${node.savedRowId}:${i}`]?.steps[0], {
              saved: i,
            })
          ),
          ...node.captures.flatMap((c, j) =>
            marker(`${node.id}:c${j}`, c.record.steps[0], { capture: j })
          ),
        ]
      })
    )
  }, [tree, ids, savedRecords, onPinsChange])
  useEffect(() => () => onPinsChange?.([]), [onPinsChange])

  // A capture arriving while the feedback still loads waits for it: the load
  // replaces the whole tree.
  const seenAppend = useRef(appendCapture?.seq)
  useEffect(() => {
    if (!appendCapture || appendCapture.seq === seenAppend.current || loading) return
    seenAppend.current = appendCapture.seq
    const added = appendCaptured(tree, appendCapture.capture)
    setTree(added.tree)
    setConfirmDiscard(false)
    setFocusId(added.id)
  }, [appendCapture, loading, tree])

  const keepEditing = () => {
    setConfirmDiscard(false)
    setConfirmDelete(false)
    setFocusId(BACK)
  }

  const edit = (next: DraftNode, focus?: string | null) => {
    setTree(next)
    setConfirmDiscard(false)
    setConfirmDelete(false)
    if (focus) setFocusId(focus)
  }

  const requestClose = () => {
    setConfirmDelete(false)
    if (!saving && hasChanges(tree, feedback)) setConfirmDiscard(true)
    else onClose()
  }

  const save = async () => {
    // An edit whose feedback never loaded must not fall through to createFeedback.
    if (saving || loading || (feedbackNumber !== undefined && !feedback)) return
    const blocked = problem(tree)
    if (blocked) {
      setError(blocked)
      setFocusId(BACK)
      return
    }
    setSaving(true)
    setError(null)
    try {
      // A pin made a moment ago may still be taking its picture.
      await Promise.all(flatten(tree).flatMap(({ node }) => node.captures.map((c) => c.finishing)))
      if (!feedback) {
        await createFeedback(review, buildCreate(tree))
      } else {
        const ops = buildOps(feedback, tree)
        let done = 0
        try {
          for (const { op, assets } of ops) {
            await applyOp(review, feedback.number, op, assets)
            done++
          }
        } catch (err) {
          if (!done) throw err
          // Part of it is on disk: show what is there now, never re-send it.
          onSaved?.()
          await loadFeedback(feedback.number).catch(() => undefined)
          setError(`Saved ${done} of ${ops.length} changes; the rest failed: ${message(err)}`)
          setFocusId(BACK)
          return
        }
      }
      onSaved?.()
      onClose()
    } catch (err) {
      setError(message(err))
      setFocusId(BACK)
    } finally {
      setSaving(false)
    }
  }

  // After the inline confirm: the feedback's file and asset folder go.
  const removeFeedback = async () => {
    if (!feedback || saving) return
    setSaving(true)
    setError(null)
    try {
      await deleteFeedback(review, feedback.number)
      onSaved?.()
      onClose()
    } catch (err) {
      setConfirmDelete(false)
      setError(message(err))
      setFocusId(BACK)
    } finally {
      setSaving(false)
    }
  }

  const pin = async (id: string) => {
    if (!startPick) return
    // The drawer stays on screen while the pick runs; a click on it is
    // swallowed by the picker and pins nothing (only the app is pickable).
    try {
      const captured = await startPick("pin")
      if (captured) setTree((t) => addCapture(t, id, captured))
    } catch (err) {
      setError(message(err))
    }
  }

  const attach = (id: string) => {
    attachTo.current = id
    fileInput.current?.click()
  }

  // From the file dialog, or dropped on a row's attach button.
  const addFiles = async (id: string | null, all: File[]) => {
    const refused = all.filter(reserved).map((f) => f.name)
    const picked = all.filter((f) => !reserved(f))
    if (refused.length) {
      setError(
        `${refused.join(", ")}: this name is kept for pins — rename the file and attach it again.`
      )
    }
    if (!id || !picked.length) return
    try {
      const read = await Promise.all(
        picked.map(async (f) => ({
          name: f.name,
          dataBase64: bytesToBase64(new Uint8Array(await f.arrayBuffer())),
        }))
      )
      setTree((t) => {
        const node = find(t, id)
        if (!node) return t
        const names = new Set(read.map((f) => f.name))
        return updateNode(t, id, {
          files: [...node.files.filter((f) => !names.has(f.name)), ...read],
        })
      })
    } catch (err) {
      setError(`Could not read the file: ${message(err)}`)
    }
  }

  const dragOver = (id: string) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    setDropTarget(id)
  }
  // Leaving for one of the row's own children is not leaving the row.
  const dragLeave = (id: string) => (e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropTarget((t) => (t === id ? null : t))
  }
  const drop = (id: string) => (e: DragEvent) => {
    e.preventDefault()
    setDropTarget(null)
    void addFiles(id, Array.from(e.dataTransfer.files))
  }

  const removeFile = (id: string, name: string) => {
    const node = find(tree, id)
    if (node) edit(updateNode(tree, id, { files: node.files.filter((f) => f.name !== name) }))
  }

  const removeRow = (id: string) => {
    const rows = flatten(tree)
    const i = rows.findIndex((r) => r.node.id === id)
    edit(remove(tree, id), rows[i - 1]?.node.id)
  }

  const onRowKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>, node: DraftNode) => {
    if (composing(e)) return
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const next = insertSiblingAfter(tree, node.id)
      edit(next, addedId(tree, next))
    } else if (e.key === "Tab") {
      e.preventDefault()
      edit(e.shiftKey ? outdent(tree, node.id) : indent(tree, node.id), node.id)
    } else if (
      e.key === "Backspace" &&
      node.text === "" &&
      !node.savedRowId &&
      !node.children.length &&
      !node.files.length &&
      pinCount(node) === 0 &&
      node.id !== tree.id
    ) {
      e.preventDefault()
      removeRow(node.id)
    }
  }

  const onRootKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (composing(e)) return
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      if (confirmDiscard || confirmDelete) keepEditing()
      else requestClose()
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void save()
    }
  }

  const title = feedbackNumber === undefined ? "New feedback" : `Feedback ${feedbackNumber}`

  return (
    <section
      ref={rootRef}
      className="dr-drawer"
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={onRootKey}
    >
      {/* Discarding or deleting asks right here: the header's two buttons
          become the answer. */}
      <header className="dr-drawer-head">
        <strong className="dr-drawer-title">{title}</strong>
        <span className="dr-drawer-review">{review}</span>
        {confirmDiscard ? (
          <>
            <button type="button" className="dr-button" onClick={keepEditing}>
              Keep editing
            </button>
            <button
              type="button"
              className="dr-button dr-button-primary"
              onClick={onClose}
              autoFocus
            >
              Discard
            </button>
          </>
        ) : confirmDelete && feedback ? (
          <>
            <button type="button" className="dr-button" onClick={keepEditing}>
              Keep
            </button>
            <button
              type="button"
              className="dr-button dr-button-primary"
              onClick={() => void removeFeedback()}
              disabled={saving}
              autoFocus
              title={`Feedback ${feedback.number} and its files go`}
            >
              Delete feedback
            </button>
          </>
        ) : (
          <>
            <button type="button" className="dr-button" onClick={requestClose} title="Close (Esc)">
              Cancel
            </button>
            <button
              type="button"
              className="dr-button dr-button-primary"
              onClick={() => void save()}
              disabled={saving || loading || loadFailed}
              title="Save (⌘Enter)"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </header>

      {error && (
        <div className="dr-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      <div className="dr-drawer-body">
        {loading ? (
          <p className="dr-empty">Loading…</p>
        ) : loadFailed ? (
          <p className="dr-empty">This feedback could not be loaded.</p>
        ) : (
          flatten(tree).map(({ node, depth }) => (
            <DrawerRow
              key={node.id}
              node={node}
              review={review}
              number={ids.get(node.id) ?? ""}
              depth={depth}
              dropping={dropTarget === node.id}
              busy={saving}
              canPin={Boolean(startPick)}
              onText={(text) => edit(updateNode(tree, node.id, { text: oneLine(text) }))}
              onKeyDown={(e) => onRowKey(e, node)}
              onFocus={() => (lastFocused.current = node.id)}
              onAddChild={() => {
                const next = appendChild(tree, node.id)
                edit(next, addedId(tree, next))
              }}
              onAttach={() => attach(node.id)}
              onDragOver={dragOver(node.id)}
              onDragLeave={dragLeave(node.id)}
              onDrop={drop(node.id)}
              onPin={() => void pin(node.id)}
              onDelete={
                depth > 0
                  ? () => removeRow(node.id)
                  : feedback
                    ? () => {
                        setConfirmDiscard(false)
                        setConfirmDelete(true)
                      }
                    : undefined
              }
              onRemoveFile={(name) => removeFile(node.id, name)}
              onDropSavedFile={(file) => edit(dropSavedFile(tree, node.id, file))}
            />
          ))
        )}
      </div>
      <footer className="dr-panel-foot dr-drawer-foot">
        Enter new row · Tab / ⇧Tab indent · ⌘Enter save · Esc close
      </footer>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ""
          void addFiles(attachTo.current, files)
        }}
      />
    </section>
  )
}

type DrawerRowProps = {
  node: DraftNode
  review: string
  number: string // what the row will be numbered: 5, 5.c, 5.c.1
  depth: number
  busy: boolean
  canPin: boolean
  dropping: boolean // files are dragged over the row
  onText(text: string): void
  onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): void
  onFocus(): void
  onAddChild(): void
  onAttach(): void
  onDragOver(e: DragEvent): void
  onDragLeave(e: DragEvent): void
  onDrop(e: DragEvent): void
  onPin(): void
  onDelete?: () => void
  onRemoveFile(name: string): void
  onDropSavedFile(file: string): void
}

// Number, then the field (indented by depth; files under it at its left
// edge), then the icon actions at the right.
function DrawerRow({
  node,
  review,
  number,
  depth,
  busy,
  canPin,
  dropping,
  onText,
  onKeyDown,
  onFocus,
  onAddChild,
  onAttach,
  onDragOver,
  onDragLeave,
  onDrop,
  onPin,
  onDelete,
  onRemoveFile,
  onDropSavedFile,
}: DrawerRowProps) {
  const pins = pinCount(node)
  return (
    <div
      className={[
        "dr-row",
        "dr-drawer-row",
        `dr-depth-${depth}`,
        busy && "dr-busy",
        dropping && "dr-drop-target",
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="dr-row-num">{number}</span>
      <div className="dr-drawer-cell">
        {node.locked ? (
          <span className="dr-row-text" title="Use Refine in the list to change it">
            {node.text}
          </span>
        ) : (
          <textarea
            className="dr-input dr-drawer-input"
            data-node-input={node.id}
            rows={1}
            value={node.text}
            placeholder={depth === 0 ? "Title" : "Row"}
            aria-label={depth === 0 ? "Feedback title" : "Row text"}
            disabled={busy}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
          />
        )}
        {node.locked && (
          <p className="dr-drawer-hint">Claude has worked on this — use Refine in the list.</p>
        )}
        {node.savedFiles.length + node.files.length > 0 && (
          <ul className="dr-files" aria-label="Attachments">
            {node.savedFiles.map((f) => (
              <li key={f.path} className="dr-file">
                <a href={fileUrl(review, f.path)} target="_blank" rel="noreferrer">
                  {f.name}
                </a>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onDropSavedFile(savedFileName(f))}
                >
                  ×
                </button>
              </li>
            ))}
            {node.files.map((f) => (
              <li key={f.name} className="dr-file">
                {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => onRemoveFile(f.name)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ActionGroup>
        {depth < 2 && (
          <ActionButton icon="addRow" label="Add a row at the end" onClick={onAddChild} />
        )}
        <ActionButton
          icon="attach"
          label="Attach a file"
          tip="Attach a file (or drop it on the row)"
          onClick={onAttach}
        />
        {canPin && (
          <ActionButton
            icon="pin"
            label="Pin this row to an element"
            tip={pins ? `Pin once more (${pins} pinned)` : "Pin this row to an element"}
            count={pins}
            onClick={onPin}
          />
        )}
        {onDelete && (
          <ActionButton
            icon="remove"
            label={depth === 0 ? "Delete this feedback and its files" : "Delete this row"}
            onClick={onDelete}
          />
        )}
      </ActionGroup>
    </div>
  )
}
