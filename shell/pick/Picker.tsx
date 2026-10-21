import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { flushSync } from "react-dom"
import type { PinRecord, PinStep } from "../../model/types.ts"
import { grabPng, snapshotLocalStorage } from "./capture.ts"
import type { CapturedPin } from "./capture.ts"
import { componentName, describe, uniqueSelector } from "./inspect.ts"
import { clearSourceCache, sourceOf } from "../source/sourceLookup.ts"

type Box = { x: number; y: number; width: number; height: number }
type Shown = { box: Box; label: string | null }
type Picked = { el: Element; inTool: boolean; mouse: { x: number; y: number } }

export type Picker = {
  picking: boolean
  // While a frame is grabbed: the toolbar hides unless the pick is inside it.
  hideToolbar: boolean
  startPick(): Promise<CapturedPin | null>
  cancel(): void
  flash(el: Element): void // Go to pin: outline `el` for FLASH_MS
  layer: ReactNode
}

const FLASH_MS = 2000

// Every pointer event a click is made of: the app must receive none of them
// while picking (Base UI opens menus on pointerdown, not on click).
const SWALLOWED = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "dblclick",
  "auxclick",
  "contextmenu",
]

const isElement = (t: EventTarget | null): t is Element =>
  Boolean(t && (t as Node).nodeType === Node.ELEMENT_NODE)

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const block = (e: Event) => {
  e.preventDefault()
  e.stopImmediatePropagation()
}

const sameBox = (a: Box | undefined, b: Box | undefined) =>
  a?.x === b?.x && a?.y === b?.y && a?.width === b?.width && a?.height === b?.height

// The frame's content box in shell coordinates (the screenshot crop).
function frameBox(frame: HTMLIFrameElement): Box {
  const r = frame.getBoundingClientRect()
  return {
    x: r.left + frame.clientLeft,
    y: r.top + frame.clientTop,
    width: frame.clientWidth,
    height: frame.clientHeight,
  }
}

// `el`'s box in shell coordinates, wherever it lives.
function shellBox(el: Element, frame: HTMLIFrameElement | null): Box {
  const r = el.getBoundingClientRect()
  const off = frame && el.ownerDocument !== document ? frameBox(frame) : { x: 0, y: 0 }
  return { x: r.left + off.x, y: r.top + off.y, width: r.width, height: r.height }
}

const rect = (b: Box) => new DOMRect(b.x, b.y, b.width, b.height)

function stepOf({ el, inTool, mouse }: Picked): PinStep {
  const win = el.ownerDocument.defaultView ?? window
  const r = el.getBoundingClientRect()
  const component = componentName(el)
  return {
    url: win.location.href,
    path: inTool ? "(review tool)" : win.location.pathname + win.location.search,
    viewport: { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio },
    mouse,
    element: {
      selector: uniqueSelector(el),
      tag: el.tagName.toLowerCase(),
      ...(component ? { component } : {}),
      text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    },
    inTool,
  }
}

// The inspector. While a pick runs, a full-window layer in the shell
// (pointer-events: none) outlines the hovered element with its label;
// pointer and key listeners sit on both the shell window and the frame's
// window, in the capture phase, so the app never sees the click. The app's
// DOM is only ever read, never changed.
export function usePicker(frame: HTMLIFrameElement | null): Picker {
  const [picking, setPicking] = useState(false)
  const [grab, setGrab] = useState<{ keepToolbar: boolean } | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [flashing, setFlashing] = useState(false)
  const [flashKey, setFlashKey] = useState(0)
  const layerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef(frame)
  const active = useRef(false)
  const hovered = useRef<Picked | null>(null)
  const flashed = useRef<Element | null>(null)
  const cancelRef = useRef<() => void>(() => {})

  useEffect(() => {
    frameRef.current = frame
  }, [frame])

  // One loop draws whatever is outlined (the hovered element, or Go to
  // pin's target), so scrolling and layout changes are followed.
  useEffect(() => {
    if (!picking && !flashing) {
      setShown(null)
      return
    }
    let id = 0
    const tick = () => {
      const target = picking ? hovered.current?.el : flashed.current
      if (target?.isConnected) {
        const box = shellBox(target, frameRef.current)
        const label = picking ? describe(target) : null
        setShown((s) => (s && sameBox(s.box, box) && s.label === label ? s : { box, label }))
      } else {
        setShown(null)
      }
      id = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(id)
  }, [picking, flashing])

  // Each flash restarts the clock.
  const flash = useCallback((el: Element) => {
    flashed.current = el
    setFlashKey((n) => n + 1)
  }, [])
  useEffect(() => {
    if (!flashKey) return
    setFlashing(true)
    const id = setTimeout(() => {
      flashed.current = null
      setFlashing(false)
    }, FLASH_MS)
    return () => clearTimeout(id)
  }, [flashKey])

  // Resolves with the clicked (or arrow-walked) element, or null on Esc.
  // Only clicks (the whole pointer sequence), Esc and ↑/↓ are kept from the
  // app: hover and every other key still reach it, so hover styles show
  // during a pick and the app's own shortcuts still fire.
  const pickElement = useCallback(
    () =>
      new Promise<Picked | null>((resolve) => {
        let frameWin: Window | null = null
        const inLayer = (el: Element) => Boolean(layerRef.current?.contains(el))
        const toPicked = (el: Element, e?: MouseEvent): Picked => ({
          el,
          inTool: el.ownerDocument === document,
          mouse: e ? { x: e.clientX, y: e.clientY } : (hovered.current?.mouse ?? { x: 0, y: 0 }),
        })
        const pickable = (t: EventTarget | null): t is Element =>
          isElement(t) && t !== frameRef.current && !inLayer(t)

        const onMove = (e: Event) => {
          if (pickable(e.target)) hovered.current = toPicked(e.target, e as MouseEvent)
        }
        const onClick = (e: Event) => {
          block(e)
          const current =
            hovered.current ?? (pickable(e.target) ? toPicked(e.target, e as MouseEvent) : null)
          if (current) finish(current)
        }
        const onKey = (e: Event) => {
          const k = e as KeyboardEvent
          const current = hovered.current
          if (k.key === "Escape") {
            block(e)
            finish(null)
          } else if (k.key === "ArrowUp" || k.key === "ArrowDown") {
            block(e)
            if (!current) return
            let next: Element | null =
              k.key === "ArrowUp" ? current.el.parentElement : current.el.firstElementChild
            while (next && inLayer(next)) next = next.nextElementSibling
            if (next) hovered.current = { ...current, el: next }
          }
        }

        const listen = (win: Window, on: boolean) => {
          const method = on ? "addEventListener" : "removeEventListener"
          try {
            win[method]("pointermove", onMove, true)
            win[method]("click", onClick, true)
            win[method]("keydown", onKey, true)
            for (const type of SWALLOWED) win[method](type, block, true)
          } catch {
            // The old document is gone.
          }
        }
        const attachFrame = () => {
          if (frameWin) listen(frameWin, false)
          frameWin = frameRef.current?.contentWindow ?? null
          if (frameWin) listen(frameWin, true)
        }
        const attachedFrame = frameRef.current
        function finish(result: Picked | null) {
          listen(window, false)
          if (frameWin) listen(frameWin, false)
          attachedFrame?.removeEventListener("load", attachFrame)
          cancelRef.current = () => {}
          resolve(result)
        }

        listen(window, true)
        attachFrame()
        // A navigation during the pick brings a new document.
        attachedFrame?.addEventListener("load", attachFrame)
        cancelRef.current = () => finish(null)
      }),
    []
  )

  const capture = useCallback(async (picked: Picked) => {
    const step = stepOf(picked)
    // Runs beside the screenshot; bounded, so it never holds the pin up.
    // Fresh maps every pick: the app may have changed since the last one.
    clearSourceCache()
    const source = picked.inTool ? Promise.resolve(undefined) : sourceOf(picked.el)
    const record: PinRecord = { version: 1, at: new Date().toISOString(), steps: [step] }
    const state = snapshotLocalStorage()
    let png: string | undefined
    const f = frameRef.current
    if (picked.inTool || f) {
      const crop: Box =
        picked.inTool || !f
          ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
          : frameBox(f)
      const outline = shellBox(picked.el, f)
      // Neither the outline layer nor the toolbar may be in the picture —
      // unless the picked element is the toolbar's.
      flushSync(() => setGrab({ keepToolbar: Boolean(picked.el.closest(".dr-toolbar")) }))
      await nextFrame()
      await nextFrame()
      try {
        png = await grabPng(f, picked.inTool || !f, rect(crop), rect(outline))
      } catch {
        png = undefined
      } finally {
        setGrab(null)
      }
    }
    const found = await source
    if (found) step.element.source = found
    return { pin: { path: step.path }, record, ...(png ? { png } : {}), state }
  }, [])

  const startPick = useCallback((): Promise<CapturedPin | null> => {
    if (active.current) return Promise.resolve(null)
    active.current = true
    return (async () => {
      try {
        hovered.current = null
        setPicking(true)
        const picked = await pickElement()
        return picked ? await capture(picked) : null
      } finally {
        hovered.current = null
        setPicking(false)
        active.current = false
        cancelRef.current = () => {}
      }
    })()
  }, [pickElement, capture])

  const cancel = useCallback(() => cancelRef.current(), [])

  // An unmount mid-pick must not leave listeners on either window.
  useEffect(() => () => cancelRef.current(), [])

  const layer = (
    <div
      ref={layerRef}
      className={["dr-picker", grab && "dr-hidden"].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {shown && (
        <div
          className={["dr-picker-box", !picking && "dr-picker-flash"].filter(Boolean).join(" ")}
          style={{
            left: shown.box.x,
            top: shown.box.y,
            width: shown.box.width,
            height: shown.box.height,
          }}
        />
      )}
      {shown?.label && (
        <div
          className="dr-picker-label"
          style={{
            left: Math.max(4, shown.box.x),
            top: shown.box.y > 26 ? shown.box.y - 24 : shown.box.y + shown.box.height + 4,
          }}
        >
          {shown.label}
        </div>
      )}
      {picking && (
        <div className="dr-picker-hint">Click to pin · ↑ / ↓ parent / child · Esc cancel</div>
      )}
    </div>
  )

  return {
    picking,
    hideToolbar: Boolean(grab && !grab.keepToolbar),
    startPick,
    cancel,
    flash,
    layer,
  }
}
