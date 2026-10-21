import { useEffect, useState } from "react"
import { readKey, writeKey } from "./prefs.ts"
import { useShortcut } from "./useShortcut.ts"

// ⌃R — Control, never Command (⌘R stays the browser's reload).
export function isReviewToggle(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r"
}

// Review mode, persisted at `design-review:mode`. ⌃R toggles it from either
// document, even inside a text field (useShortcut re-attaches the frame's
// listener on every frame `load`).
export function useReviewMode(
  frame: HTMLIFrameElement | null
): [on: boolean, set: (v: boolean) => void] {
  const [on, setOn] = useState(() => readKey("mode") === "on")

  useEffect(() => {
    writeKey("mode", on ? "on" : "off")
  }, [on])

  useShortcut(frame, true, isReviewToggle, () => setOn((v) => !v))

  return [on, setOn]
}
