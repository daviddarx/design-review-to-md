import { describe, expect, it } from "vitest"
import { nextLabel, pointFileBase, rowIdOf, slugify } from "./labels.ts"

describe("labels", () => {
  it("rowIdOf joins the point number and path", () => {
    expect(rowIdOf(5, ["b", "1"])).toBe("5.b.1")
    expect(rowIdOf(5, [])).toBe("5")
  })
  it("nextLabel goes one past the highest taken", () => {
    expect(nextLabel(1, ["a", "b", "d"])).toBe("e")
    expect(nextLabel(1, ["z"])).toBe("aa")
    expect(nextLabel(1, ["aa"])).toBe("ab")
    expect(nextLabel(1, [])).toBe("a")
    expect(nextLabel(2, [])).toBe("1")
    expect(nextLabel(2, ["1", "3"])).toBe("4")
  })
  it("slugify folds, dashes, trims and caps", () => {
    expect(slugify("Größe & Farbe!")).toBe("grosse-farbe")
    expect(slugify("Über")).toBe("uber")
    expect(slugify("!!!")).toBe("point")
    expect(slugify("a".repeat(60))).toHaveLength(40)
  })
  it("pointFileBase pads to two digits", () => {
    expect(pointFileBase(5, "Main navigation")).toBe("05-main-navigation")
    expect(pointFileBase(123, "x")).toBe("123-x")
  })
})
