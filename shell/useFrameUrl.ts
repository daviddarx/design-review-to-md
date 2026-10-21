import { useEffect } from "react"

type FrameLocation = { pathname: string; search: string; hash: string }

const TOOL_PATH = /^\/__review(\/|$)/

// The shell URL that mirrors the frame's location. The tool's own routes are
// never mirrored: reloading one would serve a tool file, not the shell.
export function frameLocationToShellUrl(loc: FrameLocation): string {
  if (TOOL_PATH.test(loc.pathname)) return "/"
  return loc.pathname + loc.search + loc.hash
}

// The frame's first address is the shell's own, so a reload lands on the
// page that was showing.
export function initialFrameSrc(): string {
  return location.pathname + location.search + location.hash
}

type NavigationTarget = EventTarget

// Mirrors the frame's address into the shell's, with replaceState so the
// shell adds no history entries of its own (the frame owns Back/Forward).
// Listeners on the frame's window die with its document, so they are
// re-attached on every frame `load`.
export function useFrameUrl(frame: HTMLIFrameElement | null) {
  useEffect(() => {
    if (!frame) return
    let detach: (() => void) | undefined

    const mirror = () => {
      try {
        const loc = frame.contentWindow?.location
        if (!loc || !/^https?:$/.test(loc.protocol)) return
        const next = frameLocationToShellUrl(loc)
        const current = location.pathname + location.search + location.hash
        if (next !== current) history.replaceState(null, "", next)
      } catch {
        // A cross-origin document is not ours to mirror.
      }
    }

    const attach = () => {
      detach?.()
      detach = undefined
      const win = frame.contentWindow as (Window & { navigation?: NavigationTarget }) | null
      if (!win) return
      try {
        const nav = win.navigation
        if (nav) {
          // Chromium/Firefox: one event after every same-document navigation.
          nav.addEventListener("navigatesuccess", mirror)
          detach = () => nav.removeEventListener("navigatesuccess", mirror)
        } else {
          // Without the Navigation API, pushState is invisible; Back,
          // Forward and hash changes still are.
          win.addEventListener("popstate", mirror)
          win.addEventListener("hashchange", mirror)
          detach = () => {
            win.removeEventListener("popstate", mirror)
            win.removeEventListener("hashchange", mirror)
          }
        }
      } catch {
        // Cross-origin: nothing to listen to.
      }
    }

    const onLoad = () => {
      mirror()
      attach()
    }

    frame.addEventListener("load", onLoad)
    if (frame.contentDocument?.readyState === "complete") onLoad()
    return () => {
      frame.removeEventListener("load", onLoad)
      detach?.()
    }
  }, [frame])
}
