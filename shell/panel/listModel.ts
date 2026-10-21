import type { HistoryEntry, PinRef, Point, Row, Status } from "../../model/types.ts"

export type Filter = "all" | Status

export type FlatRow = {
  rowId: string
  depth: 0 | 1 | 2
  text: string
  status: Status | undefined
  pin?: PinRef
  history: HistoryEntry[]
  inheritedPinFrom?: string // nearest pinned ancestor, when the row has no pin of its own
}

const STATUSES: Status[] = ["open", "review", "done"]

type Node = { row: FlatRow; children: Node[] }

function rowNode(row: Row, id: string, depth: 1 | 2, pinnedAbove?: string): Node {
  const flat: FlatRow = {
    rowId: id,
    depth,
    text: row.text,
    status: row.status,
    ...(row.pin ? { pin: row.pin } : {}),
    history: row.history,
    ...(!row.pin && pinnedAbove ? { inheritedPinFrom: pinnedAbove } : {}),
  }
  const next = row.pin ? id : pinnedAbove
  return {
    row: flat,
    children: row.children.map((c) => rowNode(c, `${id}.${c.label}`, 2, next)),
  }
}

function pointNode(p: Point): Node {
  const id = String(p.number)
  return {
    row: {
      rowId: id,
      depth: 0,
      text: p.title,
      status: p.status,
      ...(p.pin ? { pin: p.pin } : {}),
      history: p.history,
    },
    children: p.rows.map((r) => rowNode(r, `${id}.${r.label}`, 1, p.pin ? id : undefined)),
  }
}

// A node survives a status filter when it matches or any descendant does,
// so a sub-point is never shown without the rows above it.
function collect(node: Node, filter: Filter, out: FlatRow[]): boolean {
  const below: FlatRow[] = []
  let kept = false
  for (const child of node.children) kept = collect(child, filter, below) || kept
  if (filter === "all" || kept || node.row.status === filter) {
    out.push(node.row, ...below)
    return true
  }
  return false
}

// Points and their rows in reading order, depth-first.
export function flattenRows(points: Point[], filter: Filter): FlatRow[] {
  const out: FlatRow[] = []
  for (const p of points) collect(pointNode(p), filter, out)
  return out
}

// Rows per status; an untagged title row counts nowhere.
export function counts(points: Point[]): Record<Status, number> {
  const result: Record<Status, number> = { open: 0, review: 0, done: 0 }
  for (const row of flattenRows(points, "all")) {
    if (row.status && STATUSES.includes(row.status)) result[row.status]++
  }
  return result
}

// The md carries only the screenshot; the pin record sits beside it in the
// point's asset folder, named after the row that owns the pin.
export function pinRecordPath(pin: PinRef, ownerRowId: string): string {
  const slash = pin.screenshot.lastIndexOf("/")
  const folder = slash === -1 ? "" : pin.screenshot.slice(0, slash + 1)
  return `${folder}${ownerRowId}-pin.json`
}
