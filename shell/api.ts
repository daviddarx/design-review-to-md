import { useEffect, useRef } from "react"
import type { DraftRow, Op, OpResult } from "../model/ops.ts"
import type { PinRef, Point, TopicMeta } from "../model/types.ts"
import type { Asset } from "../server/storage.ts"

export type { Asset }

const BASE = "/__review/api"

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : res.statusText
    throw new ApiError(res.status, message)
  }
  return data as T
}

const topicPath = (topic: string) => `/topics/${encodeURIComponent(topic)}`

export function listTopics(): Promise<string[]> {
  return request("GET", "/topics")
}

// Resolves to the sanitized folder name the server actually created.
export function createTopic(name: string): Promise<{ name: string }> {
  return request("POST", "/topics", { name })
}

export function readTopic(topic: string): Promise<{ meta: TopicMeta; points: Point[] }> {
  return request("GET", topicPath(topic))
}

export function createPoint(
  topic: string,
  draft: { title: string; rows: DraftRow[]; pin?: PinRef; assets?: Asset[] }
): Promise<{ number: number; rowIds: string[] }> {
  return request("POST", `${topicPath(topic)}/points`, draft)
}

export function applyOp(
  topic: string,
  point: number,
  op: Op,
  assets: Asset[] = []
): Promise<OpResult> {
  return request("POST", `${topicPath(topic)}/points/${point}/ops`, { op, assets })
}

export function deletePoint(topic: string, point: number): Promise<{ ok: true }> {
  return request("DELETE", `${topicPath(topic)}/points/${point}`)
}

export function openEditor(file: string, line: number): Promise<{ ok: true }> {
  return request("POST", "/open-editor", { file, line })
}

export function repoRoot(): Promise<{ root: string }> {
  return request("GET", "/repo-root")
}

// URL of a topic asset (screenshot, attachment, pin record).
export function fileUrl(topic: string, relative: string): string {
  const rest = relative.split("/").map(encodeURIComponent).join("/")
  return `/__review/files/${encodeURIComponent(topic)}/${rest}`
}

// One EventSource on the change feed for the hook's lifetime; `onChange`
// runs when the given topic changes on disk, and after a reconnect (changes
// may have been missed while the feed was down).
export function useTopicFeed(topic: string | null, onChange: () => void) {
  const topicRef = useRef(topic)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    topicRef.current = topic
    onChangeRef.current = onChange
  })

  useEffect(() => {
    const source = new EventSource("/__review/events")
    let opened = false
    source.onopen = () => {
      if (opened && topicRef.current) onChangeRef.current()
      opened = true
    }
    source.onmessage = (e) => {
      let changed: unknown
      try {
        changed = (JSON.parse(e.data) as { topic?: unknown }).topic
      } catch {
        return
      }
      if (topicRef.current && changed === topicRef.current) onChangeRef.current()
    }
    return () => source.close()
  }, [])
}
