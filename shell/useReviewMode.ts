import { useCallback, useEffect, useState } from "react"
import { readKey, writeKey } from "./prefs.ts"

// ⌃R — Control, never Command (⌘R stays the browser's reload).
export function isReviewToggle(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r"
}

// Review mode, persisted at `design-review:mode`. ⌃R toggles it from either
// document, even inside a text field. The frame's listener dies with its
// document, so it is re-attached on every frame `load`.
export function useReviewMode(
  frame: HTMLIFrameElement | null
): [on: boolean, set: (v: boolean) => void] {
  const [on, setOn] = useState(() => readKey("mode") === "on")

  useEffect(() => {
    writeKey("mode", on ? "on" : "off")
  }, [on])

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isReviewToggle(e)) return
    e.preventDefault()
    e.stopPropagation()
    if (!e.repeat) setOn((v) => !v)
  }, [])

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [onKeyDown])

  useEffect(() => {
    if (!frame) return
    let attached: Window | null = null
    const detach = () => {
      try {
        attached?.removeEventListener("keydown", onKeyDown, true)
      } catch {
        // The old document is gone.
      }
      attached = null
    }
    const attach = () => {
      detach()
      const win = frame.contentWindow
      if (!win) return
      try {
        win.addEventListener("keydown", onKeyDown, true)
        attached = win
      } catch {
        // Cross-origin: the frame keeps its keys.
      }
    }
    frame.addEventListener("load", attach)
    if (frame.contentDocument?.readyState === "complete") attach()
    return () => {
      frame.removeEventListener("load", attach)
      detach()
    }
  }, [frame, onKeyDown])

  return [on, setOn]
}
