import { createReadStream, promises as fs } from "node:fs"
import type http from "node:http"
import path from "node:path"
import { Storage, StorageError } from "./storage.ts"
import { EditorTargetError, openEditor } from "./openEditor.ts"

const BODY_LIMIT = 50 * 1024 * 1024

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type ApiContext = { storage: Storage; repoRoot: string }

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

// Every failure becomes a JSON `{error}` with a status; nothing escapes.
export function sendError(res: http.ServerResponse, err: unknown) {
  const status =
    err instanceof StorageError || err instanceof HttpError
      ? err.status
      : err instanceof EditorTargetError
        ? 400
        : 500
  if (status === 500) console.error("[design-review]", err)
  const message = err instanceof Error ? err.message : String(err)
  if (res.headersSent) {
    res.destroy()
    return
  }
  sendJson(res, status, { error: message })
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > BODY_LIMIT) throw new HttpError(413, "Body too large")
    chunks.push(chunk as Buffer)
  }
  let body: unknown
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new HttpError(400, "Body is not valid JSON")
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Body must be a JSON object")
  }
  return body as Record<string, unknown>
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new HttpError(400, "Malformed URL")
  }
}

function pointNumber(segment: string): number {
  if (!/^\d+$/.test(segment)) throw new HttpError(400, "Invalid point number")
  return Number(segment)
}

function arrayOf(value: unknown, name: string, fallback?: unknown[]): never[] {
  if (value === undefined && fallback) return fallback as never[]
  if (!Array.isArray(value)) throw new HttpError(400, `${name} must be an array`)
  return value as never[]
}

// Writes must be same-origin JSON: a cross-site page cannot send that
// content type without a preflight this server never answers.
function guardWrite(req: http.IncomingMessage) {
  if (req.headers["sec-fetch-site"] === "cross-site") {
    throw new HttpError(403, "Cross-site requests are refused")
  }
  if (req.method === "POST" && !/^application\/json\b/.test(req.headers["content-type"] ?? "")) {
    throw new HttpError(415, "Expected application/json")
  }
}

// /__review/api/* — `parts` are the raw segments after "api".
export async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  parts: string[],
  ctx: ApiContext
) {
  const { storage } = ctx
  const method = req.method ?? "GET"
  if (method !== "GET") guardWrite(req)
  const [head, rawTopic, sub, rawN, tail] = parts

  // The shell strips it from a source map's absolute `file://` paths to
  // record a pin's source repo-relative.
  if (head === "repo-root" && parts.length === 1 && method === "GET") {
    return sendJson(res, 200, { root: path.resolve(ctx.repoRoot) })
  }
  if (head === "open-editor" && parts.length === 1 && method === "POST") {
    const body = await readJson(req)
    openEditor(ctx.repoRoot, body.file, body.line)
    return sendJson(res, 200, { ok: true })
  }
  if (head !== "topics") throw new HttpError(404, "Not found")

  if (parts.length === 1) {
    if (method === "GET") return sendJson(res, 200, await storage.listTopics())
    if (method === "POST") {
      const { name } = await readJson(req)
      if (typeof name !== "string") throw new HttpError(400, "name must be a string")
      return sendJson(res, 200, { name: await storage.createTopic(name) })
    }
  }
  const topic = rawTopic === undefined ? "" : decode(rawTopic)

  if (parts.length === 2 && method === "GET") {
    const { meta, points } = await storage.readTopic(topic)
    // `folder` lets the shell find a pin's record and state when the pin
    // line has no screenshot to derive it from.
    return sendJson(res, 200, {
      meta,
      points: points.map((p) => ({ ...p.point, folder: p.file.replace(/\.md$/, "") })),
    })
  }
  if (sub === "points") {
    if (parts.length === 3 && method === "POST") {
      const body = await readJson(req)
      if (typeof body.title !== "string") throw new HttpError(400, "title must be a string")
      const result = await storage.createPoint(
        topic,
        body.title,
        arrayOf(body.rows, "rows"),
        (body.pin ?? undefined) as never,
        arrayOf(body.assets, "assets", [])
      )
      return sendJson(res, 200, result)
    }
    if (parts.length === 5 && tail === "ops" && method === "POST") {
      const n = pointNumber(rawN)
      const body = await readJson(req)
      if (!body.op || typeof body.op !== "object") throw new HttpError(400, "op is required")
      const result = await storage.applyOp(
        topic,
        n,
        body.op as never,
        arrayOf(body.assets, "assets", [])
      )
      return sendJson(res, 200, result)
    }
    if (parts.length === 4 && method === "DELETE") {
      await storage.deletePoint(topic, pointNumber(rawN))
      return sendJson(res, 200, { ok: true })
    }
  }
  throw new HttpError(404, "Not found")
}

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
}

// /__review/files/:topic/* — a topic asset, confined to the topic folder.
export async function handleFile(res: http.ServerResponse, parts: string[], ctx: ApiContext) {
  const [rawTopic, ...rest] = parts
  if (!rawTopic || !rest.length) throw new HttpError(404, "Not found")
  const relative = rest.map(decode).join("/")
  const file = ctx.storage.assetPath(decode(rawTopic), relative)
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    throw new HttpError(404, "No such file")
  }
  if (!stat.isFile()) throw new HttpError(404, "No such file")
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": stat.size,
    "cache-control": "no-cache",
  })
  createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res)
}
