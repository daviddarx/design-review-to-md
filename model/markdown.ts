import type { HistoryEntry, PinRef, Point, Row, Status } from "./types.ts"

const TITLE = /^# (\d+)\. (.*?)(?: `(open|review|done)`)?$/
const ROW = /^(\s*)- ([a-z]+|\d+)\. (.*?)(?: `(open|review|done)`)?$/
const HISTORY = /^(\s*)- (Before|Claude): (.*)$/
const PIN = /^(\s*)📍 (.*?)(?: — !\[\]\((.*)\))?$/

type Open = { row: Row; indent: number }

export function parsePoint(md: string): Point {
  const lines = (md.endsWith("\n") ? md.slice(0, -1) : md).split("\n")
  const point: Point = {
    number: 0,
    title: "",
    history: [],
    preamble: [],
    rows: [],
  }
  let i = 0
  const title = TITLE.exec(lines[0] ?? "")
  if (title) {
    point.number = Number(title[1])
    point.title = title[2]
    if (title[3]) point.status = title[3] as Status
    i = 1
  }

  const stack: Open[] = []
  const header: string[] = []

  // The row a non-row line belongs to: the deepest open row indented less
  // than the line, else the deepest open row.
  const ownerOf = (indent: number): Row | undefined => {
    for (let s = stack.length - 1; s >= 0; s--) {
      if (stack[s].indent < indent) return stack[s].row
    }
    return stack[stack.length - 1]?.row
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    const row = ROW.exec(line)
    if (row && !HISTORY.test(line)) {
      const indent = row[1].length
      while (stack.length && stack[stack.length - 1].indent >= indent) {
        stack.pop()
      }
      const made: Row = {
        label: row[2],
        text: row[3],
        status: (row[4] as Status | undefined) ?? "open",
        history: [],
        extra: [],
        children: [],
      }
      const parent = stack[stack.length - 1]?.row
      if (parent) parent.children.push(made)
      else point.rows.push(made)
      stack.push({ row: made, indent })
      continue
    }
    const pin = PIN.exec(line)
    const history = HISTORY.exec(line)
    const owner = ownerOf(pin ? pin[1].length : (history?.[1].length ?? 0))
    if (pin) {
      const ref: PinRef = pin[3] ? { path: pin[2], screenshot: pin[3] } : { path: pin[2] }
      if (owner) owner.pin = ref
      else point.pin = ref
    } else if (history) {
      const entry: HistoryEntry = {
        kind: history[2] === "Before" ? "before" : "claude",
        text: history[3],
      }
      if (owner) owner.history.push(entry)
      else point.history.push(entry)
    } else if (owner) {
      owner.extra.push(line)
    } else {
      header.push(line)
    }
  }

  // Blank lines around the header are canonical spacing, not content.
  while (header.length && header[0] === "") header.shift()
  while (header.length && header[header.length - 1] === "") header.pop()
  point.preamble = header
  return point
}

function pinLine(pin: PinRef, indent: string): string {
  return `${indent}📍 ${pin.path}${pin.screenshot ? ` — ![](${pin.screenshot})` : ""}`
}

function historyLines(history: HistoryEntry[], indent: string): string[] {
  return history.map((h) => `${indent}- ${h.kind === "before" ? "Before" : "Claude"}: ${h.text}`)
}

function rowLines(row: Row, depth: number): string[] {
  const indent = " ".repeat(depth * 2)
  const inner = indent + "  "
  const out = [`${indent}- ${row.label}. ${row.text} \`${row.status}\``]
  if (row.pin) out.push(pinLine(row.pin, inner))
  out.push(...historyLines(row.history, inner))
  out.push(...row.extra)
  for (const child of row.children) out.push(...rowLines(child, depth + 1))
  return out
}

export function serializePoint(p: Point): string {
  const out = [`# ${p.number}. ${p.title}${p.status ? ` \`${p.status}\`` : ""}`]
  const meta: string[] = []
  if (p.pin) meta.push(pinLine(p.pin, ""))
  meta.push(...historyLines(p.history, ""))
  for (const block of [meta, p.preamble]) {
    if (block.length) out.push("", ...block)
  }
  if (p.rows.length) out.push("")
  for (const row of p.rows) out.push(...rowLines(row, 0))
  return out.join("\n") + "\n"
}
