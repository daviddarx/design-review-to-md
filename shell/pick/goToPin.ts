import type { PinRecord, PinStep } from "../../model/types.ts"

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

// The app page a pin was made on. A tool pin records "(review tool)" as its
// path; the shell's own URL, which mirrors the frame's, says where the app was.
function appPathOf(step: PinStep): string | null {
  if (!step.inTool) return step.path
  try {
    const url = new URL(step.url)
    return url.pathname + url.search
  } catch {
    return null
  }
}

// Takes the frame to the pin's page (a real navigation when the path
// differs), scrolls the element into view and has `flash` outline it. A pin
// inside the tool's own UI also brings the app back to the page it was on,
// then outlines the tool element if it is open.
export async function goToPin(
  frame: HTMLIFrameElement,
  record: PinRecord,
  flash: (el: Element) => void
): Promise<"found" | "missing"> {
  const step = record.steps[0]
  if (!step) return "missing"
  const { selector } = step.element

  const win = frame.contentWindow
  const path = appPathOf(step)
  if (win && path) {
    let here = ""
    try {
      here = win.location.pathname + win.location.search
    } catch {
      // Cross-origin page in the frame: navigate away from it.
    }
    if (here !== path) {
      const done = loaded(frame)
      win.location.assign(path)
      await done
    }
  }

  if (step.inTool) {
    const el = query(document, selector)
    if (!el) return "missing"
    flash(el)
    return "found"
  }
  if (!win) return "missing"

  const el = await waitFor(() => query(frame.contentDocument, selector))
  if (!el) return "missing"
  el.scrollIntoView({ block: "center" })
  flash(el)
  return "found"
}
