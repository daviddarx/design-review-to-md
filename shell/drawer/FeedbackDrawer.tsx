import { useEffect, useRef, useState } from "react"
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react"
import type { Feedback } from "../../model/types.ts"
import { applyOp, createFeedback, deleteFeedback, readReview } from "../api.ts"
import {
  addCapture,
  appendCaptured,
  appendChild,
  buildCreate,
  buildOps,
  bytesToBase64,
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
  updateNode,
} from "./draft.ts"
import type { CapturedPin, DraftNode } from "./draft.ts"
import type { Marker } from "../pick/PinMarkers.tsx"
import { ActionButton } from "../panel/icons.tsx"

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
  onPinsChange?(markers: Marker[]): void // the pins made in this drawer, drawn on the page
}

// The picker writes these names itself; an attachment may not take them in
// any case (on a case-insensitive disk "PIN.png" would overwrite "pin.png").
const RESERVED = new Set(["pin.png", "pin.json", "state.json"])
const reserved = (f: File) => RESERVED.has(f.name.toLowerCase())

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

function numberLabel(node: DraftNode, depth: number): string {
  if (node.label) return `${node.label}.`
  return depth === 0 ? "New" : "·"
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
    el.focus()
  }, [focusId, tree])

  const seenSignal = useRef(focusSignal)
  useEffect(() => {
    if (focusSignal === seenSignal.current) return
    seenSignal.current = focusSignal
    setFocusId(BACK)
  }, [focusSignal])

  // Every pin made in this drawer shows where its click landed, until the
  // drawer closes.
  useEffect(() => {
    onPinsChange?.(
      flatten(tree).flatMap(({ node }) =>
        node.captures.flatMap((c, j) => {
          const step = c.record.steps[0]
          return step ? [{ key: `${node.id}:${j}`, label: node.savedRowId ?? "", step }] : []
        })
      )
    )
  }, [tree, onPinsChange])
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
    // The drawer stays on screen while the pick runs: its own elements can
    // be pinned (the picker swallows the click, so nothing here acts on it).
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

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const id = attachTo.current
    const all = Array.from(e.target.files ?? [])
    e.target.value = ""
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
      <header className="dr-drawer-head">
        <strong className="dr-drawer-title">{title}</strong>
        <span className="dr-drawer-review">{review}</span>
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
      </header>

      {confirmDiscard && (
        <div
          className="dr-confirm dr-drawer-confirm"
          role="alertdialog"
          aria-label="Discard draft?"
        >
          <span>Discard draft?</span>
          <span className="dr-confirm-actions">
            <button type="button" className="dr-button" onClick={onClose} autoFocus>
              Discard
            </button>
            <button type="button" className="dr-button" onClick={keepEditing}>
              Keep editing
            </button>
          </span>
        </div>
      )}

      {confirmDelete && feedback && (
        <div
          className="dr-confirm dr-drawer-confirm"
          role="alertdialog"
          aria-label="Delete feedback?"
        >
          <span>Delete feedback {feedback.number}? Its files go too.</span>
          <span className="dr-confirm-actions">
            <button
              type="button"
              className="dr-button"
              onClick={() => void removeFeedback()}
              disabled={saving}
              autoFocus
            >
              Delete
            </button>
            <button type="button" className="dr-button" onClick={keepEditing}>
              Keep
            </button>
          </span>
        </div>
      )}

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
              depth={depth}
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
            />
          ))
        )}
        <p className="dr-drawer-keys">
          Enter new row · Tab / ⇧Tab indent · ⌘Enter save · Esc close
        </p>
      </div>

      <input ref={fileInput} type="file" multiple hidden onChange={(e) => void onFiles(e)} />
    </section>
  )
}

type DrawerRowProps = {
  node: DraftNode
  depth: number
  busy: boolean
  canPin: boolean
  onText(text: string): void
  onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>): void
  onFocus(): void
  onAddChild(): void
  onAttach(): void
  onPin(): void
  onDelete?: () => void
  onRemoveFile(name: string): void
}

function DrawerRow({
  node,
  depth,
  busy,
  canPin,
  onText,
  onKeyDown,
  onFocus,
  onAddChild,
  onAttach,
  onPin,
  onDelete,
  onRemoveFile,
}: DrawerRowProps) {
  const pins = pinCount(node)
  return (
    <div
      className={["dr-row", "dr-drawer-row", `dr-depth-${depth}`, busy && "dr-busy"]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="dr-row-main">
        <span className="dr-row-num">{numberLabel(node, depth)}</span>
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
        <span className="dr-row-actions">
          {depth < 2 && (
            <ActionButton icon="addRow" label="Add a row at the end" onClick={onAddChild} />
          )}
          <ActionButton icon="attach" label="Attach a file" onClick={onAttach} />
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
        </span>
      </div>
      {node.locked && (
        <p className="dr-drawer-hint">Claude has worked on this — use Refine in the list.</p>
      )}
      {node.files.length > 0 && (
        <ul className="dr-files" aria-label="Attachments">
          {node.files.map((f) => (
            <li key={f.name} className="dr-file">
              📎 {f.name}
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
  )
}
