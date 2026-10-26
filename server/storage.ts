import { existsSync, promises as fs, type Dirent } from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { parseFeedback, serializeFeedback } from "../model/markdown.ts"
import { feedbackFileBase } from "../model/labels.ts"
import { applyOp as applyModelOp, newFeedback, OpError } from "../model/ops.ts"
import { parsePinAssetName, pinAssetName } from "../model/pins.ts"
import type { DraftRow, Op, OpResult } from "../model/ops.ts"
import type { PinRef, Feedback, Row, ReviewMeta } from "../model/types.ts"

export type Asset = { rowId: string; name: string; dataBase64: string }

export class StorageError extends Error {
  status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.name = "StorageError"
    this.status = status
  }
}

const TOPIC_PATTERN = /^[A-Za-z0-9._ -]+$/
const REAL_ROW_ID = /^\d+(\.[a-z]+(\.\d+)?)?$/

function safeReview(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || !TOPIC_PATTERN.test(trimmed) || /^\.+$/.test(trimmed)) {
    throw new StorageError(400, `Invalid review name: ${JSON.stringify(name)}`)
  }
  return trimmed.replace(/ /g, "-")
}

// The names the pin capture writes (`pin.png`, `pin-2.json`, `state.json`,
// …); every other asset is an attachment.
const isPinAsset = (name: string) => parsePinAssetName(name) !== null

function safeAssetName(name: string): string {
  // The picker sends these names exactly; any other spelling of one is an
  // attachment that would land on (or, case-insensitively, over) a pin file.
  if (isPinAsset(name.toLowerCase()) && !isPinAsset(name)) {
    throw new StorageError(400, `${name}: this name is kept for pins`)
  }
  if (
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    name.includes("\0")
  ) {
    throw new StorageError(400, `Invalid asset name: ${JSON.stringify(name)}`)
  }
  return name
}

// "$0", "$0.1", … in the same pre-order that `newFeedback` / `append` emit ids.
function draftPaths(rows: DraftRow[]): string[] {
  const out: string[] = []
  rows.forEach((row, i) => {
    out.push(`$${i}`)
    row.children.forEach((_, j) => out.push(`$${i}.${j}`))
  })
  return out
}

function modelError(err: unknown): never {
  if (err instanceof OpError) {
    throw new StorageError(err.code === "locked" ? 409 : 404, err.message)
  }
  throw err
}

// Row (or the feedback itself) addressed by a real id like "5", "5.b", "5.b.1".
function holderOf(feedback: Feedback, rowId: string): { pins: PinRef[] } | undefined {
  const [, ...labels] = rowId.split(".")
  let holder: { pins: PinRef[] } = feedback
  let level: Row[] = feedback.rows
  for (const label of labels) {
    const row = level.find((r) => r.label === label)
    if (!row) return undefined
    holder = row
    level = row.children
  }
  return holder
}

// Each attachment gets a `📎 [file](folder/file)` line under its row, at the
// row's text indent (the feedback's own go in the preamble). The row's text is
// never touched, and a line already present is not added twice.
function linkAttachments(feedback: Feedback, folder: string, assets: Asset[]) {
  for (const a of assets) {
    if (isPinAsset(a.name)) continue
    const file = `${a.rowId}-${a.name}`
    const link = `📎 [${file}](${folder}/${encodeURIComponent(file)})`
    const [, ...labels] = a.rowId.split(".")
    if (!labels.length) {
      if (!feedback.preamble.some((l) => l.trim() === link)) feedback.preamble.push(link)
      continue
    }
    let row: Row | undefined
    let level = feedback.rows
    for (const label of labels) {
      row = level.find((r) => r.label === label)
      if (!row) break
      level = row.children
    }
    if (!row) continue
    if (!row.extra.some((l) => l.trim() === link)) {
      row.extra.push(" ".repeat(labels.length * 2) + link)
    }
  }
}

// One folder per feedback, `<NN>-<slug>/`, holding its `briefing.md` and
// every file of its pins and attachments. The markdown's links are relative
// to that folder (`![](5-pin.png)`), so they open from the file; in memory,
// and for the shell, they stay relative to the review (`05-nav/5-pin.png`).
export const BRIEFING = "briefing.md"

const ATTACHMENT_LINK = /(📎 \[[^\]]*\]\()([^)]*)(\))/

// A link the markdown cannot mean relative to anything: a URL or an absolute path.
const isRelative = (link: string) => !/^[a-z][a-z0-9+.-]*:/i.test(link) && !link.startsWith("/")

function relink(feedback: Feedback, move: (link: string) => string): Feedback {
  const line = (l: string) => l.replace(ATTACHMENT_LINK, (_, a, link, b) => a + move(link) + b)
  const pins = (list: PinRef[]) =>
    list.map((pin) => (pin.screenshot ? { ...pin, screenshot: move(pin.screenshot) } : pin))
  const row = (r: Row): Row => ({
    ...r,
    pins: pins(r.pins),
    extra: r.extra.map(line),
    children: r.children.map(row),
  })
  return {
    ...feedback,
    pins: pins(feedback.pins),
    preamble: feedback.preamble.map(line),
    rows: feedback.rows.map(row),
  }
}

// `5-pin.png` in `05-nav/briefing.md` → `05-nav/5-pin.png`.
export function fromBriefing(feedback: Feedback, folder: string): Feedback {
  return relink(feedback, (link) =>
    isRelative(link) ? path.posix.normalize(`${folder}/${link}`) : link
  )
}

// And back, for writing: `05-nav/5-pin.png` → `5-pin.png`.
export function toBriefing(feedback: Feedback, folder: string): Feedback {
  return relink(feedback, (link) => (isRelative(link) ? path.posix.relative(folder, link) : link))
}

export class Storage {
  readonly root: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  // Serialises mutations so two requests cannot interleave read-modify-write.
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private reviewDir(review: string): string {
    return path.join(this.root, safeReview(review))
  }

  private async atomicWrite(file: string, data: string | Buffer) {
    const tmp = path.join(path.dirname(file), `.tmp-${randomBytes(6).toString("hex")}`)
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, file)
  }

  // The feedback files are the only record: the next number is one past the
  // highest on disk. Deleting the highest feedback frees its number again.
  private async readMeta(dir: string): Promise<ReviewMeta> {
    const files = await this.feedbackFiles(dir)
    return { nextFeedback: Math.max(0, ...files.map((f) => f.number)) + 1 }
  }

  // A missing review folder is an empty review: git keeps no empty folder, so
  // a review whose last feedback was deleted (or never committed) has none.
  // A numbered folder without a briefing is not a feedback.
  private async feedbackFiles(dir: string): Promise<{ folder: string; number: number }[]> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }
    const found = []
    for (const e of entries) {
      const m = /^(\d+)-/.exec(e.name)
      if (!m || !e.isDirectory() || !existsSync(path.join(dir, e.name, BRIEFING))) continue
      found.push({ folder: e.name, number: Number(m[1]) })
    }
    return found.sort((a, b) => a.number - b.number)
  }

  // A first line too broken to name its number falls back to the folder's.
  private async readFeedback(dir: string, folder: string): Promise<Feedback> {
    const md = await fs.readFile(path.join(dir, folder, BRIEFING), "utf8")
    const feedback = fromBriefing(parseFeedback(md), folder)
    if (!feedback.number) feedback.number = Number(/^(\d+)-/.exec(folder)?.[1] ?? 0)
    return feedback
  }

  private async writeFeedback(dir: string, folder: string, feedback: Feedback) {
    await fs.mkdir(path.join(dir, folder), { recursive: true })
    await this.atomicWrite(
      path.join(dir, folder, BRIEFING),
      serializeFeedback(toBriefing(feedback, folder))
    )
  }

  private async findFeedback(dir: string, n: number) {
    try {
      const found = (await this.feedbackFiles(dir)).find((f) => f.number === n)
      if (found) return found.folder
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }
    throw new StorageError(404, `No feedback ${n}`)
  }

  private async writeAssets(
    dir: string,
    folder: string,
    assets: { rowId: string; name: string; dataBase64: string }[]
  ) {
    if (!assets.length) return
    const assetDir = path.join(dir, folder)
    await fs.mkdir(assetDir, { recursive: true })
    for (const a of assets) {
      await this.atomicWrite(
        path.join(assetDir, `${a.rowId}-${a.name}`),
        Buffer.from(a.dataBase64, "base64")
      )
    }
  }

  // A moved row's files follow its new id: `<old>-x` becomes `<new>-x`.
  private async renameAssets(dir: string, folder: string, pairs: [string, string][]) {
    const assetDir = path.join(dir, folder)
    let names: string[]
    try {
      names = await fs.readdir(assetDir)
    } catch {
      return
    }
    for (const [from, to] of pairs) {
      for (const name of names) {
        if (!name.startsWith(`${from}-`)) continue
        await fs.rename(
          path.join(assetDir, name),
          path.join(assetDir, `${to}-${name.slice(from.length + 1)}`)
        )
      }
    }
  }

  private async removeAssets(dir: string, folder: string, prefixes: string[]) {
    const assetDir = path.join(dir, folder)
    let names: string[]
    try {
      names = await fs.readdir(assetDir)
    } catch {
      return
    }
    for (const name of names) {
      if (prefixes.some((p) => name.startsWith(p))) {
        await fs.rm(path.join(assetDir, name), { force: true })
      }
    }
  }

  // Points the written pin lines at the screenshots saved with them.
  private linkPins(feedback: Feedback, folder: string, ids: string[], assets: Asset[]) {
    for (const id of ids) {
      const holder = holderOf(feedback, id)
      holder?.pins.forEach((pin, i) => {
        const png = pinAssetName(i, "png")
        if (assets.some((a) => a.rowId === id && a.name === png)) {
          holder.pins[i] = { ...pin, screenshot: `${folder}/${id}-${png}` }
        }
      })
    }
  }

  // After pin `index` of `rowId` is gone: its files go, and the files of
  // every pin after it move down one place, as the pins themselves did.
  private async shiftPinFiles(
    dir: string,
    folder: string,
    rowId: string,
    index: number,
    pins: PinRef[]
  ) {
    const assetDir = path.join(dir, folder)
    const files = ["png", "json", "state"] as const
    for (const file of files) {
      await fs.rm(path.join(assetDir, `${rowId}-${pinAssetName(index, file)}`), { force: true })
    }
    for (let i = index; i < pins.length; i++) {
      for (const file of files) {
        const from = path.join(assetDir, `${rowId}-${pinAssetName(i + 1, file)}`)
        await fs
          .rename(from, path.join(assetDir, `${rowId}-${pinAssetName(i, file)}`))
          .catch((err: NodeJS.ErrnoException) => {
            if (err.code !== "ENOENT") throw err
          })
      }
      if (pins[i].screenshot) {
        pins[i] = { ...pins[i], screenshot: `${folder}/${rowId}-${pinAssetName(i, "png")}` }
      }
    }
  }

  private mapAssets(
    assets: Asset[],
    feedbackNumber: number,
    draftMap: Map<string, string>
  ): Asset[] {
    return assets.map((a) => {
      const name = safeAssetName(a.name)
      let rowId: string | undefined
      if (a.rowId === "$feedback") rowId = String(feedbackNumber)
      else if (a.rowId.startsWith("$")) rowId = draftMap.get(a.rowId)
      else if (REAL_ROW_ID.test(a.rowId) && a.rowId.split(".")[0] === String(feedbackNumber)) {
        rowId = a.rowId
      }
      if (!rowId) throw new StorageError(400, `Unknown asset row ${a.rowId}`)
      if (typeof a.dataBase64 !== "string") throw new StorageError(400, "Invalid asset data")
      return { ...a, name, rowId }
    })
  }

  async listReviews(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return []
      throw err
    }
  }

  async createReview(name: string): Promise<string> {
    const safe = safeReview(name)
    const dir = path.join(this.root, safe)
    return this.serial(async () => {
      await fs.mkdir(this.root, { recursive: true })
      try {
        await fs.mkdir(dir)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          throw new StorageError(409, "Review already exists")
        }
        throw err
      }
      return safe
    })
  }

  async readReview(
    review: string
  ): Promise<{ meta: ReviewMeta; feedbacks: { folder: string; feedback: Feedback }[] }> {
    const dir = this.reviewDir(review)
    const meta = await this.readMeta(dir)
    const feedbacks = []
    for (const { folder } of await this.feedbackFiles(dir)) {
      feedbacks.push({ folder, feedback: await this.readFeedback(dir, folder) })
    }
    return { meta, feedbacks }
  }

  async createFeedback(
    review: string,
    title: string,
    rows: DraftRow[],
    pins: PinRef[],
    assets: Asset[]
  ): Promise<{ number: number; rowIds: string[] }> {
    const dir = this.reviewDir(review)
    return this.serial(async () => {
      if (!title.trim()) throw new StorageError(400, "Feedback needs a title")
      const meta = await this.readMeta(dir)
      const number = meta.nextFeedback
      await fs.mkdir(dir, { recursive: true })
      let created
      try {
        created = newFeedback(number, title.trim(), rows, pins)
      } catch (err) {
        modelError(err)
      }
      const { feedback, rowIds } = created
      const draftMap = new Map(draftPaths(rows).map((p, i) => [p, rowIds[i]]))
      const mapped = this.mapAssets(assets, number, draftMap)
      const base = feedbackFileBase(number, feedback.title)
      this.linkPins(feedback, base, [String(number), ...rowIds], mapped)
      linkAttachments(feedback, base, mapped)
      await this.writeAssets(dir, base, mapped)
      await this.writeFeedback(dir, base, feedback)
      return { number, rowIds }
    })
  }

  async applyOp(
    review: string,
    feedbackNumber: number,
    op: Op,
    assets: Asset[]
  ): Promise<OpResult> {
    const dir = this.reviewDir(review)
    return this.serial(async () => {
      const folder = await this.findFeedback(dir, feedbackNumber)
      // Fresh read every time: anything Claude wrote by hand survives.
      const feedback = await this.readFeedback(dir, folder)
      let result: OpResult
      try {
        // Labels follow the rows on disk: past the highest sibling.
        result = applyModelOp(feedback, op, [])
      } catch (err) {
        modelError(err)
      }
      const draftMap = new Map<string, string>()
      if (op.kind === "addChild") {
        draftPaths([op.row]).forEach((p, i) => draftMap.set(p, result.addedRowIds[i]))
      }
      let mapped = this.mapAssets(assets, feedbackNumber, draftMap)
      const touched = [...result.addedRowIds]
      const holder = holderOf(result.feedback, op.rowId)
      if (op.kind === "addPin" && holder) {
        // The client names the added pin's files as a first pin's; the server
        // alone knows which place it took.
        const index = holder.pins.length - 1
        mapped = mapped.map((a) => {
          const slot = a.rowId === op.rowId ? parsePinAssetName(a.name) : null
          return slot?.index === 0 ? { ...a, name: pinAssetName(index, slot.file) } : a
        })
        touched.push(op.rowId)
      }
      if (op.kind === "removePin" && holder) {
        await this.shiftPinFiles(dir, folder, op.rowId, op.index, holder.pins)
      }
      this.linkPins(result.feedback, folder, touched, mapped)
      linkAttachments(result.feedback, folder, mapped)
      await this.writeAssets(dir, folder, mapped)
      if (op.kind === "removeFile") {
        // Only a file of that row: the name the server wrote it under.
        const name = safeAssetName(op.file)
        if (name.startsWith(`${op.rowId}-`)) {
          await fs.rm(path.join(dir, folder, name), { force: true })
        }
      }
      if (result.movedRowIds.length) {
        await this.renameAssets(dir, folder, result.movedRowIds)
      }
      if (result.deletedRowIds.length) {
        await this.removeAssets(
          dir,
          folder,
          result.deletedRowIds.map((id) => `${id}-`)
        )
      }
      await this.writeFeedback(dir, folder, result.feedback)
      return result
    })
  }

  async deleteFeedback(review: string, feedbackNumber: number): Promise<void> {
    const dir = this.reviewDir(review)
    return this.serial(async () => {
      const folder = await this.findFeedback(dir, feedbackNumber)
      await fs.rm(path.join(dir, folder), { recursive: true, force: true })
    })
  }

  assetPath(review: string, relative: string): string {
    const dir = this.reviewDir(review)
    const resolved = path.resolve(dir, relative)
    if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
      throw new StorageError(400, "Path escapes the review folder")
    }
    return resolved
  }
}
