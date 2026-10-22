import { describe, expect, it } from "vitest"
import { OpError, applyOp, newFeedback } from "./ops.ts"
import { parseFeedback, serializeFeedback } from "./markdown.ts"

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
    const { feedback } = applyOp(
      parseFeedback(MD),
      { kind: "refine", rowId: "5.c", text: "new" },
      []
    )
    const c = feedback.rows[2]
    expect(c.text).toBe("new")
    expect(c.history.at(-1)).toEqual({ kind: "before", text: "three" })
    expect(c.status).toBe("open")
  })
  it("editText is refused once Claude has written on the row", () => {
    expect(() =>
      applyOp(parseFeedback(MD), { kind: "editText", rowId: "5.c", text: "x" }, [])
    ).toThrowError(OpError)
    expect(() =>
      applyOp(parseFeedback(MD), { kind: "editText", rowId: "5.c", text: "x" }, [])
    ).toThrow(expect.objectContaining({ code: "locked" }))
    const ok = applyOp(parseFeedback(MD), { kind: "editText", rowId: "5.d", text: "x" }, [])
    expect(ok.feedback.rows[3].text).toBe("x")
  })
  it("unknown rows throw not-found", () => {
    expect(() =>
      applyOp(parseFeedback(MD), { kind: "setStatus", rowId: "5.z", status: "done" }, [])
    ).toThrowError(OpError)
    expect(() =>
      applyOp(parseFeedback(MD), { kind: "setStatus", rowId: "6.a", status: "done" }, [])
    ).toThrowError(OpError)
  })
  it("addChild after deleting the last child skips the retired label", () => {
    const del = applyOp(parseFeedback(MD), { kind: "deleteRow", rowId: "5.d" }, [])
    expect(del.retired).toContain("5.d")
    const add = applyOp(
      del.feedback,
      { kind: "addChild", rowId: "5", row: { text: "five", children: [] } },
      del.retired
    )
    expect(add.addedRowIds).toEqual(["5.e"])
    expect(add.retired).toContain("5.d")
  })
  it("addChild numbers sub-rows", () => {
    const add = applyOp(
      parseFeedback(MD),
      { kind: "addChild", rowId: "5.b", row: { text: "s2", children: [] } },
      []
    )
    expect(add.addedRowIds).toEqual(["5.b.2"])
  })
  it("deleteRow reports every removed descendant id", () => {
    const r = applyOp(parseFeedback(MD), { kind: "deleteRow", rowId: "5.b" }, [])
    expect(r.deletedRowIds).toEqual(["5.b", "5.b.1"])
    expect(r.retired).toEqual(["5.b", "5.b.1"])
  })
  it("setStatus keeps a Claude line written after the panel loaded", () => {
    const loaded = parseFeedback(MD)
    const fresh = parseFeedback(
      MD.replace("- d. four `open`\n", "- d. four `open`\n  - Claude: late\n")
    )
    const { feedback } = applyOp(fresh, { kind: "setStatus", rowId: "5.d", status: "review" }, [])
    expect(loaded.rows[3].history).toEqual([])
    expect(serializeFeedback(feedback)).toContain("  - Claude: late")
    expect(feedback.rows[3].status).toBe("review")
  })
  it("setPin sets and clears", () => {
    const pin = { path: "/x", screenshot: "a.png" }
    const a = applyOp(parseFeedback(MD), { kind: "setPin", rowId: "5.a", pin }, [])
    expect(a.feedback.rows[0].pin).toEqual(pin)
    const b = applyOp(a.feedback, { kind: "setPin", rowId: "5.a", pin: undefined }, [])
    expect(b.feedback.rows[0].pin).toBeUndefined()
  })
  it("newFeedback tags a title-only feedback open, and leaves a title with rows untagged", () => {
    const bare = newFeedback(1, "Font weights", []).feedback
    expect(bare.status).toBe("open")
    expect(serializeFeedback(bare).split("\n")[0]).toBe("# 1. Font weights `open`")
    expect(newFeedback(2, "Nav", [{ text: "a", children: [] }]).feedback.status).toBeUndefined()
  })

  it("newFeedback labels rows and children", () => {
    const { feedback, rowIds } = newFeedback(7, "T", [
      { text: "x", children: [{ text: "y", children: [] }] },
      { text: "z", children: [] },
    ])
    expect(rowIds).toEqual(["7.a", "7.a.1", "7.b"])
    expect(feedback.rows[0].status).toBe("open")
    expect(feedback.rows[0].children[0].label).toBe("1")
  })
  it("refine on the feedback id moves the title into Before and reopens", () => {
    const md = "# 5. Nav `done`\n\n- a. one `open`\n"
    const { feedback } = applyOp(parseFeedback(md), { kind: "refine", rowId: "5", text: "New" }, [])
    expect(feedback.title).toBe("New")
    expect(feedback.history).toEqual([{ kind: "before", text: "Nav" }])
    expect(feedback.status).toBe("open")
  })
  it("editText on the feedback id is silent while open and locked otherwise", () => {
    const ok = applyOp(parseFeedback(MD), { kind: "editText", rowId: "5", text: "Z" }, [])
    expect(ok.feedback.title).toBe("Z")
    const reviewed = parseFeedback("# 5. Nav `review`\n\n- a. one `open`\n")
    expect(() => applyOp(reviewed, { kind: "editText", rowId: "5", text: "Z" }, [])).toThrow(
      expect.objectContaining({ code: "locked" })
    )
    const claude = parseFeedback("# 5. Nav\n\n- Claude: hi\n\n- a. one `open`\n")
    expect(() => applyOp(claude, { kind: "editText", rowId: "5", text: "Z" }, [])).toThrow(
      expect.objectContaining({ code: "locked" })
    )
  })
  it("a feedback with status open round-trips", () => {
    const md = "# 5. Nav `open`\n\n- a. one `open`\n"
    expect(serializeFeedback(parseFeedback(md))).toBe(md)
    expect(parseFeedback(md).status).toBe("open")
  })
})
