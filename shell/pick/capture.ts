// Real pixels of the tab via getDisplayMedia, and the app's localStorage.
import type { PinRecord, PinRef } from "../../model/types.ts"

// What a pick hands back. No `png` when screen capture was refused or is
// unavailable: the pin still records where and what, just without a picture.
export type CapturedPin = { pin: PinRef; record: PinRecord; png?: string; state: string }

const OUTLINE = "#e11d48"

let stream: MediaStream | null = null
let pending: Promise<MediaStream | null> | null = null
let refused = false
let video: HTMLVideoElement | null = null

const live = (s: MediaStream | null) =>
  Boolean(s && s.getVideoTracks().some((t) => t.readyState === "live"))

// One getDisplayMedia per shell session, kept for reuse (it survives frame
// reloads and HMR, since it lives in the shell). Must be called inside the
// click or keydown that started the pick: the browser wants a user gesture.
// A refusal is remembered for the session; a stream he stopped sharing is
// asked for again.
export function ensureStream(): Promise<MediaStream | null> {
  if (live(stream)) return Promise.resolve(stream)
  if (pending) return pending
  if (refused || !navigator.mediaDevices?.getDisplayMedia) return Promise.resolve(null)
  stream = null
  const options = { video: true, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions
  pending = navigator.mediaDevices
    .getDisplayMedia(options)
    .then(
      (s) => {
        stream = s
        return s
      },
      () => {
        refused = true
        return null
      }
    )
    .finally(() => {
      pending = null
    })
  return pending
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function playing(s: MediaStream): Promise<HTMLVideoElement> {
  if (!video) {
    video = document.createElement("video")
    video.muted = true
    video.playsInline = true
  }
  if (video.srcObject !== s) video.srcObject = s
  if (video.readyState < 2 || video.paused) {
    await new Promise<void>((resolve) => {
      const v = video!
      if (v.readyState >= 2) return resolve()
      v.addEventListener("loadeddata", () => resolve(), { once: true })
    })
    await video.play().catch(() => undefined)
  }
  return video
}

// A frame captured after the caller's last paint. The tab only produces
// frames when something changes on screen, so a still page may never call
// back: the wait is bounded by a few animation frames instead.
async function freshFrame(v: HTMLVideoElement) {
  const withCallback = v as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number
  }
  if (!withCallback.requestVideoFrameCallback) {
    await nextFrame()
    return
  }
  let done = false
  const callback = new Promise<void>((resolve) =>
    withCallback.requestVideoFrameCallback!(() => {
      done = true
      resolve()
    })
  )
  const bounded = (async () => {
    for (let i = 0; i < 6 && !done; i++) await nextFrame()
  })()
  await Promise.race([callback, bounded])
}

// Draws the current frame into a canvas (scaled by the track's width over
// `innerWidth`, so device pixels stay sharp), crops it to `crop` and strokes
// `outline` in red. Both rects are in the shell window's CSS pixels.
export async function grabPng(s: MediaStream, crop: DOMRect, outline: DOMRect): Promise<string> {
  const v = await playing(s)
  await freshFrame(v)
  const scale = v.videoWidth / window.innerWidth || 1
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(crop.width * scale))
  canvas.height = Math.max(1, Math.round(crop.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("No 2D canvas")
  ctx.drawImage(
    v,
    crop.x * scale,
    crop.y * scale,
    crop.width * scale,
    crop.height * scale,
    0,
    0,
    canvas.width,
    canvas.height
  )
  ctx.strokeStyle = OUTLINE
  ctx.lineWidth = 2 * scale
  ctx.strokeRect(
    (outline.x - crop.x) * scale,
    (outline.y - crop.y) * scale,
    outline.width * scale,
    outline.height * scale
  )
  return canvas.toDataURL("image/png").split(",")[1] ?? ""
}

// Every localStorage key but the tool's own, as one JSON object.
export function snapshotLocalStorage(): string {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key === null || key.startsWith("design-review:")) continue
    const value = localStorage.getItem(key)
    if (value !== null) out[key] = value
  }
  return JSON.stringify(out)
}

// Restore state: the app's keys become exactly the snapshot's; the tool's
// own keys are left alone.
export function restoreLocalStorage(snapshot: Record<string, unknown>) {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key !== null && !key.startsWith("design-review:")) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
  for (const [key, value] of Object.entries(snapshot)) {
    if (!key.startsWith("design-review:") && typeof value === "string") {
      localStorage.setItem(key, value)
    }
  }
}
