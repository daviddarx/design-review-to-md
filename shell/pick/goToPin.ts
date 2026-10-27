import type { PinOpener, PinRecord, PinStep } from "../../model/types.ts"
import { resolveFrames } from "./frames.ts"
import { escapeIdent } from "./inspect.ts"

// How long the app may take to render the pinned element after a load: the
// 07.x/08.x shells mount client-side, after hydration, so the element is
// often not there yet when `load` fires. There is no "rendered" event to
// wait on instead.
const RENDER_WAIT_MS = 3000

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

function query(doc: Document | null | undefined, selector: string): Element | null {
  try {
    return doc?.querySelector(selector) ?? null
  } catch {
    return null // a selector this document cannot parse finds nothing
  }
}

async function waitFor(find: () => Element | null): Promise<Element | null> {
  const deadline = performance.now() + RENDER_WAIT_MS
  for (;;) {
    const el = find()
    if (el || performance.now() > deadline) return el
    await nextFrame()
  }
}

// `#old` → `#new` in a selector, where a popup's id changed since the pick.
function renameId(selector: string, from: string, to: string): string {
  const id = escapeIdent(from).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return selector.replace(new RegExp(`#${id}(?![\\w-])`, "g"), `#${escapeIdent(to)}`)
}

// Where the element is now, without opening anything: its selector with the
// ids of the popups that are open put right, and the innermost of their
// triggers on the page.
export function followOpeners(
  doc: Document | null | undefined,
  openers: PinOpener[],
  selector: string
): { selector: string; trigger: { el: Element; opener: PinOpener } | null } {
  let rest = openers
  let target = selector
  let trigger: { el: Element; opener: PinOpener } | null = null
  while (rest.length) {
    const [opener, ...next] = rest
    const el = query(doc, opener.selector)
    if (!el) break
    trigger = { el, opener }
    const open = el.getAttribute("aria-expanded") === "true"
    const id = open ? el.getAttribute("aria-controls")?.split(/\s+/)[0] : undefined
    if (!id) break
    if (id !== opener.controls) {
      target = renameId(target, opener.controls, id)
      rest = next.map((o) => ({ ...o, selector: renameId(o.selector, opener.controls, id) }))
    } else rest = next
  }
  return { selector: target, trigger }
}

// Opens the popups the element was picked in, outermost first: clicks each
// trigger that is not open yet, then follows its `aria-controls` to the
// popup's id now (React's ids are not stable across loads). Returns the
// element's selector with those ids put right.
async function openPopups(doc: Document, openers: PinOpener[], selector: string): Promise<string> {
  let rest = openers.map((o) => ({ ...o }))
  let target = selector
  while (rest.length) {
    const [opener, ...next] = rest
    const trigger = await waitFor(() => query(doc, opener.selector))
    if (!trigger) break
    if (trigger.getAttribute("aria-expanded") !== "true") (trigger as HTMLElement).click()
    const now = await waitFor(() =>
      trigger.getAttribute("aria-expanded") === "true" ? trigger : null
    )
    const id = now?.getAttribute("aria-controls")?.split(/\s+/)[0]
    if (id && id !== opener.controls) {
      target = renameId(target, opener.controls, id)
      rest = next.map((o) => ({ ...o, selector: renameId(o.selector, opener.controls, id) }))
    } else rest = next
  }
  return target
}

// The frame's next `load`, or RENDER_WAIT_MS — a navigation that never
// loads must not hang Go to pin (the element then reads as missing).
function loaded(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(id)
      frame.removeEventListener("load", done)
      resolve()
    }
    const id = setTimeout(done, RENDER_WAIT_MS)
    frame.addEventListener("load", done)
  })
}

// The app address a pin was made at — path, query and hash, since the app
// mirrors its open surfaces there (the work panel is `#wp/…`). A tool pin
// records "(review tool)" as its path; the shell's own URL, which mirrors the
// frame's, says where the app was (and drops the hash, as before).
function appUrlOf(step: PinStep): string | null {
  try {
    const url = new URL(step.url)
    return url.pathname + url.search + (step.inTool ? "" : url.hash)
  } catch {
    return step.inTool ? null : step.path
  }
}

function hereOf(win: Window): string {
  try {
    return win.location.pathname + win.location.search + win.location.hash
  } catch {
    return "" // a cross-origin page in the frame: navigate away from it
  }
}

// Brings the frame to `to`, as a fresh load: a change of hash alone would be
// a same-page navigation the app may not follow. `force` reloads even when
// the frame is already there (after a state restore).
async function arrive(frame: HTMLIFrameElement, win: Window, to: string, force: boolean) {
  const here = hereOf(win)
  if (here === to && !force) return
  const done = loaded(frame)
  const samePage = here.replace(/#.*$/, "") === to.replace(/#.*$/, "")
  if (here !== to) win.location.assign(to)
  if (samePage || here === to) win.location.reload()
  await done
}

// The element on the page now, opening the popups it was picked in when
// they are closed. Its document is the one the step's frames lead to (a
// nested iframe may load after the page: it is looked for again each frame).
async function locate(frame: HTMLIFrameElement, step: PinStep): Promise<Element | null> {
  const { selector } = step.element
  const doc = () => resolveFrames(frame.contentDocument, step.frames)?.doc
  const openers = step.openers ?? []
  // The element, or — when it lives in a popup that is closed — its first
  // trigger, which says the page has rendered.
  let el = await waitFor(
    () => query(doc(), selector) ?? (openers[0] ? query(doc(), openers[0].selector) : null)
  )
  const d = doc()
  if (el && d && query(d, selector) !== el) {
    const target = await openPopups(d, openers, selector)
    el = await waitFor(() => query(d, target))
  }
  return el
}

// Takes the frame to the pin's address, opens the popups the element was in,
// scrolls it into view and has `flash` outline it. Still not there, the app
// state saved with the pin is put back (`restoreState` writes it and says
// whether there was one) and the page loaded again: "restored". A pin inside
// the tool's own UI brings the app back to the page it was on, then outlines
// the tool element if it is open.
export async function goToPin(
  frame: HTMLIFrameElement,
  record: PinRecord,
  flash: (el: Element) => void,
  restoreState: () => Promise<boolean>
): Promise<"found" | "restored" | "missing"> {
  const step = record.steps[0]
  if (!step) return "missing"

  const win = frame.contentWindow
  const to = appUrlOf(step)
  if (win && to) await arrive(frame, win, to, false)

  if (step.inTool) {
    const el = query(document, step.element.selector)
    if (!el) return "missing"
    flash(el)
    return "found"
  }
  if (!win || !to) return "missing"

  let el = await locate(frame, step)
  let result: "found" | "restored" = "found"
  if (!el) {
    if (!(await restoreState())) return "missing"
    await arrive(frame, win, to, true)
    el = await locate(frame, step)
    result = "restored"
  }
  if (!el) return "missing"
  el.scrollIntoView({ block: "center" })
  flash(el)
  return result
}
