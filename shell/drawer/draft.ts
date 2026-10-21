// Pure editor state of the point drawer: one tree per point, the title row
// at the root. Every edit returns a new tree (or the same one when refused).
import type { DraftRow, Op } from "../../model/ops.ts"
import type { PinRef, Point, Row } from "../../model/types.ts"
import type { Asset } from "../api.ts"
import type { CapturedPin } from "../pick/capture.ts"

export type { CapturedPin }

export type DraftFile = { name: string; dataBase64: string }

export type DraftNode = Omit<DraftRow, "children"> & {
  id: string
  savedRowId?: string // "5", "5.c", "5.b.1" — set on rows read from disk
  savedText?: string
  label?: string // the saved row's own segment ("c", "1"), for display
  locked?: boolean // saved, and Claude has touched it: text changes go through Refine
  files: DraftFile[]
  capture?: CapturedPin
  children: DraftNode[]
}

export type CreatePayload = {
  title: string
  rows: DraftRow[]
  pin?: PinRef
  assets: Asset[]
}

export type PlannedOp = { op: Op; assets: Asset[] }

const MAX_DEPTH = 2 // root 0 = point, 1 = letter, 2 = number

let counter = 0
const nextId = () => `d${++counter}`

const blank = (): DraftNode => ({ id: nextId(), text: "", files: [], children: [] })

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
  return { ...blank(), ...(capture ? { capture, pin: capture.pin } : {}) }
}

// Pin & add on an open drawer: a new top-level row carrying the capture,
// after every saved one. Returns the tree and the new row's id.
export function appendCaptured(
  tree: DraftNode,
  capture: CapturedPin
): { tree: DraftNode; id: string } {
  const row = { ...blank(), capture, pin: capture.pin }
  return { tree: { ...tree, children: [...tree.children, row] }, id: row.id }
}

function fromRow(row: Row, id: string): DraftNode {
  return {
    id: nextId(),
    text: row.text,
    ...(row.pin ? { pin: row.pin } : {}),
    savedRowId: id,
    savedText: row.text,
    label: row.label,
    locked: row.status !== "open" || row.history.some((h) => h.kind === "claude"),
    files: [],
    children: row.children.map((c) => fromRow(c, `${id}.${c.label}`)),
  }
}

export function fromPoint(point: Point): DraftNode {
  const id = String(point.number)
  return {
    id: nextId(),
    text: point.title,
    ...(point.pin ? { pin: point.pin } : {}),
    savedRowId: id,
    savedText: point.title,
    label: id,
    locked: (point.status ?? "open") !== "open" || point.history.some((h) => h.kind === "claude"),
    files: [],
    children: point.rows.map((r) => fromRow(r, `${id}.${r.label}`)),
  }
}

export function find(tree: DraftNode, id: string): DraftNode | undefined {
  return locate(tree, id)?.node
}

export function updateNode(tree: DraftNode, id: string, patch: Partial<DraftNode>): DraftNode {
  return replace(tree, id, (n) => ({ ...n, ...patch }))
}

// Enter: an empty row below `id`; on the title row, the first sub-point.
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

function captureAssets(n: DraftNode, rowId: string): Asset[] {
  const c = n.capture
  if (!c) return []
  const out: Asset[] = []
  if (c.png) out.push({ rowId, name: "pin.png", dataBase64: c.png })
  out.push({ rowId, name: "pin.json", dataBase64: textBase64(JSON.stringify(c.record, null, 2)) })
  out.push({ rowId, name: "state.json", dataBase64: textBase64(c.state) })
  return out
}

const pinOf = (n: DraftNode) => n.capture?.pin ?? n.pin

// Unsaved rows with nothing in them are dropped on save.
function prune(nodes: DraftNode[]): DraftNode[] {
  return nodes
    .map((n) => (n.savedRowId ? n : { ...n, children: prune(n.children) }))
    .filter(
      (n) => n.savedRowId || n.text.trim() || n.files.length || n.capture || n.children.length
    )
}

function toDraftRow(n: DraftNode): DraftRow {
  const pin = pinOf(n)
  return { text: n.text.trim(), ...(pin ? { pin } : {}), children: n.children.map(toDraftRow) }
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
  const pin = pinOf(tree)
  return {
    title: tree.text.trim(),
    rows: rows.map(toDraftRow),
    ...(pin ? { pin } : {}),
    assets: [...nodeAssets(tree, "$point"), ...rows.flatMap((r, i) => subtreeAssets(r, `$${i}`))],
  }
}

// What stops a save, or null.
export function problem(tree: DraftNode): string | null {
  if (!tree.text.trim()) return "Give the point a title first."
  const kept = (nodes: DraftNode[]): DraftNode[] =>
    prune(nodes).flatMap((n) => [n, ...kept(n.children)])
  if (kept(tree.children).some((n) => !n.text.trim())) {
    return "Every row needs text — delete empty rows with 🗑."
  }
  return null
}

// Saved point + edited tree → the ops that take one to the other: deletes,
// then text edits and re-pins, then new rows (appended under their saved
// parent). Files added to saved rows ride along with the first op.
export function buildOps(point: Point, tree: DraftNode): PlannedOp[] {
  const present = new Set(flatten(tree).map((f) => f.node.savedRowId))
  const deletes: PlannedOp[] = []
  const walkSaved = (rows: Row[], parent: string) => {
    for (const r of rows) {
      const id = `${parent}.${r.label}`
      if (!present.has(id)) deletes.push({ op: { kind: "deleteRow", rowId: id }, assets: [] })
      else walkSaved(r.children, id)
    }
  }
  walkSaved(point.rows, String(point.number))

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
    if (n.capture) {
      edits.push({
        op: { kind: "setPin", rowId, pin: n.capture.pin },
        assets: captureAssets(n, rowId),
      })
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
      // Rewrites the row's own pin unchanged: the only op that touches nothing.
      ops.push({
        op: { kind: "setPin", rowId: holder!.savedRowId as string, pin: holder!.pin },
        assets: files,
      })
    }
  }
  return ops
}

// Esc asks before throwing this away.
export function hasChanges(tree: DraftNode, point: Point | null): boolean {
  if (point) return buildOps(point, tree).length > 0
  return Boolean(
    tree.text.trim() || tree.files.length || tree.capture || prune(tree.children).length
  )
}
