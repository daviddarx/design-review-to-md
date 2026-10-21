import { useEffect, useRef } from "react"

// A tool shortcut caught in both documents — the shell's window and the
// frame's (re-attached on every frame `load`, since the listener dies with
// its document) — even inside a text field. Only while `enabled`; otherwise
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
      const win = frame?.contentWindow
      if (!win) return
      try {
        win.addEventListener("keydown", onKeyDown, true)
        attached = win
      } catch {
        // Cross-origin: the frame keeps its keys.
      }
    }
    frame?.addEventListener("load", attach)
    if (frame?.contentDocument?.readyState === "complete") attach()
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      frame?.removeEventListener("load", attach)
      detach()
    }
  }, [frame])
}
