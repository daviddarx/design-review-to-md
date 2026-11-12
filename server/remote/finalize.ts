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
  before?: string // a refined row's latest earlier wording
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
  if (kind === "refined") row.before = lastBefore(holder.history)
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

// Where a pin sat in its screenshot, in the picture's CSS pixels: `rect` the
// element's box, `mouse` the click; a spot (a pin on a canvas) has no box.
export type PinMark = {
  viewport: { width: number; height: number }
  rect: { x: number; y: number; width: number; height: number }
  mouse: { x: number; y: number }
  spot: boolean
}

// What the rendering needs beyond the rows: the site the pins' paths are on,
// each screenshot's capture scale so the lightbox shows it as it was seen,
// and for the pins drawn together their marks and unmarked pictures.
type Page = {
  origin: string | null
  dprs: Record<string, number>
  marks: Record<string, PinMark>
  plains: Record<string, string> // screenshot path → its unmarked picture, base64
}

// The pin's page on the site, as a full link; only the path when the site's
// URL is not one a link may carry.
function pageLink(path: string, page: Page): string {
  if (!page.origin) return escapeHtml(path)
  const href = escapeHtml(new URL(path, page.origin).href)
  return `<a href="${href}" target="_blank" rel="noopener">${href}</a>`
}

const MARK = "#e11d48"

// The row's pins on one page, numbered in their order, drawn on the latest
// one's unmarked picture: an SVG image, so the lightbox shows it like any.
function combinedSvg(marks: PinMark[], plain: string): string {
  const { width: w, height: h } = marks[0].viewport
  const shapes = marks.map((m, i) => {
    const { x, y } = m.mouse
    const outline = m.spot
      ? `<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="${MARK}" stroke-width="2"/>`
      : `<rect x="${m.rect.x}" y="${m.rect.y}" width="${m.rect.width}" height="${m.rect.height}" fill="none" stroke="${MARK}" stroke-width="2"/>`
    return `${outline}<circle cx="${x}" cy="${y}" r="10" fill="${MARK}" stroke="#fff" stroke-width="1.5"/><text x="${x}" y="${y}" fill="#fff" font-family="system-ui, sans-serif" font-size="12" font-weight="700" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="data:image/png;base64,${plain}" width="${w}" height="${h}"/>${shapes.join("")}</svg>`
}

const sameSize = (a: PinMark, b: PinMark) =>
  a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height

// The pins of `pins` that can be drawn together: those on `path` with a
// screenshot and a mark, all captured at one window size, the latest with
// its unmarked picture. Fewer than two: none.
function together(pins: PinRef[], path: string, page: Page): PinRef[] {
  const group = pins.filter((p) => p.path === path && p.screenshot && page.marks[p.screenshot])
  const last = group.at(-1)?.screenshot
  if (group.length < 2 || !last || !page.plains[last]) return []
  const first = page.marks[group[0].screenshot!]
  return group.every((p) => sameSize(page.marks[p.screenshot!], first)) ? group : []
}

// `files` (the row's attachments) sit under the first pin's link, above its
// picture; without a pin, on their own.
function pinsHtml(pins: PinRef[], page: Page, files = ""): string {
  if (!pins.length) return files
  const drawn = new Set<PinRef>()
  return pins
    .map((p, i) => {
      if (drawn.has(p)) return ""
      const caption = `<figcaption>${pageLink(p.path, page)}</figcaption>${i === 0 ? files : ""}`
      const group = together(pins, p.path, page)
      if (group[0] === p) {
        for (const g of group) drawn.add(g)
        const marks = group.map((g) => page.marks[g.screenshot!])
        const svg = combinedSvg(marks, page.plains[group.at(-1)!.screenshot!])
        const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
        return `<figure class="pin">${caption}<img src="${src}" alt=""></figure>`
      }
      const dpr = p.screenshot ? page.dprs[p.screenshot] : undefined
      const img = p.screenshot
        ? `<img src="${escapeHtml(p.screenshot)}" alt=""${dpr ? ` data-dpr="${dpr}"` : ""}>`
        : ""
      return `<figure class="pin">${caption}${img}</figure>`
    })
    .join("")
}

function attachmentsHtml(links: string[]): string {
  if (!links.length) return ""
  const items = links.map((link) => {
    const name = escapeHtml(fileName(link))
    return `<li>${isSafeLink(link) ? `<a href="${escapeHtml(link)}">${name}</a>` : name}</li>`
  })
  return `<div class="files"><p>Attached data</p><ul>${items.join("")}</ul></div>`
}

// One line of the list: the id in the reserved left column, everything else
// starting at the same x beside it, as in the panel.
function lineHtml(id: string, head: string, rest: string, cls: string): string {
  return `<div class="line ${cls}"><span class="id">${escapeHtml(id)}</span><div class="body">${head}${rest}</div></div>`
}

// Badge, then `Before:`, pins and attachments: what a row and a rowless feedback share.
function detailsHtml(row: HandOverRow, page: Page): { badge: string; rest: string } {
  const label = BADGES[row.kind]
  const badge = label ? ` <span class="badge ${row.kind}">${label}</span>` : ""
  const before =
    row.before !== undefined ? `<p class="before">Before: ${escapeHtml(row.before)}</p>` : ""
  return { badge, rest: before + pinsHtml(row.pins, page, attachmentsHtml(row.attachments)) }
}

// Sub-rows follow their row at the same indent: the id column tells them apart.
function rowHtml(row: HandOverRow, page: Page): string {
  const { badge, rest } = detailsHtml(row, page)
  const head = `<p class="text">${escapeHtml(row.text)}${badge}</p>`
  return lineHtml(row.id, head, rest, row.kind) + row.children.map((c) => rowHtml(c, page)).join("")
}

function feedbackHtml(feedback: Feedback, rows: HandOverRow[], page: Page): string {
  const title = escapeHtml(feedback.title)
  const id = String(feedback.number)
  if (!feedback.rows.length) {
    const { badge, rest } = detailsHtml(rows[0], page)
    return `<section>${lineHtml(id, `<h2>${title}${badge}</h2>`, rest, "title")}</section>`
  }
  const own = pinsHtml(feedback.pins, page, attachmentsHtml(attachments(feedback.preamble)))
  return `<section>${lineHtml(id, `<h2>${title}</h2>`, own, "title")}${rows
    .map((r) => rowHtml(r, page))
    .join("")}</section>`
}

const STYLE = `
:root { color-scheme: light; --id: 64px; }
body { margin: 0; background: #f8fafc; color: #0f172a; font: 400 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 24px 24px 48px; }
header h1 { margin: 0 0 2px; font-size: 18px; font-weight: 600; }
header p { margin: 0; color: #64748b; }
header a { color: inherit; }
section { margin-top: 24px; padding: 16px 20px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
.line { display: grid; grid-template-columns: var(--id) minmax(0, 1fr); margin-top: 12px; }
.line.title { margin-top: 0; }
.id, .text, h2 { font-size: 14px; font-weight: 600; }
.id { color: #0f172a; }
h2, .text { margin: 0; }
.context .text { color: #64748b; }
.badge { margin-left: 6px; padding: 0 6px; border-radius: 999px; font: 500 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; vertical-align: 1px; }
.badge.new, .badge.refined { background: #dbeafe; color: #1e40af; }
.badge.still-open { background: #fef3c7; color: #92400e; }
.before { margin: 2px 0 0; color: #64748b; }
.pin { margin: 6px 0 0; }
.pin figcaption { font-size: 12px; overflow-wrap: anywhere; }
.pin figcaption a { color: #2563eb; }
.pin img { display: block; max-width: 100%; margin-top: 4px; border: 1px solid #e2e8f0; border-radius: 4px; cursor: zoom-in; }
.files { margin: 6px 0 0; font-size: 13px; }
.files p { margin: 0; color: #0f172a; font-weight: 600; }
.files ul { margin: 0; padding: 0; list-style: none; }
.empty { margin-top: 24px; color: #64748b; }
#lightbox { position: fixed; inset: 0; overflow: hidden; background: rgba(15, 23, 42, 0.88); cursor: zoom-out; }
#lightbox[hidden] { display: none; }
#lightbox img { position: absolute; max-width: none; }
`

// Click a screenshot: shown 1:1 (at the size it was on his screen when
// pinned). Bigger than the window, it follows the mouse so every part can be
// seen at that size. Click or Escape closes it.
const SCRIPT = `
const box = document.getElementById("lightbox")
const big = box.querySelector("img")
const place = (x, y) => {
  const w = big.offsetWidth, h = big.offsetHeight, W = innerWidth, H = innerHeight
  big.style.left = (w > W ? -(w - W) * (x / W) : (W - w) / 2) + "px"
  big.style.top = (h > H ? -(h - H) * (y / H) : (H - h) / 2) + "px"
}
const close = () => { box.hidden = true; big.removeAttribute("src") }
document.addEventListener("click", (e) => {
  const img = e.target.closest(".pin img")
  if (img) {
    const dpr = Number(img.dataset.dpr) || 1
    big.style.width = img.naturalWidth / dpr + "px"
    big.style.height = img.naturalHeight / dpr + "px"
    big.src = img.src
    box.hidden = false
    place(e.clientX, e.clientY)
  } else if (!box.hidden) close()
})
box.addEventListener("mousemove", (e) => place(e.clientX, e.clientY))
addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) close() })
`

// One page a colleague opens straight from the folder: inline style and
// script only, screenshots by their path in the round.
export function buildIndexHtml(opts: {
  url: string
  round: string
  feedbacks: Feedback[]
  dprs?: Record<string, number> // screenshot path → its capture's devicePixelRatio
  marks?: Record<string, PinMark> // screenshot path → where its pin sat
  plains?: Record<string, string> // screenshot path → its unmarked picture, base64
}): string {
  const page: Page = {
    origin: /^https?:/i.test(opts.url) ? new URL(opts.url).origin : null,
    dprs: opts.dprs ?? {},
    marks: opts.marks ?? {},
    plains: opts.plains ?? {},
  }
  const sections = opts.feedbacks.flatMap((f) => {
    const rows = handOverRows(f)
    return rows.length ? [feedbackHtml(f, rows, page)] : []
  })
  const body = sections.length
    ? sections.join("\n")
    : `<p class="empty">Nothing left to do in this round.</p>`
  const url = escapeHtml(opts.url)
  const round = escapeHtml(opts.round)
  const site = page.origin ? `<a href="${url}" target="_blank" rel="noopener">${url}</a>` : url
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design review — ${round}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header><h1>Design review — ${round}</h1><p>${site}</p></header>
${body}
</main>
<div id="lightbox" hidden><img alt=""></div>
<script>${SCRIPT}</script>
</body>
</html>
`
}

export function readmeText(opts: { url: string; round: string }): string {
  return `# Design review — ${opts.round}

Site: ${opts.url}

Paste this to your coding agent, in your repo:

> Work through every row tagged \`open\` (new or refined) or \`review\` (asked last round, not checked yet) in this folder (${opts.round}) — follow PROTOCOL.md in it. index.html shows the same corrections with their screenshots.
`
}

type PinJson = {
  steps?: {
    viewport?: { width?: unknown; height?: unknown; dpr?: unknown }
    mouse?: PinMark["mouse"]
    element?: { tag?: unknown; rect?: PinMark["rect"] }
    frames?: unknown[]
  }[]
}

// Where a pin sat, from its record; none for a pin inside nested iframes
// (its coordinates are the inner document's) or a record missing a part.
function markOf(step: NonNullable<PinJson["steps"]>[number] | undefined): PinMark | undefined {
  const { viewport: v, mouse, element } = step ?? {}
  if (!v || !mouse || !element?.rect || step?.frames?.length) return undefined
  if (typeof v.width !== "number" || typeof v.height !== "number") return undefined
  const spot = typeof element.tag === "string" && element.tag.toLowerCase() === "canvas"
  return { viewport: { width: v.width, height: v.height }, rect: element.rect, mouse, spot }
}

// Each screenshot's devicePixelRatio and mark, from the pin record beside it
// (`1.a-pin-2.png` → `1.a-pin-2.json`), and the unmarked picture of each
// last pin of a page with several (`1.a-plain-2.png`, in the state root). A
// record missing or unreadable leaves the screenshot at 1, on its own.
async function captureInfo(storage: Storage, review: string, feedbacks: Feedback[]) {
  const lists = feedbacks.flatMap((f) => {
    const rows = (rs: Row[]): PinRef[][] => rs.flatMap((r) => [r.pins, ...rows(r.children)])
    return [f.pins, ...rows(f.rows)]
  })
  const dprs: Record<string, number> = {}
  const marks: Record<string, PinMark> = {}
  const plains: Record<string, string> = {}
  const read = (shot: string, from: RegExp, to: string) =>
    fs.readFile(storage.assetPath(review, shot.replace(from, to)))
  for (const pins of lists) {
    for (const shot of pins.flatMap((p) => (p.screenshot ? [p.screenshot] : []))) {
      try {
        const step = (JSON.parse(String(await read(shot, /\.png$/, ".json"))) as PinJson).steps?.at(
          -1
        )
        const dpr = step?.viewport?.dpr
        if (typeof dpr === "number" && dpr > 0) dprs[shot] = dpr
        const mark = markOf(step)
        if (mark) marks[shot] = mark
      } catch {
        // No record: shown at its pixel size.
      }
    }
    for (const path of new Set(pins.map((p) => p.path))) {
      const shots = pins.filter((p) => p.path === path && p.screenshot)
      const last = shots.at(-1)?.screenshot
      if (shots.length < 2 || !last) continue
      try {
        plains[last] = (await read(last, /-pin(-\d+)?\.png$/, "-plain$1.png")).toString("base64")
      } catch {
        // Captured before plain pictures were kept: its pins stay apart.
      }
    }
  }
  return { dprs, marks, plains }
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
  const list = feedbacks.map((f) => f.feedback)
  const info = await captureInfo(storage, review, list)
  await fs.writeFile(
    path.join(dir, "index.html"),
    buildIndexHtml({ url, round, feedbacks: list, ...info })
  )
  await fs.writeFile(path.join(dir, "readme.md"), readmeText({ url, round }))
  await fs.copyFile(PROTOCOL_FILE, path.join(dir, "PROTOCOL.md"))
  openFolder(dir)
}
