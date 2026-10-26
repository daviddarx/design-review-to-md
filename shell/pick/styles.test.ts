// @vitest-environment dr-happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { resolveNested, specificity, splitList, styleOverview } from "./styles.ts"

afterEach(() => {
  document.head.innerHTML = ""
  document.body.innerHTML = ""
})

function overview(css: string, html: string) {
  document.head.innerHTML = `<style>${css}</style>`
  document.body.innerHTML = html
  return styleOverview(document.getElementById("t")!).map((l) => `${l.prop}: ${l.value}`)
}

describe("specificity", () => {
  it("counts ids, classes and types", () => {
    expect(specificity("#a .b > p:hover")).toEqual([1, 2, 1])
    expect(specificity("a[href='x,y']::before")).toEqual([0, 1, 2])
    expect(specificity("*")).toEqual([0, 0, 0])
  })

  it("reads Tailwind's escaped classes as one class", () => {
    expect(specificity(".hover\\:bg-blue-500:hover")).toEqual([0, 2, 0])
    expect(specificity(".w-1\\/2")).toEqual([0, 1, 0])
  })

  it(":is/:not take their most specific argument, :where nothing", () => {
    expect(specificity(":is(#a, .b) p")).toEqual([1, 0, 1])
    expect(specificity(":where(#a) p")).toEqual([0, 0, 1])
  })
})

describe("selectors", () => {
  it("splits at top-level commas only", () => {
    expect(splitList(":is(a, b), [x=','], .c")).toEqual([":is(a, b)", "[x=',']", ".c"])
  })

  it("resolves a nested rule against its parent", () => {
    expect(resolveNested(".a, .b", "&:hover")).toBe(":is(.a, .b):hover")
    expect(resolveNested(".a", "span")).toBe(":is(.a) span")
  })
})

describe("styleOverview", () => {
  it("shows the values as written, tokens included", () => {
    expect(
      overview(
        `.card { padding: var(--space-4); color: var(--ink); font-size: var(--text-sm); width: var(--w); }`,
        `<div id="t" class="card">x</div>`
      )
    ).toEqual([
      "width: var(--w)",
      "padding: var(--space-4)",
      "color: var(--ink)",
      "font-size: var(--text-sm)",
    ])
  })

  it("keeps the cascade's winner: specificity, then order, then !important", () => {
    expect(
      overview(
        `#t { color: var(--a) } .x { color: var(--b) } p.x { margin: 0 } .x { margin: 4px }`,
        `<p id="t" class="x">x</p>`
      )
    ).toEqual(["margin: 0px", "color: var(--a)"])
    expect(
      overview(
        `#t { color: var(--a) } .x { color: var(--b) !important }`,
        `<p id="t" class="x">x</p>`
      )
    ).toEqual(["color: var(--b) !important"])
  })

  it("the style attribute wins over rules", () => {
    expect(
      overview(`#t { color: var(--a) }`, `<p id="t" style="color: var(--inline)">x</p>`)
    ).toEqual(["color: var(--inline)"])
  })

  it("leaves out resets, inherited values and rules that do not match", () => {
    expect(
      overview(
        `* { margin: 0 } button { color: inherit } .other { padding: 1px } @media (max-width: 1px) { #t { font-size: 99px } }`,
        `<div style="color: var(--parent)"><button id="t">x</button></div>`
      )
    ).toEqual([])
  })

  it("follows a matching media query", () => {
    expect(
      overview(`@media (min-width: 1px) { #t { background: var(--surface) } }`, `<p id="t">x</p>`)
    ).toEqual(["background: var(--surface)"])
  })
})
