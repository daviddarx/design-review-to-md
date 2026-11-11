import { existsSync, promises as fs } from "node:fs"
import path from "node:path"
import type { Feedback, HistoryEntry, PinRef, Row, Status } from "../../model/types.ts"
import { StorageError, type Storage } from "../storage.ts"

// The colleague's agent follows this, not AGENTS.md: the files are read-only to it.
const PROTOCOL_FILE = path.resolve(import.meta.dirname, "../../templates/PROTOCOL.md")

// `context`: a done row kept only as the heading of rows still to do.
export type HandOverKind = "new" | "refined" | "still-open" | "context"
export type HandOverRow = {
  id: string
  text: string
  kind: HandOverKind
  was?: string
  pins: PinRef[]
  attachments: string[] // links relative to the round, as the API hands them over
  children: HandOverRow[]
}

// The same line model/ops.ts reads: `📎 [name](link)`, the link relative to the round.
const ATTACHMENT_LINK = /^\s*📎 \[.+?\]\((.+)\)\s*$/

function attachments(lines: string[]): string[] {
  return lines.flatMap((l) => {
    const m = ATTACHMENT_LINK.exec(l)
    return m ? [m[1]] : []
  })
}

function kindOf(status: Status, history: HistoryEntry[]): Exclude<HandOverKind, "context"> | null {
  if (status === "done") return null
  if (status === "review") return "still-open"
  return history.some((h) => h.kind === "before") ? "refined" : "new"
}

function lastBefore(history: HistoryEntry[]): string | undefined {
  return history.findLast((h) => h.kind === "before")?.text
}

function handOver(
  id: string,
  text: string,
  status: Status,
  holder: { pins: PinRef[]; history: HistoryEntry[] },
  extra: string[],
  children: HandOverRow[]
): HandOverRow | null {
  const kind = kindOf(status, holder.history) ?? (children.length ? "context" : null)
  if (!kind) return null
  const row: HandOverRow = {
    id,
    text,
    kind,
    pins: holder.pins,
    attachments: attachments(extra),
    children,
  }
  if (kind === "refined") row.was = lastBefore(holder.history)
  return row
}

function fromRows(rows: Row[], parentId: string): HandOverRow[] {
  return rows.flatMap((r) => {
    const id = `${parentId}.${r.label}`
    const row = handOver(id, r.text, r.status, r, r.extra, fromRows(r.children, id))
    return row ? [row] : []
  })
}

// What is left for the colleague. A sub-row is classified by its own tag; a
// feedback without rows is a row of its own (an untagged title reads as open,
// like an untagged row).
export function handOverRows(feedback: Feedback): HandOverRow[] {
  if (feedback.rows.length) return fromRows(feedback.rows, String(feedback.number))
  const self = handOver(
    String(feedback.number),
    feedback.title,
    feedback.status ?? "open",
    feedback,
    feedback.preamble,
    []
  )
  return self ? [self] : []
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// Opened from the unzipped folder: a link the page could run is shown, not linked.
const isSafeLink = (link: string) => !/^[a-z][a-z0-9+.-]*:/i.test(link) || /^https?:/i.test(link)

// The link's last segment, as the markdown encoded it.
function fileName(link: string): string {
  const last = link.split("/").at(-1) ?? link
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

const BADGES: Record<HandOverKind, string> = {
  new: "New",
  refined: "Refined",
  "still-open": "Still open from last round",
  context: "",
}

function pinsHtml(pins: PinRef[]): string {
  return pins
    .map(
      (p) =>
        `<figure class="pin"><figcaption>📍 ${escapeHtml(p.path)}</figcaption>${
          p.screenshot ? `<img src="${escapeHtml(p.screenshot)}" alt="">` : ""
        }</figure>`
    )
    .join("")
}

function attachmentsHtml(links: string[]): string {
  if (!links.length) return ""
  const items = links.map((link) => {
    const name = escapeHtml(fileName(link))
    return `<li>📎 ${isSafeLink(link) ? `<a href="${escapeHtml(link)}">${name}</a>` : name}</li>`
  })
  return `<ul class="files">${items.join("")}</ul>`
}

// Badge, then `was:`, pins and attachments: what a row and a rowless feedback share.
function detailsHtml(row: HandOverRow): { badge: string; rest: string } {
  const label = BADGES[row.kind]
  const badge = label ? ` <span class="badge ${row.kind}">${label}</span>` : ""
  const was = row.was !== undefined ? `<p class="was">was: ${escapeHtml(row.was)}</p>` : ""
  return { badge, rest: was + pinsHtml(row.pins) + attachmentsHtml(row.attachments) }
}

function rowHtml(row: HandOverRow): string {
  const { badge, rest } = detailsHtml(row)
  const children = row.children.length
    ? `<ul class="rows">${row.children.map(rowHtml).join("")}</ul>`
    : ""
  return `<li class="row ${row.kind}"><p class="text"><span class="id">${escapeHtml(row.id)}</span> ${escapeHtml(row.text)}${badge}</p>${rest}${children}</li>`
}

function feedbackHtml(feedback: Feedback, rows: HandOverRow[]): string {
  const heading = `${feedback.number}. ${escapeHtml(feedback.title)}`
  if (!feedback.rows.length) {
    const { badge, rest } = detailsHtml(rows[0])
    return `<section><h2>${heading}${badge}</h2>${rest}</section>`
  }
  const own = pinsHtml(feedback.pins) + attachmentsHtml(attachments(feedback.preamble))
  return `<section><h2>${heading}</h2>${own}<ul class="rows">${rows.map(rowHtml).join("")}</ul></section>`
}

const STYLE = `
:root { color-scheme: light; }
body { margin: 0; background: #f8fafc; color: #0f172a; font: 400 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { padding: 20px 24px; background: #1e293b; color: #f1f5f9; }
header h1 { margin: 0 0 4px; font-size: 18px; font-weight: 600; }
header p { margin: 0; color: #94a3b8; }
header a { color: #f1f5f9; }
main { max-width: 960px; margin: 0 auto; padding: 8px 24px 48px; }
section { margin-top: 24px; padding: 16px 20px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
.rows { margin: 0; padding: 0; list-style: none; }
.rows .rows { margin-left: 24px; }
.row { margin-top: 12px; }
.text { margin: 0; font-weight: 500; }
.context > .text { color: #64748b; }
.id { margin-right: 4px; color: #64748b; font: 500 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.badge { margin-left: 6px; padding: 0 6px; border-radius: 999px; font: 500 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
.badge.new, .badge.refined { background: #dbeafe; color: #1e40af; }
.badge.still-open { background: #fef3c7; color: #92400e; }
.was { margin: 2px 0 0; color: #64748b; }
.pin { margin: 6px 0 0; }
.pin figcaption { color: #64748b; font-size: 12px; }
.pin img { display: block; max-width: 100%; margin-top: 4px; border: 1px solid #e2e8f0; border-radius: 4px; }
.files { margin: 6px 0 0; padding: 0; list-style: none; font-size: 13px; }
.empty { margin-top: 24px; color: #64748b; }
`

// One page a colleague opens straight from the folder: no scripts, inline
// style, screenshots by their path in the round.
export function buildIndexHtml(opts: {
  url: string
  round: string
  feedbacks: Feedback[]
}): string {
  const sections = opts.feedbacks.flatMap((f) => {
    const rows = handOverRows(f)
    return rows.length ? [feedbackHtml(f, rows)] : []
  })
  const body = sections.length
    ? sections.join("\n")
    : `<p class="empty">Nothing left to do in this round.</p>`
  const url = escapeHtml(opts.url)
  const round = escapeHtml(opts.round)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design review — ${round}</title>
<style>${STYLE}</style>
</head>
<body>
<header><h1>Design review — ${round}</h1><p><a href="${isSafeLink(opts.url) ? url : ""}">${url}</a></p></header>
<main>
${body}
</main>
</body>
</html>
`
}

export function readmeText(opts: { url: string; round: string }): string {
  return `# Design review — ${opts.round}

Site: ${opts.url}

Paste this to your coding agent, in your repo:

> Work through every row tagged \`open\` or \`review\` in this folder (${opts.round}) — follow PROTOCOL.md in it. index.html shows the same corrections with their screenshots.
`
}

// Writes the hand-over into the round folder, over any earlier one: he can
// edit and finalize again. Zipping and sending stay his.
export async function finalizeRound(
  storage: Storage,
  review: string,
  url: string,
  openFolder: (dir: string) => void
): Promise<void> {
  const dir = path.dirname(storage.assetPath(review, "index.html"))
  if (!existsSync(dir)) throw new StorageError(404, "No such review")
  const { feedbacks } = await storage.readReview(review)
  const round = path.basename(dir)
  await fs.writeFile(
    path.join(dir, "index.html"),
    buildIndexHtml({ url, round, feedbacks: feedbacks.map((f) => f.feedback) })
  )
  await fs.writeFile(path.join(dir, "readme.md"), readmeText({ url, round }))
  await fs.copyFile(PROTOCOL_FILE, path.join(dir, "PROTOCOL.md"))
  openFolder(dir)
}
