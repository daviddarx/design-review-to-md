import { promises as fs } from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { parsePoint, serializePoint } from "../model/markdown.ts"
import { pointFileBase } from "../model/labels.ts"
import { applyOp as applyModelOp, newPoint, OpError } from "../model/ops.ts"
import type { DraftRow, Op, OpResult } from "../model/ops.ts"
import type { PinRef, Point, Row, TopicMeta } from "../model/types.ts"

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

function safeTopic(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || !TOPIC_PATTERN.test(trimmed) || /^\.+$/.test(trimmed)) {
    throw new StorageError(400, `Invalid topic name: ${JSON.stringify(name)}`)
  }
  return trimmed.replace(/ /g, "-")
}

function safeAssetName(name: string): string {
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

// "$0", "$0.1", … in the same pre-order that `newPoint` / `append` emit ids.
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

// Row (or the point itself) addressed by a real id like "5", "5.b", "5.b.1".
function holderOf(point: Point, rowId: string): { pin?: PinRef } | undefined {
  const [, ...labels] = rowId.split(".")
  let holder: { pin?: PinRef } = point
  let level: Row[] = point.rows
  for (const label of labels) {
    const row = level.find((r) => r.label === label)
    if (!row) return undefined
    holder = row
    level = row.children
  }
  return holder
}

export class Storage {
  private root: string
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

  private topicDir(topic: string): string {
    return path.join(this.root, safeTopic(topic))
  }

  private async atomicWrite(file: string, data: string | Buffer) {
    const tmp = path.join(path.dirname(file), `.tmp-${randomBytes(6).toString("hex")}`)
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, file)
  }

  private async readMeta(dir: string): Promise<TopicMeta> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, "topic.json"), "utf8"))
      return {
        nextPoint: Number(raw.nextPoint) || 1,
        retired: Array.isArray(raw.retired) ? raw.retired.map(String) : [],
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          await fs.access(dir)
        } catch {
          throw new StorageError(404, "No such topic")
        }
        return { nextPoint: 1, retired: [] }
      }
      throw err
    }
  }

  private writeMeta(dir: string, meta: TopicMeta) {
    return this.atomicWrite(path.join(dir, "topic.json"), JSON.stringify(meta, null, 2) + "\n")
  }

  private async pointFiles(dir: string): Promise<{ file: string; number: number }[]> {
    const names = await fs.readdir(dir)
    return names
      .map((file) => ({ file, m: /^(\d+)-.*\.md$/.exec(file) }))
      .filter((x): x is { file: string; m: RegExpExecArray } => x.m !== null)
      .map((x) => ({ file: x.file, number: Number(x.m[1]) }))
      .sort((a, b) => a.number - b.number)
  }

  private async findPoint(dir: string, n: number) {
    try {
      const found = (await this.pointFiles(dir)).find((f) => f.number === n)
      if (found) return found.file
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }
    throw new StorageError(404, `No point ${n}`)
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

  // Points the written pin lines at the asset files that were saved with them.
  private linkPins(point: Point, folder: string, ids: string[], assets: Asset[]) {
    for (const id of ids) {
      const holder = holderOf(point, id)
      if (holder?.pin && assets.some((a) => a.rowId === id && a.name === "pin.png")) {
        holder.pin = { ...holder.pin, screenshot: `${folder}/${id}-pin.png` }
      }
    }
  }

  private mapAssets(assets: Asset[], pointNumber: number, draftMap: Map<string, string>): Asset[] {
    return assets.map((a) => {
      const name = safeAssetName(a.name)
      let rowId: string | undefined
      if (a.rowId === "$point") rowId = String(pointNumber)
      else if (a.rowId.startsWith("$")) rowId = draftMap.get(a.rowId)
      else if (REAL_ROW_ID.test(a.rowId) && a.rowId.split(".")[0] === String(pointNumber)) {
        rowId = a.rowId
      }
      if (!rowId) throw new StorageError(400, `Unknown asset row ${a.rowId}`)
      if (typeof a.dataBase64 !== "string") throw new StorageError(400, "Invalid asset data")
      return { ...a, name, rowId }
    })
  }

  async listTopics(): Promise<string[]> {
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

  async createTopic(name: string): Promise<void> {
    const dir = this.topicDir(name)
    return this.serial(async () => {
      await fs.mkdir(this.root, { recursive: true })
      try {
        await fs.mkdir(dir)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          throw new StorageError(409, "Topic already exists")
        }
        throw err
      }
      await this.writeMeta(dir, { nextPoint: 1, retired: [] })
    })
  }

  async readTopic(
    topic: string
  ): Promise<{ meta: TopicMeta; points: { file: string; point: Point }[] }> {
    const dir = this.topicDir(topic)
    const meta = await this.readMeta(dir)
    const points = []
    for (const { file } of await this.pointFiles(dir)) {
      points.push({ file, point: parsePoint(await fs.readFile(path.join(dir, file), "utf8")) })
    }
    return { meta, points }
  }

  async createPoint(
    topic: string,
    title: string,
    rows: DraftRow[],
    pin: PinRef | undefined,
    assets: Asset[]
  ): Promise<{ number: number; rowIds: string[] }> {
    const dir = this.topicDir(topic)
    return this.serial(async () => {
      if (!title.trim()) throw new StorageError(400, "A point needs a title")
      const meta = await this.readMeta(dir)
      const number = meta.nextPoint
      let created
      try {
        created = newPoint(number, title.trim(), rows, pin)
      } catch (err) {
        modelError(err)
      }
      const { point, rowIds } = created
      const draftMap = new Map(draftPaths(rows).map((p, i) => [p, rowIds[i]]))
      const mapped = this.mapAssets(assets, number, draftMap)
      const base = pointFileBase(number, point.title)
      this.linkPins(point, base, [String(number), ...rowIds], mapped)
      await this.writeMeta(dir, { ...meta, nextPoint: number + 1 })
      await this.writeAssets(dir, base, mapped)
      await this.atomicWrite(path.join(dir, `${base}.md`), serializePoint(point))
      return { number, rowIds }
    })
  }

  async applyOp(topic: string, pointNumber: number, op: Op, assets: Asset[]): Promise<OpResult> {
    const dir = this.topicDir(topic)
    return this.serial(async () => {
      const file = await this.findPoint(dir, pointNumber)
      const folder = file.replace(/\.md$/, "")
      const meta = await this.readMeta(dir)
      // Fresh read every time: anything Claude wrote by hand survives.
      const point = parsePoint(await fs.readFile(path.join(dir, file), "utf8"))
      let result: OpResult
      try {
        result = applyModelOp(point, op, meta.retired)
      } catch (err) {
        modelError(err)
      }
      const draftMap = new Map<string, string>()
      if (op.kind === "addChild") {
        draftPaths([op.row]).forEach((p, i) => draftMap.set(p, result.addedRowIds[i]))
      }
      const mapped = this.mapAssets(assets, pointNumber, draftMap)
      const touched = [...result.addedRowIds]
      if (op.kind === "setPin") touched.push(op.rowId)
      this.linkPins(result.point, folder, touched, mapped)
      await this.writeAssets(dir, folder, mapped)
      if (op.kind === "setPin" && !op.pin) {
        await this.removeAssets(dir, folder, [`${op.rowId}-pin.`])
      }
      if (result.deletedRowIds.length) {
        await this.removeAssets(
          dir,
          folder,
          result.deletedRowIds.map((id) => `${id}-`)
        )
      }
      if (result.retired.length !== meta.retired.length) {
        await this.writeMeta(dir, { ...meta, retired: result.retired })
      }
      await this.atomicWrite(path.join(dir, file), serializePoint(result.point))
      return result
    })
  }

  async deletePoint(topic: string, pointNumber: number): Promise<void> {
    const dir = this.topicDir(topic)
    return this.serial(async () => {
      const file = await this.findPoint(dir, pointNumber)
      const meta = await this.readMeta(dir)
      const id = String(pointNumber)
      if (!meta.retired.includes(id)) {
        await this.writeMeta(dir, { ...meta, retired: [...meta.retired, id] })
      }
      await fs.rm(path.join(dir, file), { force: true })
      await fs.rm(path.join(dir, file.replace(/\.md$/, "")), { recursive: true, force: true })
    })
  }

  assetPath(topic: string, relative: string): string {
    const dir = this.topicDir(topic)
    const resolved = path.resolve(dir, relative)
    if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
      throw new StorageError(400, "Path escapes the topic folder")
    }
    return resolved
  }
}
