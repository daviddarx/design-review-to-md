// @vitest-environment dr-happy-dom
import { act } from "react"
import { createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useShortcut } from "./useShortcut.ts"
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const isR = (e: KeyboardEvent) => e.ctrlKey && e.key === "r"
const key = () => new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true })
const frames = () => new Promise((r) => requestAnimationFrame(() => r(null)))

describe("useShortcut", () => {
  it("catches the key in the frame's document and in every nested iframe", async () => {
    // The frame shows this document; a Storybook-like preview iframe loads
    // inside it after the hook is up.
    const frame = {
      contentDocument: document,
      contentWindow: window,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as HTMLIFrameElement
    const run = vi.fn()
    function Harness() {
      useShortcut(frame, true, isR, run)
      return null
    }
    await act(async () => root.render(createElement(Harness)))
    host.insertAdjacentHTML("beforeend", `<iframe srcdoc="<p></p>"></iframe>`)
    const previewDoc = host.querySelector("iframe")!.contentDocument!
    previewDoc.body.innerHTML = `<button id="b">x</button>`
    await act(async () => {
      await frames()
      await frames()
    })
    previewDoc.querySelector("#b")!.dispatchEvent(key())
    expect(run).toHaveBeenCalledTimes(1)
    window.dispatchEvent(key())
    expect(run).toHaveBeenCalledTimes(2)

    act(() => root.unmount())
    previewDoc.querySelector("#b")!.dispatchEvent(key())
    expect(run).toHaveBeenCalledTimes(2)
  })
})
