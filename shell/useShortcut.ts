import { useEffect, useRef } from "react"
import { watchDocuments } from "./pick/frames.ts"

// A tool shortcut caught in every document — the shell's window, the
// frame's and every same-origin iframe's inside it (a Storybook story's),
// each as it appears, since a key pressed in a nested frame never reaches
// the one above — even inside a text field. Only while `enabled`; otherwise
// the key goes to the app untouched.
export function useShortcut(
  frame: HTMLIFrameElement | null,
  enabled: boolean,
  match: (e: KeyboardEvent) => boolean,
  run: () => void
) {
  const latest = useRef({ enabled, match, run })
  useEffect(() => {
    latest.current = { enabled, match, run }
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { enabled, match, run } = latest.current
      if (!enabled || !match(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) run()
    }

    window.addEventListener("keydown", onKeyDown, true)
    const attached = new Set<Window>()
    const stop = frame
      ? watchDocuments(frame, (_doc, win) => {
          try {
            win.addEventListener("keydown", onKeyDown, true)
            attached.add(win)
          } catch {
            // Cross-origin: the frame keeps its keys.
          }
        })
      : () => {}
    return () => {
      stop()
      window.removeEventListener("keydown", onKeyDown, true)
      for (const win of attached) {
        try {
          win.removeEventListener("keydown", onKeyDown, true)
        } catch {
          // The old document is gone.
        }
      }
    }
  }, [frame])
}
