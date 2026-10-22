// Pure editor state of the feedback drawer: one tree per feedback, the title row
// at the root. Every edit returns a new tree (or the same one when refused).
import type { DraftRow, Op } from "../../model/ops.ts"
import { pinAssetName } from "../../model/pins.ts"
import type { PinRef, Feedback, Row } from "../../model/types.ts"
import type { Asset } from "../api.ts"
import type { CapturedPin } from "../pick/capture.ts"

export type { CapturedPin }

export type DraftFile = { name: string; dataBase64: string }

export type DraftNode = {
  id: string
  text: string
  savedRowId?: string // "5", "5.c", "5.b.1" — set on rows read from disk
  savedText?: string
  label?: string // the saved row's own segment ("c", "1"), for display
  locked?: boolean // saved, and Claude has touched it: text changes go through Refine
  savedPins: PinRef[] // the pins on disk, in their order there
  keptPins: number[] // which of them stay (indexes into savedPins)
  captures: CapturedPin[] // pins made in this drawer, added after the kept ones
  files: DraftFile[]
  children: DraftNode[]
}

export type CreatePayload = {
  title: string
  rows: DraftRow[]
  pins?: PinRef[]
  assets: Asset[]
}

export type PlannedOp = { op: Op; assets: Asset[] }

const MAX_DEPTH = 2 // root 0 = feedback, 1 = letter, 2 = number

let counter = 0
const nextId = () => `d${++counter}`

const blank = (): DraftNode => ({
  id: nextId(),
  text: "",
  savedPins: [],
  keptPins: [],
  captures: [],
  files: [],
  children: [],
})

// How many pins the row will have once saved.
export const pinCount = (n: DraftNode) => n.keptPins.length + n.captures.length

type Loc = { node: DraftNode; parent: DraftNode | null; index: number; depth: number }

function locate(tree: DraftNode, id: string): Loc | null {
  const walk = (
    node: DraftNode,
    parent: DraftNode | null,
    index: number,
    depth: number
  ): Loc | null => {
    if (node.id === id) return { node, parent, index, depth }
    for (let i = 0; i < node.children.length; i++) {
      const found: Loc | null = walk(node.children[i], node, i, depth + 1)
      if (found) return found
    }
    return null
  }
  return walk(tree, null, 0, 0)
}

// Copies the path down to `id` and replaces that node.
function replace(tree: DraftNode, id: string, fn: (n: DraftNode) => DraftNode): DraftNode {
  if (tree.id === id) return fn(tree)
  let changed = false
  const children = tree.children.map((c) => {
    const next = replace(c, id, fn)
    if (next !== c) changed = true
    return next
  })
  return changed ? { ...tree, children } : tree
}

function height(n: DraftNode): number {
  return n.children.length ? 1 + Math.max(...n.children.map(height)) : 0
}

// New rows are appended on save, so they never sit between saved siblings.
function insertAt(siblings: DraftNode[], wanted: number): number {
  let lastSaved = -1
  siblings.forEach((s, i) => {
    if (s.savedRowId) lastSaved = i
  })
  return Math.max(wanted, lastSaved + 1)
}

function withChild(children: DraftNode[], node: DraftNode, at: number): DraftNode[] {
  return [...children.slice(0, at), node, ...children.slice(at)]
}

export function newDraft(capture?: CapturedPin): DraftNode {
  return { ...blank(), captures: capture ? [capture] : [] }
}

// Pin & add on an open drawer: a new top-level row carrying the capture,
// after every saved one. Returns the tree and the new row's id.
export function appendCaptured(
  tree: DraftNode,
  capture: CapturedPin
): { tree: DraftNode; id: string } {
  const row = { ...blank(), captures: [capture] }
  return { tree: { ...tree, children: [...tree.children, row] }, id: row.id }
}

function fromRow(row: Row, id: string): DraftNode {
  return {
    id: nextId(),
    text: row.text,
    savedPins: row.pins,
    keptPins: row.pins.map((_, i) => i),
    captures: [],
    savedRowId: id,
    savedText: row.text,
    label: row.label,
    locked: row.status !== "open" || row.history.some((h) => h.kind === "claude"),
    files: [],
    children: row.children.map((c) => fromRow(c, `${id}.${c.label}`)),
  }
}

export function fromFeedback(feedback: Feedback): DraftNode {
  const id = String(feedback.number)
  return {
    id: nextId(),
    text: feedback.title,
    savedPins: feedback.pins,
    keptPins: feedback.pins.map((_, i) => i),
    captures: [],
    savedRowId: id,
    savedText: feedback.title,
    label: id,
    locked:
      (feedback.status ?? "open") !== "open" || feedback.history.some((h) => h.kind === "claude"),
    files: [],
    children: feedback.rows.map((r) => fromRow(r, `${id}.${r.label}`)),
  }
}

export function find(tree: DraftNode, id: string): DraftNode | undefined {
  return locate(tree, id)?.node
}

export function updateNode(tree: DraftNode, id: string, patch: Partial<DraftNode>): DraftNode {
  return replace(tree, id, (n) => ({ ...n, ...patch }))
}

// Pin & add, or the row's pin button: one more pin on the row.
export function addCapture(tree: DraftNode, id: string, capture: CapturedPin): DraftNode {
  return replace(tree, id, (n) => ({ ...n, captures: [...n.captures, capture] }))
}

// A pin taken off in the page: a saved one by its index on disk, a new one
// by its place among the captures.
export type PinKey = { saved: number } | { capture: number }

export function removePin(tree: DraftNode, id: string, key: PinKey): DraftNode {
  return replace(tree, id, (n) =>
    "saved" in key
      ? { ...n, keptPins: n.keptPins.filter((i) => i !== key.saved) }
      : { ...n, captures: n.captures.filter((_, j) => j !== key.capture) }
  )
}

// Enter: an empty row below `id`; on the title row, the first row.
export function insertSiblingAfter(tree: DraftNode, id: string): DraftNode {
  const loc = locate(tree, id)
  if (!loc) return tree
  const target = loc.parent ?? loc.node
  const wanted = loc.parent ? loc.index + 1 : 0
  return replace(tree, target.id, (p) => ({
    ...p,
    children: withChild(p.children, blank(), insertAt(p.children, wanted)),
  }))
}

// ＋ sub: an empty child at the end of `id`'s children.
export function appendChild(tree: DraftNode, id: string): DraftNode {
  const loc = locate(tree, id)
  if (!loc || loc.depth >= MAX_DEPTH) return tree
  return replace(tree, id, (n) => ({ ...n, children: [...n.children, blank()] }))
}

// Tab: the row becomes the last child of the row above it.
export function indent(tree: DraftNode, id: string): DraftNode {
  const loc = locate(tree, id)
  if (!loc || !loc.parent || loc.node.savedRowId || loc.index === 0) return tree
  if (loc.depth + 1 + height(loc.node) > MAX_DEPTH) return tree
  const prev = loc.parent.children[loc.index - 1]
  return replace(tree, loc.parent.id, (p) => ({
    ...p,
    children: p.children
      .filter((c) => c.id !== id)
      .map((c) => (c.id === prev.id ? { ...c, children: [...c.children, loc.node] } : c)),
  }))
}

// Shift+Tab: a third-level row moves up beside its parent, just after it.
export function outdent(tree: DraftNode, id: string): DraftNode {
  const loc = locate(tree, id)
  if (!loc || !loc.parent || loc.node.savedRowId || loc.depth !== MAX_DEPTH) return tree
  const parentLoc = locate(tree, loc.parent.id)
  if (!parentLoc?.parent) return tree
  const parentId = loc.parent.id
  return replace(tree, parentLoc.parent.id, (gp) => {
    const children = gp.children.map((c) =>
      c.id === parentId ? { ...c, children: c.children.filter((x) => x.id !== id) } : c
    )
    return {
      ...gp,
      children: withChild(children, loc.node, insertAt(children, parentLoc.index + 1)),
    }
  })
}

export function remove(tree: DraftNode, id: string): DraftNode {
  const loc = locate(tree, id)
  if (!loc?.parent) return tree
  return replace(tree, loc.parent.id, (p) => ({
    ...p,
    children: p.children.filter((c) => c.id !== id),
  }))
}

// Flattened for rendering, in display order.
export function flatten(tree: DraftNode): { node: DraftNode; depth: number }[] {
  const out: { node: DraftNode; depth: number }[] = []
  const walk = (n: DraftNode, depth: number) => {
    out.push({ node: n, depth })
    n.children.forEach((c) => walk(c, depth + 1))
  }
  walk(tree, 0)
  return out
}

// --- saving -----------------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const textBase64 = (s: string) => bytesToBase64(new TextEncoder().encode(s))

function nodeAssets(n: DraftNode, rowId: string): Asset[] {
  const out: Asset[] = n.files.map((f) => ({ rowId, name: f.name, dataBase64: f.dataBase64 }))
  out.push(...captureAssets(n, rowId))
  return out
}

// The files of one captured pin, named for pin `index` of its row.
function pinAssets(c: CapturedPin, rowId: string, index: number): Asset[] {
  const out: Asset[] = []
  const name = (file: "png" | "json" | "state") => pinAssetName(index, file)
  if (c.png) out.push({ rowId, name: name("png"), dataBase64: c.png })
  out.push({
    rowId,
    name: name("json"),
    dataBase64: textBase64(JSON.stringify(c.record, null, 2)),
  })
  out.push({ rowId, name: name("state"), dataBase64: textBase64(c.state) })
  return out
}

// A new row's captures are its only pins, numbered from the first.
function captureAssets(n: DraftNode, rowId: string): Asset[] {
  return n.captures.flatMap((c, j) => pinAssets(c, rowId, j))
}

// Unsaved rows with nothing in them are dropped on save.
function prune(nodes: DraftNode[]): DraftNode[] {
  return nodes
    .map((n) => (n.savedRowId ? n : { ...n, children: prune(n.children) }))
    .filter(
      (n) =>
        n.savedRowId || n.text.trim() || n.files.length || n.captures.length || n.children.length
    )
}

function toDraftRow(n: DraftNode): DraftRow {
  return {
    text: n.text.trim(),
    ...(n.captures.length ? { pins: n.captures.map((c) => c.pin) } : {}),
    children: n.children.map(toDraftRow),
  }
}

// Assets of an unsaved subtree, addressed "$<prefix>", "$<prefix>.j".
function subtreeAssets(n: DraftNode, prefix: string): Asset[] {
  return [
    ...nodeAssets(n, prefix),
    ...n.children.flatMap((c, j) => nodeAssets(c, `${prefix}.${j}`)),
  ]
}

export function buildCreate(tree: DraftNode): CreatePayload {
  const rows = prune(tree.children)
  return {
    title: tree.text.trim(),
    rows: rows.map(toDraftRow),
    ...(tree.captures.length ? { pins: tree.captures.map((c) => c.pin) } : {}),
    assets: [
      ...nodeAssets(tree, "$feedback"),
      ...rows.flatMap((r, i) => subtreeAssets(r, `$${i}`)),
    ],
  }
}

// What stops a save, or null.
export function problem(tree: DraftNode): string | null {
  if (!tree.text.trim()) return "Give the feedback a title first."
  const kept = (nodes: DraftNode[]): DraftNode[] =>
    prune(nodes).flatMap((n) => [n, ...kept(n.children)])
  if (kept(tree.children).some((n) => !n.text.trim())) {
    return "Every row needs text — delete empty rows with 🗑."
  }
  return null
}

// Saved feedback + edited tree → the ops that take one to the other: deletes,
// then text edits, removed pins (last first, so the indexes stay true) and
// added ones, then new rows (appended under their saved parent). Files added
// to saved rows ride along with the first op.
export function buildOps(feedback: Feedback, tree: DraftNode): PlannedOp[] {
  const present = new Set(flatten(tree).map((f) => f.node.savedRowId))
  const deletes: PlannedOp[] = []
  const walkSaved = (rows: Row[], parent: string) => {
    for (const r of rows) {
      const id = `${parent}.${r.label}`
      if (!present.has(id)) deletes.push({ op: { kind: "deleteRow", rowId: id }, assets: [] })
      else walkSaved(r.children, id)
    }
  }
  walkSaved(feedback.rows, String(feedback.number))

  const edits: PlannedOp[] = []
  const adds: PlannedOp[] = []
  const files: Asset[] = []
  let carrier: DraftNode | null = null
  const walk = (n: DraftNode) => {
    const rowId = n.savedRowId as string
    const text = n.text.trim()
    if (!n.locked && text && text !== n.savedText) {
      edits.push({ op: { kind: "editText", rowId, text }, assets: [] })
    }
    for (let i = n.savedPins.length - 1; i >= 0; i--) {
      if (!n.keptPins.includes(i)) {
        edits.push({ op: { kind: "removePin", rowId, index: i }, assets: [] })
      }
    }
    // The server files an added pin under its next number.
    for (const c of n.captures) {
      edits.push({ op: { kind: "addPin", rowId, pin: c.pin }, assets: pinAssets(c, rowId, 0) })
    }
    if (n.files.length && !carrier) carrier = n
    files.push(...n.files.map((f) => ({ rowId, name: f.name, dataBase64: f.dataBase64 })))
    for (const c of prune(n.children)) {
      if (c.savedRowId) walk(c)
      else
        adds.push({
          op: { kind: "addChild", rowId, row: toDraftRow(c) },
          assets: subtreeAssets(c, "$0"),
        })
    }
  }
  walk(tree)

  const ops = [...deletes, ...edits, ...adds]
  if (files.length) {
    if (ops.length) ops[0] = { ...ops[0], assets: [...files, ...ops[0].assets] }
    else {
      const holder = carrier as DraftNode | null
      ops.push({ op: { kind: "attach", rowId: holder!.savedRowId as string }, assets: files })
    }
  }
  return ops
}

// Esc asks before throwing this away.
export function hasChanges(tree: DraftNode, feedback: Feedback | null): boolean {
  if (feedback) return buildOps(feedback, tree).length > 0
  return Boolean(
    tree.text.trim() || tree.files.length || tree.captures.length || prune(tree.children).length
  )
}
