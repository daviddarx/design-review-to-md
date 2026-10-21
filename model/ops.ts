import { nextLabel } from "./labels.ts"
import type { PinRef, Point, Row, Status } from "./types.ts"

export type DraftRow = { text: string; pin?: PinRef; children: DraftRow[] }
export type Op =
  | { kind: "setStatus"; rowId: string; status: Status }
  | { kind: "refine"; rowId: string; text: string }
  | { kind: "editText"; rowId: string; text: string }
  | { kind: "addChild"; rowId: string; row: DraftRow }
  | { kind: "setPin"; rowId: string; pin: PinRef | undefined }
  | { kind: "deleteRow"; rowId: string }
export type OpResult = {
  point: Point
  retired: string[]
  addedRowIds: string[]
  deletedRowIds: string[]
}

export class OpError extends Error {
  code: "not-found" | "locked"
  constructor(code: "not-found" | "locked", message: string) {
    super(message)
    this.name = "OpError"
    this.code = code
  }
}

// Resolves "5.b.1" to the chain of rows below the point; [] is the point itself.
function resolve(point: Point, rowId: string): Row[] {
  const [num, ...path] = rowId.split(".")
  if (Number(num) !== point.number || path.length > 2) {
    throw new OpError("not-found", `No row ${rowId}`)
  }
  const chain: Row[] = []
  let level = point.rows
  for (const label of path) {
    const row = level.find((r) => r.label === label)
    if (!row) throw new OpError("not-found", `No row ${rowId}`)
    chain.push(row)
    level = row.children
  }
  return chain
}

function target(point: Point, rowId: string): Row {
  const row = resolve(point, rowId).at(-1)
  if (!row) throw new OpError("not-found", `${rowId} is a point, not a row`)
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
    ...(draft.pin ? { pin: draft.pin } : {}),
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

export function applyOp(point: Point, op: Op, retired: string[]): OpResult {
  const next = structuredClone(point)
  const result: OpResult = {
    point: next,
    retired: [...retired],
    addedRowIds: [],
    deletedRowIds: [],
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
    case "setPin": {
      const row = resolve(next, op.rowId).at(-1)
      const holder = row ?? next
      if (op.pin) holder.pin = op.pin
      else delete holder.pin
      break
    }
    case "deleteRow": {
      const chain = resolve(next, op.rowId)
      const row = chain.at(-1)
      if (!row) throw new OpError("not-found", `${op.rowId} is a point, not a row`)
      const siblings = chain.length === 1 ? next.rows : chain[0].children
      siblings.splice(siblings.indexOf(row), 1)
      result.deletedRowIds = ids(row, op.rowId)
      result.retired.push(...result.deletedRowIds.filter((id) => !result.retired.includes(id)))
      break
    }
  }
  return result
}

export function newPoint(
  number: number,
  title: string,
  rows: DraftRow[],
  pin?: PinRef
): { point: Point; rowIds: string[] } {
  const point: Point = {
    number,
    title,
    ...(pin ? { pin } : {}),
    history: [],
    preamble: [],
    rows: [],
  }
  const rowIds: string[] = []
  append(point.rows, rows, String(number), 1, [], rowIds)
  return { point, rowIds }
}
