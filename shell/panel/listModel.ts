import { pinAssetName } from "../../model/pins.ts"
import type { HistoryEntry, PinRecord, PinRef, Feedback, Row, Status } from "../../model/types.ts"

export type Filter = "all" | Status

export type FlatRow = {
  rowId: string
  depth: 0 | 1 | 2
  text: string
  status: Status | undefined
  pins: PinRef[]
  history: HistoryEntry[]
  inheritedPinFrom?: string // nearest pinned ancestor, when the row has no pin of its own
  attachments: Attachment[] // the row's `📎 [name](path)` lines
  folder?: string // the feedback's asset folder, when the API sent it
}

export type Attachment = { name: string; path: string } // path relative to the review

const ATTACHMENT = /^\s*📎 \[(.+?)\]\((.+)\)\s*$/

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// Attachment lines the server writes under a row (or in a feedback's preamble).
export function attachmentsOf(lines: string[]): Attachment[] {
  return lines.flatMap((line) => {
    const m = ATTACHMENT.exec(line)
    return m ? [{ name: m[1], path: m[2].split("/").map(decode).join("/") }] : []
  })
}

// One pin of a row, with the record beside its screenshot (null when the
// record is missing or unreadable).
export type PinSpot = { pin: PinRef; recordPath: string; record: PinRecord | null }

// What a pinned row's actions (Show pins, Restore state, Open in VS Code)
// hand over: the row that owns the pins — the row itself or the ancestor it
// inherits from — and its pins in order.
export type PinTarget = { ownerRowId: string; pins: PinSpot[] }

const STATUSES: Status[] = ["open", "review", "done"]

type Node = { row: FlatRow; children: Node[] }

function rowNode(row: Row, id: string, depth: 1 | 2, pinnedAbove?: string): Node {
  const flat: FlatRow = {
    rowId: id,
    depth,
    text: row.text,
    status: row.status,
    pins: row.pins,
    history: row.history,
    attachments: attachmentsOf(row.extra),
    ...(!row.pins.length && pinnedAbove ? { inheritedPinFrom: pinnedAbove } : {}),
  }
  const next = row.pins.length ? id : pinnedAbove
  return {
    row: flat,
    children: row.children.map((c) => rowNode(c, `${id}.${c.label}`, 2, next)),
  }
}

function withFolder(node: Node, folder: string) {
  node.row.folder = folder
  node.children.forEach((c) => withFolder(c, folder))
}

function feedbackNode(p: Feedback): Node {
  const id = String(p.number)
  const node: Node = {
    row: {
      rowId: id,
      depth: 0,
      text: p.title,
      status: p.status,
      pins: p.pins,
      history: p.history,
      attachments: attachmentsOf(p.preamble),
    },
    children: p.rows.map((r) => rowNode(r, `${id}.${r.label}`, 1, p.pins.length ? id : undefined)),
  }
  if (p.folder) withFolder(node, p.folder)
  return node
}

// A node survives a status filter when it matches or any descendant does,
// so a row is never shown without the rows above it.
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

// Feedbacks and their rows in reading order, depth-first.
export function flattenRows(feedbacks: Feedback[], filter: Filter): FlatRow[] {
  const out: FlatRow[] = []
  for (const p of feedbacks) collect(feedbackNode(p), filter, out)
  return out
}

// Rows per status; an untagged title row counts nowhere.
export function counts(feedbacks: Feedback[]): Record<Status, number> {
  const result: Record<Status, number> = { open: 0, review: 0, done: 0 }
  for (const row of flattenRows(feedbacks, "all")) {
    if (row.status && STATUSES.includes(row.status)) result[row.status]++
  }
  return result
}

// The md carries only the screenshot; the pin record sits beside it in the
// feedback's asset folder, named after the row that owns the pin and the
// pin's place on it. A pin with no screenshot falls back on the folder the
// API reported.
export function pinRecordPath(
  pin: PinRef,
  ownerRowId: string,
  index: number,
  folder?: string
): string {
  const shot = pin.screenshot ?? ""
  const slash = shot.lastIndexOf("/")
  const dir = slash !== -1 ? shot.slice(0, slash + 1) : folder ? `${folder}/` : ""
  return `${dir}${ownerRowId}-${pinAssetName(index, "json")}`
}

// The localStorage snapshot beside a pin record.
export const statePathOf = (recordPath: string) =>
  recordPath.replace(/-pin(-\d+)?\.json$/, "-state$1.json")

// "New review…" suggestion from the frame's first path segment:
// `/concept-08-4/x` → `08.4`.
export function suggestReviewName(pathname: string): string {
  const first = pathname.split("/").find(Boolean) ?? ""
  const concept = /^concept-(\d+)(?:-(\d+))?$/.exec(first)
  if (concept) return concept[2] ? `${concept[1]}.${concept[2]}` : concept[1]
  return first
}

// A row is one markdown line: a newline typed in the refine field would
// split it and lose its status tag.
export function singleLine(text: string): string {
  return text
    .split(/\s*\n\s*/)
    .join(" ")
    .trim()
}
