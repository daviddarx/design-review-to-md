import { describe, expect, it } from "vitest"
import { parsePoint } from "../../model/markdown.ts"
import {
  appendChild,
  buildCreate,
  buildOps,
  fromPoint,
  indent,
  insertSiblingAfter,
  newDraft,
  outdent,
  remove,
  updateNode,
  type DraftNode,
} from "./draft.ts"

let seq = 0
function node(text: string, children: DraftNode[] = [], extra: Partial<DraftNode> = {}): DraftNode {
  return { id: `n${++seq}`, text, files: [], children, ...extra }
}

const texts = (n: DraftNode): unknown => ({ [n.text]: n.children.map(texts) })

const POINT = `# 5. Main navigation

- a. Icons are too small \`done\`
- b. Still too faint \`open\`
  - Claude: kept 80%
- c. Search field is misaligned \`open\`
  - 1. by two pixels \`open\`
`

describe("outline edits", () => {
  it("indent turns the next sibling into the last child of the previous one", () => {
    const b1 = node("b1")
    const b = node("b", [b1])
    const c = node("c")
    const tree = node("title", [node("a"), b, c])
    const next = indent(tree, c.id)
    expect(texts(next)).toEqual({ title: [{ a: [] }, { b: [{ b1: [] }, { c: [] }] }] })
    expect(texts(tree)).toEqual({ title: [{ a: [] }, { b: [{ b1: [] }] }, { c: [] }] })
  })

  it("indent is a no-op on a saved node", () => {
    const b = node("b", [], { savedRowId: "5.b", savedText: "b" })
    const tree = node("title", [node("a"), b])
    expect(indent(tree, b.id)).toBe(tree)
    const saved = node("s", [], { savedRowId: "5.a.1", savedText: "s" })
    const tree3 = node("title", [node("a", [saved])])
    expect(outdent(tree3, saved.id)).toBe(tree3)
  })

  it("a fourth level is refused", () => {
    const deep = node("a1")
    const a = node("a", [deep])
    const tree = node("title", [a])
    expect(appendChild(tree, deep.id)).toBe(tree)
    // a node with children cannot sink under a sibling: its children would land at level 4
    const b = node("b", [node("b1")])
    const tree2 = node("title", [node("a"), b])
    expect(indent(tree2, b.id)).toBe(tree2)
    // a third-level node cannot be indented further
    const x = node("x")
    const y = node("y")
    const tree3 = node("title", [node("a", [x, y])])
    expect(indent(tree3, y.id)).toBe(tree3)
  })

  it("remove drops the subtree", () => {
    const b = node("b", [node("b1"), node("b2")])
    const tree = node("title", [node("a"), b, node("c")])
    expect(texts(remove(tree, b.id))).toEqual({ title: [{ a: [] }, { c: [] }] })
    expect(remove(tree, tree.id)).toBe(tree)
    const saved = node("s", [], { savedRowId: "5.a", savedText: "s" })
    const fresh = node("f")
    expect(remove(node("title", [saved, fresh]), fresh.id).children).toEqual([saved])
  })

  it("outdent moves a third-level node after its parent", () => {
    const a1 = node("a1")
    const tree = node("title", [node("a", [a1]), node("b")])
    expect(texts(outdent(tree, a1.id))).toEqual({
      title: [{ a: [] }, { a1: [] }, { b: [] }],
    })
  })

  it("Enter adds a sibling below, and on the title the first sub-point", () => {
    const a = node("a")
    const tree = node("title", [a, node("b")])
    const next = insertSiblingAfter(tree, a.id)
    expect(next.children.map((c) => c.text)).toEqual(["a", "", "b"])
    expect(insertSiblingAfter(tree, tree.id).children.map((c) => c.text)).toEqual(["", "a", "b"])
  })

  it("new rows never land between saved rows (they are appended on save)", () => {
    const tree = fromPoint(parsePoint(POINT))
    const a = tree.children[0]
    const next = insertSiblingAfter(tree, a.id)
    expect(next.children.map((c) => c.text)).toEqual([
      "Icons are too small",
      "Still too faint",
      "Search field is misaligned",
      "",
    ])
  })
})

describe("saving", () => {
  it("builds a create payload with draft-relative asset ids", () => {
    let tree = newDraft()
    tree = updateNode(tree, tree.id, { text: "Main nav" })
    tree = insertSiblingAfter(tree, tree.id)
    const a = tree.children[0]
    tree = updateNode(tree, a.id, {
      text: "Icons",
      files: [{ name: "ref.png", dataBase64: "AAA" }],
    })
    tree = appendChild(tree, a.id)
    tree = updateNode(tree, tree.children[0].children[0].id, { text: "deeper" })
    tree = appendChild(tree, a.id)
    tree = updateNode(tree, tree.children[0].children[1].id, {
      text: "deepest",
      files: [{ name: "x.txt", dataBase64: "BBB" }],
    })
    tree = insertSiblingAfter(tree, a.id) // empty row, dropped
    const payload = buildCreate(tree)
    expect(payload).toEqual({
      title: "Main nav",
      rows: [
        {
          text: "Icons",
          children: [
            { text: "deeper", children: [] },
            { text: "deepest", children: [] },
          ],
        },
      ],
      assets: [
        { rowId: "$0", name: "ref.png", dataBase64: "AAA" },
        { rowId: "$0.1", name: "x.txt", dataBase64: "BBB" },
      ],
    })
  })

  it("puts a captured pin on its row with png, record and state assets", () => {
    let tree = newDraft({
      pin: { path: "/x", screenshot: "" },
      record: { version: 1, at: "t", steps: [] },
      png: "UE5H",
      state: "{}",
    })
    tree = updateNode(tree, tree.id, { text: "Pinned" })
    const payload = buildCreate(tree)
    expect(payload.pin).toEqual({ path: "/x", screenshot: "" })
    expect(payload.assets.map((a) => `${a.rowId} ${a.name}`)).toEqual([
      "$point pin.png",
      "$point pin.json",
      "$point state.json",
    ])
    expect(atob(payload.assets[2].dataBase64)).toBe("{}")
  })

  it("marks saved rows with a Claude note or a non-open status read-only", () => {
    const tree = fromPoint(parsePoint(POINT))
    expect(tree.savedRowId).toBe("5")
    expect(tree.children.map((c) => [c.savedRowId, c.locked])).toEqual([
      ["5.a", true],
      ["5.b", true],
      ["5.c", false],
    ])
  })

  it("turns edits on a saved point into ops", () => {
    const point = parsePoint(POINT)
    let tree = fromPoint(point)
    const [a, , c] = tree.children
    tree = remove(tree, a.id)
    tree = updateNode(tree, c.id, { text: "Search field is off" })
    tree = appendChild(tree, c.id)
    const added = tree.children[1].children[1]
    tree = updateNode(tree, added.id, {
      text: "also on hover",
      files: [{ name: "shot.png", dataBase64: "CCC" }],
    })
    tree = updateNode(tree, tree.children[1].children[0].id, {
      files: [{ name: "note.txt", dataBase64: "DDD" }],
    })
    expect(buildOps(point, tree)).toEqual([
      {
        op: { kind: "deleteRow", rowId: "5.a" },
        assets: [{ rowId: "5.c.1", name: "note.txt", dataBase64: "DDD" }],
      },
      { op: { kind: "editText", rowId: "5.c", text: "Search field is off" }, assets: [] },
      {
        op: { kind: "addChild", rowId: "5.c", row: { text: "also on hover", children: [] } },
        assets: [{ rowId: "$0", name: "shot.png", dataBase64: "CCC" }],
      },
    ])
  })

  it("carries files on an otherwise unchanged point with a no-op pin write", () => {
    const point = parsePoint(POINT)
    let tree = fromPoint(point)
    tree = updateNode(tree, tree.children[0].id, {
      files: [{ name: "a.png", dataBase64: "EEE" }],
    })
    expect(buildOps(point, tree)).toEqual([
      {
        op: { kind: "setPin", rowId: "5.a", pin: undefined },
        assets: [{ rowId: "5.a", name: "a.png", dataBase64: "EEE" }],
      },
    ])
    expect(buildOps(point, fromPoint(point))).toEqual([])
  })
})
