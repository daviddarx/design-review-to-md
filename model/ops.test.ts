import { describe, expect, it } from "vitest"
import { OpError, applyOp, newPoint } from "./ops.ts"
import { parsePoint, serializePoint } from "./markdown.ts"

const MD = `# 5. Nav

- a. one \`done\`
- b. two \`open\`
  - 1. sub \`open\`
- c. three \`review\`
  - Claude: did it
- d. four \`open\`
`

describe("ops", () => {
  it("refine moves the old text into Before and reopens", () => {
    const { point } = applyOp(parsePoint(MD), { kind: "refine", rowId: "5.c", text: "new" }, [])
    const c = point.rows[2]
    expect(c.text).toBe("new")
    expect(c.history.at(-1)).toEqual({ kind: "before", text: "three" })
    expect(c.status).toBe("open")
  })
  it("editText is refused once Claude has written on the row", () => {
    expect(() =>
      applyOp(parsePoint(MD), { kind: "editText", rowId: "5.c", text: "x" }, [])
    ).toThrowError(OpError)
    try {
      applyOp(parsePoint(MD), { kind: "editText", rowId: "5.c", text: "x" }, [])
    } catch (e) {
      expect((e as OpError).code).toBe("locked")
    }
    const ok = applyOp(parsePoint(MD), { kind: "editText", rowId: "5.d", text: "x" }, [])
    expect(ok.point.rows[3].text).toBe("x")
  })
  it("unknown rows throw not-found", () => {
    expect(() =>
      applyOp(parsePoint(MD), { kind: "setStatus", rowId: "5.z", status: "done" }, [])
    ).toThrowError(OpError)
    expect(() =>
      applyOp(parsePoint(MD), { kind: "setStatus", rowId: "6.a", status: "done" }, [])
    ).toThrowError(OpError)
  })
  it("addChild after deleting the last child skips the retired label", () => {
    const del = applyOp(parsePoint(MD), { kind: "deleteRow", rowId: "5.d" }, [])
    expect(del.retired).toContain("5.d")
    const add = applyOp(
      del.point,
      { kind: "addChild", rowId: "5", row: { text: "five", children: [] } },
      del.retired
    )
    expect(add.addedRowIds).toEqual(["5.e"])
    expect(add.retired).toContain("5.d")
  })
  it("addChild numbers sub-rows", () => {
    const add = applyOp(
      parsePoint(MD),
      { kind: "addChild", rowId: "5.b", row: { text: "s2", children: [] } },
      []
    )
    expect(add.addedRowIds).toEqual(["5.b.2"])
  })
  it("deleteRow reports every removed descendant id", () => {
    const r = applyOp(parsePoint(MD), { kind: "deleteRow", rowId: "5.b" }, [])
    expect(r.deletedRowIds).toEqual(["5.b", "5.b.1"])
    expect(r.retired).toEqual(["5.b", "5.b.1"])
  })
  it("setStatus keeps a Claude line written after the panel loaded", () => {
    const loaded = parsePoint(MD)
    const fresh = parsePoint(
      MD.replace("- d. four `open`\n", "- d. four `open`\n  - Claude: late\n")
    )
    const { point } = applyOp(fresh, { kind: "setStatus", rowId: "5.d", status: "review" }, [])
    expect(loaded.rows[3].history).toEqual([])
    expect(serializePoint(point)).toContain("  - Claude: late")
    expect(point.rows[3].status).toBe("review")
  })
  it("setPin sets and clears", () => {
    const pin = { path: "/x", screenshot: "a.png" }
    const a = applyOp(parsePoint(MD), { kind: "setPin", rowId: "5.a", pin }, [])
    expect(a.point.rows[0].pin).toEqual(pin)
    const b = applyOp(a.point, { kind: "setPin", rowId: "5.a", pin: undefined }, [])
    expect(b.point.rows[0].pin).toBeUndefined()
  })
  it("newPoint labels rows and children", () => {
    const { point, rowIds } = newPoint(7, "T", [
      { text: "x", children: [{ text: "y", children: [] }] },
      { text: "z", children: [] },
    ])
    expect(rowIds).toEqual(["7.a", "7.a.1", "7.b"])
    expect(point.rows[0].status).toBe("open")
    expect(point.rows[0].children[0].label).toBe("1")
  })
})
