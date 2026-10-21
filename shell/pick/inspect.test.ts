// @vitest-environment dr-happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { snapshotLocalStorage } from "./capture.ts"
import { componentName, describe as describeEl, uniqueSelector } from "./inspect.ts"

afterEach(() => {
  document.body.innerHTML = ""
  localStorage.clear()
})

const roundTrips = (el: Element) => {
  const sel = uniqueSelector(el)
  expect(el.ownerDocument.querySelector(sel)).toBe(el)
  return sel
}

describe("uniqueSelector", () => {
  it("uses the id", () => {
    document.body.innerHTML = `<div><span id="target">x</span><span>y</span></div>`
    expect(roundTrips(document.getElementById("target")!)).toBe("#target")
  })

  it("uses a data-slot marker", () => {
    document.body.innerHTML = `<div><button data-slot="nav-item">a</button><button>b</button></div>`
    const sel = roundTrips(document.querySelector("[data-slot]")!)
    expect(sel).toContain('[data-slot="nav-item"]')
  })

  it("narrows a marker shared by several elements", () => {
    document.body.innerHTML = `<ul><li data-slot="item">a</li><li data-slot="item">b</li></ul>`
    roundTrips(document.querySelectorAll("li")[1])
  })

  it("falls back to an nth-of-type path", () => {
    document.body.innerHTML = `<main><ul><li>a</li><li>b</li><li>c</li></ul></main>`
    const sel = roundTrips(document.querySelectorAll("li")[2])
    expect(sel).toContain("li:nth-of-type(3)")
  })

  it("anchors a path on the nearest ancestor with an id", () => {
    document.body.innerHTML = `<section id="box"><p>a</p><p><b>x</b></p></section>`
    const sel = roundTrips(document.querySelector("b")!)
    expect(sel.startsWith("#box")).toBe(true)
  })

  it("escapes awkward ids", () => {
    document.body.innerHTML = `<div id="a:b.c">x</div>`
    roundTrips(document.querySelector("div")!)
  })
})

describe("componentName", () => {
  it("walks the fiber to the first function component", () => {
    document.body.innerHTML = `<div><span>x</span></div>`
    const span = document.querySelector("span")!
    function Fake() {}
    Object.assign(span, {
      __reactFiber$x: { type: "span", return: { type: "div", return: { type: Fake } } },
    })
    expect(componentName(span)).toBe("Fake")
  })

  it("prefers displayName", () => {
    const el = document.createElement("div")
    const Comp = Object.assign(function Inner() {}, { displayName: "Shown" })
    Object.assign(el, { __reactFiber$abc: { type: "div", return: { type: Comp } } })
    expect(componentName(el)).toBe("Shown")
  })

  it("is undefined without a fiber", () => {
    expect(componentName(document.createElement("div"))).toBeUndefined()
  })
})

describe("describe", () => {
  it("names the tag and size when no component is known", () => {
    const el = document.createElement("button")
    el.getBoundingClientRect = () => ({ width: 120.4, height: 32 }) as DOMRect
    expect(describeEl(el)).toBe("button 120×32")
  })
})

describe("snapshotLocalStorage", () => {
  it("omits the tool's own keys", () => {
    localStorage.setItem("app-data", '{"a":1}')
    localStorage.setItem("design-review:mode", "on")
    localStorage.setItem("other", "x")
    expect(JSON.parse(snapshotLocalStorage())).toEqual({ "app-data": '{"a":1}', other: "x" })
  })
})
