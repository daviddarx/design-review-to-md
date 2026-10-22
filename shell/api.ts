import { useEffect, useRef } from "react"
import type { DraftRow, Op, OpResult } from "../model/ops.ts"
import type { PinRef, Feedback, ReviewMeta } from "../model/types.ts"
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

const reviewPath = (review: string) => `/reviews/${encodeURIComponent(review)}`

export function listReviews(): Promise<string[]> {
  return request("GET", "/reviews")
}

// Resolves to the sanitized folder name the server actually created.
export function createReview(name: string): Promise<{ name: string }> {
  return request("POST", "/reviews", { name })
}

export function readReview(review: string): Promise<{ meta: ReviewMeta; feedbacks: Feedback[] }> {
  return request("GET", reviewPath(review))
}

export function createFeedback(
  review: string,
  draft: { title: string; rows: DraftRow[]; pin?: PinRef; assets?: Asset[] }
): Promise<{ number: number; rowIds: string[] }> {
  return request("POST", `${reviewPath(review)}/feedbacks`, draft)
}

export function applyOp(
  review: string,
  feedback: number,
  op: Op,
  assets: Asset[] = []
): Promise<OpResult> {
  return request("POST", `${reviewPath(review)}/feedbacks/${feedback}/ops`, { op, assets })
}

export function deleteFeedback(review: string, feedback: number): Promise<{ ok: true }> {
  return request("DELETE", `${reviewPath(review)}/feedbacks/${feedback}`)
}

export function openEditor(file: string, line: number): Promise<{ ok: true }> {
  return request("POST", "/open-editor", { file, line })
}

export function repoRoot(): Promise<{ root: string }> {
  return request("GET", "/repo-root")
}

// URL of a review asset (screenshot, attachment, pin record).
export function fileUrl(review: string, relative: string): string {
  const rest = relative.split("/").map(encodeURIComponent).join("/")
  return `/__review/files/${encodeURIComponent(review)}/${rest}`
}

// One EventSource on the change feed for the hook's lifetime; `onChange`
// runs when the given review changes on disk, and after a reconnect (changes
// may have been missed while the feed was down).
export function useReviewFeed(review: string | null, onChange: () => void) {
  const reviewRef = useRef(review)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    reviewRef.current = review
    onChangeRef.current = onChange
  })

  useEffect(() => {
    const source = new EventSource("/__review/events")
    let opened = false
    source.onopen = () => {
      if (opened && reviewRef.current) onChangeRef.current()
      opened = true
    }
    source.onmessage = (e) => {
      let changed: unknown
      try {
        changed = (JSON.parse(e.data) as { review?: unknown }).review
      } catch {
        return
      }
      if (reviewRef.current && changed === reviewRef.current) onChangeRef.current()
    }
    return () => source.close()
  }, [])
}
