import { describe, expect, it } from "vitest"
import { parseFeedback } from "../../model/markdown.ts"
import {
  counts,
  flattenRows,
  pinRecordPath,
  singleLine,
  statePathOf,
  suggestReviewName,
} from "./listModel.ts"

const SPEC = `# 5. Main navigation

📍 /concept-08-4/tickets — ![](05-main-navigation/5-pin.png)

- a. Icons are too small \`done\`
- b. Still too faint on hover, make it the brand blue at 100% \`open\`
  - Before: Active state is hard to see
  - Claude: 100% fails contrast on the hover fill, kept 80%
- c. Search field next to it is misaligned \`review\`
  📍 /concept-08-4/tickets — ![](05-main-navigation/5.c-pin.png)
- d. Compare with [5.d-reference.png](05-main-navigation/5.d-reference.png) \`open\`
`

const NESTED = `# 6. Font weights

- a. Headings \`open\`
  - 1. Too bold in the drawer \`review\`
- b. Body \`done\`
`

describe("flattenRows", () => {
  it("lists every row with its depth, in order", () => {
    const rows = flattenRows([parseFeedback(SPEC), parseFeedback(NESTED)], "all")
    expect(rows.map((r) => [r.rowId, r.depth])).toEqual([
      ["5", 0],
      ["5.a", 1],
      ["5.b", 1],
      ["5.c", 1],
      ["5.d", 1],
      ["6", 0],
      ["6.a", 1],
      ["6.a.1", 2],
      ["6.b", 1],
    ])
    expect(rows[0].text).toBe("Main navigation")
    expect(rows[0].status).toBeUndefined()
    expect(rows[2].history).toHaveLength(2)
  })

  it("inherits the nearest ancestor's pin", () => {
    const rows = flattenRows([parseFeedback(SPEC), parseFeedback(NESTED)], "all")
    const byId = Object.fromEntries(rows.map((r) => [r.rowId, r]))
    expect(byId["5"].pins[0].screenshot).toBe("05-main-navigation/5-pin.png")
    expect(byId["5"].inheritedPinFrom).toBeUndefined()
    expect(byId["5.a"].pins).toEqual([])
    expect(byId["5.a"].inheritedPinFrom).toBe("5")
    expect(byId["5.c"].pins[0].screenshot).toBe("05-main-navigation/5.c-pin.png")
    expect(byId["5.c"].inheritedPinFrom).toBeUndefined()
    expect(byId["6.a"].inheritedPinFrom).toBeUndefined()
    expect(byId["6.a.1"].inheritedPinFrom).toBeUndefined()
  })

  it("inherits from the nearer of two pinned ancestors", () => {
    const md = `# 7. T

- a. A \`open\`
  📍 /x — ![](07-t/7.a-pin.png)
  - 1. one \`open\`
`
    const md2 = md.replace("# 7. T\n", "# 7. T\n\n📍 /y — ![](07-t/7-pin.png)\n")
    const rows = flattenRows([parseFeedback(md2)], "all")
    expect(rows.find((r) => r.rowId === "7.a.1")?.inheritedPinFrom).toBe("7.a")
  })

  it("a status filter keeps matching rows and their ancestors", () => {
    const rows = flattenRows([parseFeedback(SPEC), parseFeedback(NESTED)], "review")
    expect(rows.map((r) => r.rowId)).toEqual(["5", "5.c", "6", "6.a", "6.a.1"])
  })

  it("a filter drops a feedback with nothing matching", () => {
    const rows = flattenRows([parseFeedback(SPEC), parseFeedback(NESTED)], "done")
    expect(rows.map((r) => r.rowId)).toEqual(["5", "5.a", "6", "6.b"])
  })

  it("a title row with its own matching status is kept", () => {
    const md = "# 8. Spacing `review`\n\n- a. x `open`\n"
    expect(flattenRows([parseFeedback(md)], "review").map((r) => r.rowId)).toEqual(["8"])
  })
})

describe("counts", () => {
  it("counts the spec example's statuses", () => {
    expect(counts([parseFeedback(SPEC)])).toEqual({ open: 2, review: 1, done: 1 })
  })

  it("counts nested rows and a tagged title", () => {
    const md = "# 8. Spacing `review`\n\n- a. x `open`\n  - 1. y `done`\n"
    expect(counts([parseFeedback(md)])).toEqual({ open: 1, review: 1, done: 1 })
  })
})

describe("pinRecordPath", () => {
  it("derives the record from the screenshot's folder and the owner's id", () => {
    const pin = { path: "/x", screenshot: "05-main-navigation/5.c-pin.png" }
    expect(pinRecordPath(pin, "5.c", 0)).toBe("05-main-navigation/5.c-pin.json")
  })

  it("a screenshot at the review root has no folder", () => {
    expect(pinRecordPath({ path: "/x", screenshot: "5-pin.png" }, "5", 0)).toBe("5-pin.json")
  })

  it("a pin without a screenshot uses the feedback's folder", () => {
    expect(pinRecordPath({ path: "/x" }, "5.c", 0, "05-nav")).toBe("05-nav/5.c-pin.json")
    expect(pinRecordPath({ path: "/x" }, "5.c", 2, "05-nav")).toBe("05-nav/5.c-pin-3.json")
    const [row] = flattenRows([{ ...parseFeedback("# 5. T\n\n📍 /x\n"), folder: "05-t" }], "all")
    expect(row.folder).toBe("05-t")
    expect(statePathOf("05-t/5-pin.json")).toBe("05-t/5-state.json")
    expect(statePathOf("05-t/5-pin-2.json")).toBe("05-t/5-state-2.json")
  })
})

describe("suggestReviewName", () => {
  it("turns a concept route into its version", () => {
    expect(suggestReviewName("/concept-08-4/x")).toBe("08.4")
    expect(suggestReviewName("/concept-06-2")).toBe("06.2")
  })

  it("falls back to the first segment, or nothing", () => {
    expect(suggestReviewName("/settings/a")).toBe("settings")
    expect(suggestReviewName("/")).toBe("")
  })
})

describe("singleLine", () => {
  it("joins lines so a row stays one markdown line", () => {
    expect(singleLine("  one\ntwo \n\n three ")).toBe("one two three")
  })
})
