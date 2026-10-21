// @vitest-environment dr-happy-dom
import { describe, expect, it } from "vitest"
import { frameLocationToShellUrl } from "./useFrameUrl.ts"

describe("frameLocationToShellUrl", () => {
  it("keeps path, search and hash", () => {
    expect(
      frameLocationToShellUrl({ pathname: "/concept-08-4/sites", search: "?q=1&b=2", hash: "#x" })
    ).toBe("/concept-08-4/sites?q=1&b=2#x")
  })

  it("keeps a bare path", () => {
    expect(frameLocationToShellUrl({ pathname: "/", search: "", hash: "" })).toBe("/")
  })

  it("never includes /__review", () => {
    expect(
      frameLocationToShellUrl({ pathname: "/__review/shell.js", search: "?a", hash: "#b" })
    ).toBe("/")
    expect(frameLocationToShellUrl({ pathname: "/__review", search: "", hash: "" })).toBe("/")
  })

  it("does not treat a lookalike segment as a tool path", () => {
    expect(frameLocationToShellUrl({ pathname: "/__reviewer", search: "", hash: "" })).toBe(
      "/__reviewer"
    )
  })

  it("accepts a real Location", () => {
    window.history.replaceState(null, "", "/a/b?c=d#e")
    expect(frameLocationToShellUrl(window.location)).toBe("/a/b?c=d#e")
  })
})
