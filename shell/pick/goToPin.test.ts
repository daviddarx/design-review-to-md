// @vitest-environment dr-happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PinRecord } from "../../model/types.ts"
import { goToPin } from "./goToPin.ts"

const record = (selector: string, inTool: boolean): PinRecord => ({
  version: 1,
  at: "t",
  steps: [
    {
      url: "http://localhost:3000/",
      path: inTool ? "(review tool)" : "/",
      viewport: { width: 800, height: 600, dpr: 1 },
      mouse: { x: 0, y: 0 },
      element: { selector, tag: "button", text: "", rect: { x: 0, y: 0, width: 1, height: 1 } },
      inTool,
    },
  ],
})

const noState = async () => false

afterEach(() => {
  document.body.innerHTML = ""
})

describe("goToPin", () => {
  it("outlines a tool element where it is", async () => {
    document.body.innerHTML = `<div class="dr-toolbar"><button data-slot="x">Pin</button></div>`
    const flash = vi.fn()
    const frame = document.createElement("iframe")
    expect(await goToPin(frame, record('[data-slot="x"]', true), flash, noState)).toBe("found")
    expect(flash).toHaveBeenCalledWith(document.querySelector("button"))
  })

  it("reports a selector that finds nothing as missing", async () => {
    const flash = vi.fn()
    const frame = document.createElement("iframe")
    expect(await goToPin(frame, record("#gone", true), flash, noState)).toBe("missing")
    expect(await goToPin(frame, { version: 1, at: "t", steps: [] }, flash, noState)).toBe("missing")
    expect(flash).not.toHaveBeenCalled()
  })
})

// A frame stand-in: `assign` "navigates" and fires `load` on the next tick.
function fakeFrame(pathname: string, doc: Document) {
  const listeners = new Set<() => void>()
  const load = () => setTimeout(() => listeners.forEach((l) => l()), 0)
  const location = {
    pathname,
    search: "",
    hash: "",
    assign: vi.fn((to: string) => {
      const url = new URL(to, "http://localhost:3000")
      const samePage = url.pathname === location.pathname && url.search === location.search
      Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash })
      if (!samePage) load() // a hash alone does not load the page
    }),
    reload: vi.fn(load),
  }
  const frame = {
    contentWindow: { location },
    contentDocument: doc,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  return { frame: frame as unknown as HTMLIFrameElement, location }
}

describe("goToPin in the frame", () => {
  const appRecord = (selector: string, path: string, hash = ""): PinRecord => {
    const r = record(selector, false)
    r.steps[0].path = path
    r.steps[0].url = `http://localhost:3000${path}${hash}`
    return r
  }

  it("navigates to another path, waits for load, then finds and outlines", async () => {
    const doc = document.implementation.createHTMLDocument("app")
    doc.body.innerHTML = `<button data-slot="go">Go</button>`
    const el = doc.querySelector("button")!
    el.scrollIntoView = vi.fn()
    const { frame, location } = fakeFrame("/elsewhere", doc)
    const flash = vi.fn()
    expect(await goToPin(frame, appRecord('[data-slot="go"]', "/tickets"), flash, noState)).toBe(
      "found"
    )
    expect(location.assign).toHaveBeenCalledWith("/tickets")
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center" })
    expect(flash).toHaveBeenCalledWith(el)
  })

  it("stays on the same path and reports a vanished element as missing", async () => {
    const doc = document.implementation.createHTMLDocument("app")
    const { frame, location } = fakeFrame("/tickets", doc)
    const flash = vi.fn()
    expect(await goToPin(frame, appRecord("#gone", "/tickets"), flash, noState)).toBe("missing")
    expect(location.assign).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
  }, 6000)

  it("a tool pin brings the app back to the page it was on, then outlines", async () => {
    document.body.innerHTML = `<aside><button data-slot="t">Pin</button></aside>`
    const r = record('[data-slot="t"]', true)
    r.steps[0].url = "http://localhost:3000/concept-08-4?x=1"
    const { frame, location } = fakeFrame(
      "/elsewhere",
      document.implementation.createHTMLDocument("app")
    )
    const flash = vi.fn()
    expect(await goToPin(frame, r, flash, noState)).toBe("found")
    expect(location.assign).toHaveBeenCalledWith("/concept-08-4?x=1")
    expect(flash).toHaveBeenCalledWith(document.querySelector("button"))
  })

  it("clicks a closed popup's trigger open and finds the element under its new id", async () => {
    const doc = document.implementation.createHTMLDocument("app")
    doc.body.innerHTML = `<button aria-expanded="false" data-slot="fav">Favourites</button>`
    const trigger = doc.querySelector("button")!
    // Opening mounts the popup under an id other than the pick's.
    trigger.addEventListener("click", () => {
      trigger.setAttribute("aria-expanded", "true")
      trigger.setAttribute("aria-controls", "_r_9_")
      doc.body.insertAdjacentHTML(
        "beforeend",
        `<div id="_r_9_"><div><button>Grip</button></div></div>`
      )
    })
    const r = appRecord("#_r_2_ > div > button", "/tickets")
    r.steps[0].openers = [{ selector: '[data-slot="fav"]', controls: "_r_2_" }]
    const { frame } = fakeFrame("/tickets", doc)
    const flash = vi.fn()
    expect(await goToPin(frame, r, flash, noState)).toBe("found")
    const grip = doc.querySelector("#_r_9_ button")!
    expect(flash).toHaveBeenCalledWith(grip)
  })

  it("goes to the pin's hash too (the work panel lives there), loading the page again", async () => {
    const doc = document.implementation.createHTMLDocument("app")
    doc.body.innerHTML = `<div data-slot="panel">Panel</div>`
    doc.querySelector("div")!.scrollIntoView = vi.fn()
    const { frame, location } = fakeFrame("/tickets", doc)
    const r = appRecord('[data-slot="panel"]', "/tickets", "#wp/TK-1009")
    expect(await goToPin(frame, r, vi.fn(), noState)).toBe("found")
    expect(location.assign).toHaveBeenCalledWith("/tickets#wp/TK-1009")
    expect(location.reload).toHaveBeenCalled()
  })

  it("finds an element inside a nested iframe through the step's frames", async () => {
    // The frame shows this very document: a Storybook manager with its
    // preview iframe, and the story inside it.
    document.body.innerHTML = `<div id="manager"><iframe id="storybook-preview-iframe" srcdoc="<p></p>"></iframe></div>`
    const previewDoc = document.querySelector("iframe")!.contentDocument!
    previewDoc.body.innerHTML = `<div id="storybook-root"><button data-slot="story">Go</button></div>`
    const el = previewDoc.querySelector("button")!
    el.scrollIntoView = vi.fn()
    const { frame } = fakeFrame("/", document)
    const r = appRecord('[data-slot="story"]', "/")
    r.steps[0].frames = [{ selector: "#storybook-preview-iframe", url: "about:srcdoc" }]
    const flash = vi.fn()
    expect(await goToPin(frame, r, flash, noState)).toBe("found")
    expect(flash).toHaveBeenCalledWith(el)
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center" })
  })

  it("reports an element behind a missing or cross-origin frame as missing", async () => {
    document.body.innerHTML = `<iframe id="foreign"></iframe>`
    const { frame } = fakeFrame("/", document)
    const r = appRecord("button", "/")
    r.steps[0].frames = [{ selector: "#foreign" }]
    const flash = vi.fn()
    expect(await goToPin(frame, r, flash, noState)).toBe("missing")
    expect(flash).not.toHaveBeenCalled()
  }, 8000)

  it("not found, puts the saved app state back and loads the page again", async () => {
    const doc = document.implementation.createHTMLDocument("app")
    const { frame, location } = fakeFrame("/tickets", doc)
    const restore = vi.fn(async () => {
      // The restored state renders the element on the next load.
      doc.body.innerHTML = `<button data-slot="late">Late</button>`
      doc.querySelector("button")!.scrollIntoView = vi.fn()
      return true
    })
    const flash = vi.fn()
    expect(await goToPin(frame, appRecord('[data-slot="late"]', "/tickets"), flash, restore)).toBe(
      "restored"
    )
    expect(restore).toHaveBeenCalledOnce()
    expect(location.reload).toHaveBeenCalledOnce()
    expect(flash).toHaveBeenCalledWith(doc.querySelector("button"))
  }, 6000)
})
