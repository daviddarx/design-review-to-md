import { nextLabel } from "./labels.ts"
import type { PinRef, Feedback, Row, Status } from "./types.ts"

export type DraftRow = { text: string; pins?: PinRef[]; children: DraftRow[] }
export type Op =
  | { kind: "setStatus"; rowId: string; status: Status }
  | { kind: "refine"; rowId: string; text: string }
  | { kind: "editText"; rowId: string; text: string }
  | { kind: "addChild"; rowId: string; row: DraftRow }
  | { kind: "addPin"; rowId: string; pin: PinRef }
  | { kind: "removePin"; rowId: string; index: number }
  | { kind: "attach"; rowId: string } // changes nothing: the files sent with it are linked
  | { kind: "deleteRow"; rowId: string }
  // Re-parents a row (indent / outdent): it goes last under `parentId` (the
  // feedback's number for the top level) with a new label, its rows with it.
  | { kind: "moveRow"; rowId: string; parentId: string }
export type OpResult = {
  feedback: Feedback
  retired: string[]
  addedRowIds: string[]
  deletedRowIds: string[]
  movedRowIds: [string, string][] // [old, new], the moved row and each row under it
}

export class OpError extends Error {
  code: "not-found" | "locked"
  constructor(code: "not-found" | "locked", message: string) {
    super(message)
    this.name = "OpError"
    this.code = code
  }
}

// Resolves "5.b.1" to the chain of rows below the feedback; [] is the feedback itself.
function resolve(feedback: Feedback, rowId: string): Row[] {
  const [num, ...path] = rowId.split(".")
  if (Number(num) !== feedback.number || path.length > 2) {
    throw new OpError("not-found", `No row ${rowId}`)
  }
  const chain: Row[] = []
  let level = feedback.rows
  for (const label of path) {
    const row = level.find((r) => r.label === label)
    if (!row) throw new OpError("not-found", `No row ${rowId}`)
    chain.push(row)
    level = row.children
  }
  return chain
}

function target(feedback: Feedback, rowId: string): Row {
  const row = resolve(feedback, rowId).at(-1)
  if (!row) throw new OpError("not-found", `${rowId} is a feedback title, not a row`)
  return row
}

// Retired labels that sit directly under `parentId`.
function retiredUnder(retired: string[], parentId: string): string[] {
  const prefix = parentId + "."
  return retired
    .filter((id) => id.startsWith(prefix) && !id.slice(prefix.length).includes("."))
    .map((id) => id.slice(prefix.length))
}

function ids(row: Row, id: string): string[] {
  return [id, ...row.children.flatMap((c) => ids(c, `${id}.${c.label}`))]
}

function build(draft: DraftRow, label: string): Row {
  return {
    label,
    text: draft.text,
    status: "open",
    pins: draft.pins ?? [],
    history: [],
    extra: [],
    children: [],
  }
}

// Appends `drafts` under `siblings`; `parentId` is the id of their parent.
function append(
  siblings: Row[],
  drafts: DraftRow[],
  parentId: string,
  depth: 1 | 2,
  retired: string[],
  added: string[]
) {
  for (const draft of drafts) {
    if (depth === 2 && draft.children.length) {
      throw new OpError("locked", "Rows nest two levels deep at most")
    }
    const taken = [...siblings.map((s) => s.label), ...retiredUnder(retired, parentId)]
    const row = build(draft, nextLabel(depth, taken))
    siblings.push(row)
    const id = `${parentId}.${row.label}`
    added.push(id)
    if (draft.children.length) {
      append(row.children, draft.children, id, 2, retired, added)
    }
  }
}

function height(row: Row): number {
  return row.children.length ? 1 + Math.max(...row.children.map(height)) : 0
}

// A moved row's lines change depth: its unrecognised lines (📎 links among
// them) shift with it, or they would read as its parent's.
function reindent(row: Row, delta: number) {
  row.extra = row.extra.map((line) =>
    delta > 0 ? " ".repeat(delta) + line : line.replace(new RegExp(`^ {0,${-delta}}`), "")
  )
  row.children.forEach((c) => reindent(c, delta))
}

// The files of `from` are renamed to `to` on disk; the lines naming them follow.
function renameRefs(row: Row, from: string, to: string) {
  const swap = (text: string) =>
    text.split(`/${from}-`).join(`/${to}-`).split(`[${from}-`).join(`[${to}-`)
  row.pins = row.pins.map((p) => (p.screenshot ? { ...p, screenshot: swap(p.screenshot) } : p))
  row.extra = row.extra.map(swap)
}

function moveRow(feedback: Feedback, rowId: string, parentId: string, result: OpResult) {
  const chain = resolve(feedback, rowId)
  const row = chain.at(-1)
  if (!row) throw new OpError("not-found", `${rowId} is a feedback title, not a row`)
  if (parentId === rowId || parentId.startsWith(rowId + ".")) {
    throw new OpError("locked", `${rowId} cannot go under itself`)
  }
  const parentChain = resolve(feedback, parentId)
  if (parentChain.length > 1) throw new OpError("locked", "Rows nest two levels deep at most")
  const depth = (parentChain.length + 1) as 1 | 2
  if (depth + height(row) > 2) throw new OpError("locked", "Rows nest two levels deep at most")
  const from = chain.length === 1 ? feedback.rows : chain[0].children
  const to = parentChain.length ? parentChain[0].children : feedback.rows
  if (from === to) return
  from.splice(from.indexOf(row), 1)
  reindent(row, (depth - chain.length) * 2)
  row.label = nextLabel(
    depth,
    to.map((r) => r.label)
  )
  to.push(row)
  const walk = (r: Row, oldId: string, newId: string) => {
    result.movedRowIds.push([oldId, newId])
    renameRefs(r, oldId, newId)
    r.children.forEach((c) => walk(c, `${oldId}.${c.label}`, `${newId}.${c.label}`))
  }
  walk(row, rowId, `${parentId}.${row.label}`)
}

export function applyOp(feedback: Feedback, op: Op, retired: string[]): OpResult {
  const next = structuredClone(feedback)
  const result: OpResult = {
    feedback: next,
    retired: [...retired],
    addedRowIds: [],
    deletedRowIds: [],
    movedRowIds: [],
  }
  switch (op.kind) {
    case "setStatus": {
      const chain = resolve(next, op.rowId)
      const row = chain.at(-1)
      if (row) row.status = op.status
      else next.status = op.status
      break
    }
    case "refine": {
      const row = resolve(next, op.rowId).at(-1)
      if (row) {
        row.history.push({ kind: "before", text: row.text })
        row.text = op.text
        row.status = "open"
      } else {
        next.history.push({ kind: "before", text: next.title })
        next.title = op.text
        next.status = "open"
      }
      break
    }
    case "editText": {
      const row = resolve(next, op.rowId).at(-1)
      const holder = row ?? next
      const status = row ? row.status : (next.status ?? "open")
      if (status !== "open" || holder.history.some((h) => h.kind === "claude")) {
        throw new OpError("locked", `${op.rowId} can no longer be edited silently`)
      }
      if (row) row.text = op.text
      else next.title = op.text
      break
    }
    case "addChild": {
      const chain = resolve(next, op.rowId)
      if (chain.length === 2) {
        throw new OpError("locked", "Rows nest two levels deep at most")
      }
      const siblings = chain.length ? chain[0].children : next.rows
      append(siblings, [op.row], op.rowId, chain.length ? 2 : 1, result.retired, result.addedRowIds)
      break
    }
    case "addPin": {
      const holder = resolve(next, op.rowId).at(-1) ?? next
      holder.pins.push(op.pin)
      break
    }
    case "removePin": {
      const holder = resolve(next, op.rowId).at(-1) ?? next
      if (!holder.pins[op.index]) {
        throw new OpError("not-found", `${op.rowId} has no pin ${op.index + 1}`)
      }
      holder.pins.splice(op.index, 1)
      break
    }
    case "attach":
      resolve(next, op.rowId)
      break
    case "moveRow":
      moveRow(next, op.rowId, op.parentId, result)
      break
    case "deleteRow": {
      const chain = resolve(next, op.rowId)
      const row = chain.at(-1)
      if (!row) throw new OpError("not-found", `${op.rowId} is a feedback title, not a row`)
      const siblings = chain.length === 1 ? next.rows : chain[0].children
      siblings.splice(siblings.indexOf(row), 1)
      result.deletedRowIds = ids(row, op.rowId)
      result.retired.push(...result.deletedRowIds.filter((id) => !result.retired.includes(id)))
      break
    }
  }
  return result
}

export function newFeedback(
  number: number,
  title: string,
  rows: DraftRow[],
  pins: PinRef[]
): { feedback: Feedback; rowIds: string[] } {
  // The title carries a tag of its own: the feedback as a whole is a thing
  // to do, counted, filtered and handed to Claude like a row.
  const feedback: Feedback = {
    number,
    title,
    status: "open",
    pins,
    history: [],
    preamble: [],
    rows: [],
  }
  const rowIds: string[] = []
  append(feedback.rows, rows, String(number), 1, [], rowIds)
  return { feedback, rowIds }
}
