import type { PinRecord } from "../../model/types.ts"

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

function loaded(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => frame.addEventListener("load", () => resolve(), { once: true }))
}

// Takes the frame to the pin's page (a real navigation when the path
// differs), scrolls the element into view and has `flash` outline it.
// Pins inside the tool's own UI are only outlined.
export async function goToPin(
  frame: HTMLIFrameElement,
  record: PinRecord,
  flash: (el: Element) => void
): Promise<"found" | "missing"> {
  const step = record.steps[0]
  if (!step) return "missing"
  const { selector } = step.element

  if (step.inTool) {
    const el = query(document, selector)
    if (!el) return "missing"
    flash(el)
    return "found"
  }

  const win = frame.contentWindow
  if (!win) return "missing"
  let here = ""
  try {
    here = win.location.pathname + win.location.search
  } catch {
    // Cross-origin page in the frame: navigate away from it.
  }
  if (here !== step.path) {
    const done = loaded(frame)
    win.location.assign(step.path)
    await done
  }

  const el = await waitFor(() => query(frame.contentDocument, selector))
  if (!el) return "missing"
  el.scrollIntoView({ block: "center" })
  flash(el)
  return "found"
}
