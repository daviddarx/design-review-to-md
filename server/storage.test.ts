import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync } from "node:fs"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Storage, StorageError } from "./storage.ts"

const PNG = Buffer.from("png-bytes").toString("base64")
let root: string
let storage: Storage

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "review-storage-"))
  storage = new Storage(root)
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

type D = { text: string; children: D[] }
const row = (text: string, children: D[] = []): D => ({ text, children })
const pin = { path: "Home > Nav", screenshot: "x" }

describe("reviews", () => {
  it("rejects unsafe review names", async () => {
    for (const bad of ["../x", "a/b", "  ", ".."]) {
      await expect(storage.createReview(bad)).rejects.toMatchObject({
        name: "StorageError",
        status: 400,
      })
    }
    await expect(storage.createReview("../x")).rejects.toBeInstanceOf(StorageError)
  })

  it("returns the sanitized name it created", async () => {
    expect(await storage.createReview("  my review ")).toBe("my-review")
    expect(storage.root).toBe(path.resolve(root))
  })

  it("turns spaces into dashes and lists sorted", async () => {
    await storage.createReview("b review")
    await storage.createReview("a")
    expect(await storage.listReviews()).toEqual(["a", "b-review"])
    expect((await storage.readReview("a")).meta).toEqual({ nextFeedback: 1 })
    expect(await fs.readdir(path.join(root, "a"))).toEqual([])
  })

  it("a missing review folder reads as an empty review, and its first feedback creates it", async () => {
    expect(await storage.readReview("gone")).toEqual({ meta: { nextFeedback: 1 }, feedbacks: [] })
    expect((await storage.createFeedback("gone", "First", [], undefined, [])).number).toBe(1)
    expect(existsSync(path.join(root, "gone", "01-first.md"))).toBe(true)
  })
})

describe("feedbacks", () => {
  it("the next number is one past the highest feedback file, gaps included", async () => {
    await storage.createReview("t")
    for (let i = 0; i < 3; i++) await storage.createFeedback("t", `P${i}`, [], undefined, [])
    await storage.deleteFeedback("t", 2)
    expect((await storage.createFeedback("t", "Next", [], undefined, [])).number).toBe(4)
    // Deleting the highest frees its number.
    await storage.deleteFeedback("t", 4)
    expect((await storage.readReview("t")).meta).toEqual({ nextFeedback: 4 })
    expect(existsSync(path.join(root, "t", "review.json"))).toBe(false)
  })

  it("a broken first line takes its number from the file name", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [row("one")], undefined, [])
    const file = path.join(root, "t", "01-nav.md")
    const md = await fs.readFile(file, "utf8")
    await fs.writeFile(file, md.replace("# 1. Nav", "#1 Nav"))
    const [{ feedback }] = (await storage.readReview("t")).feedbacks
    expect(feedback.number).toBe(1)
    await storage.applyOp("t", 1, { kind: "editText", rowId: "1.a", text: "uno" }, [])
    expect(await fs.readFile(file, "utf8")).toContain("- a. uno `open`")
  })

  it("refuses an attachment spelled like a pin file in another case", async () => {
    await storage.createReview("t")
    for (const name of ["PIN.png", "Pin.Json", "STATE.JSON"]) {
      await expect(
        storage.createFeedback("t", "Nav", [], undefined, [
          { rowId: "$feedback", name, dataBase64: PNG },
        ])
      ).rejects.toMatchObject({ status: 400 })
    }
    // the picker's own names still go through
    await storage.createFeedback("t", "Nav", [], { path: "/a" }, [
      { rowId: "$feedback", name: "pin.png", dataBase64: PNG },
      { rowId: "$feedback", name: "pin.json", dataBase64: PNG },
      { rowId: "$feedback", name: "state.json", dataBase64: PNG },
    ])
    expect(existsSync(path.join(root, "t", "01-nav", "1-state.json"))).toBe(true)
  })

  it("createFeedback writes the file and assets", async () => {
    await storage.createReview("t")
    await fs.writeFile(path.join(root, "t", "04-earlier.md"), "# 4. Earlier\n")
    const res = await storage.createFeedback(
      "t",
      "Main navigation",
      [row("first", [row("sub")]), row("second")],
      pin,
      [
        { rowId: "$feedback", name: "pin.png", dataBase64: PNG },
        { rowId: "$0.0", name: "pin.png", dataBase64: PNG },
        { rowId: "$1", name: "shot.png", dataBase64: PNG },
      ]
    )
    expect(res).toEqual({ number: 5, rowIds: ["5.a", "5.a.1", "5.b"] })
    const dir = path.join(root, "t")
    expect(existsSync(path.join(dir, "05-main-navigation/5-pin.png"))).toBe(true)
    expect(existsSync(path.join(dir, "05-main-navigation/5.a.1-pin.png"))).toBe(true)
    expect(existsSync(path.join(dir, "05-main-navigation/5.b-shot.png"))).toBe(true)
    const md = await fs.readFile(path.join(dir, "05-main-navigation.md"), "utf8")
    expect(md).toContain("# 5. Main navigation")
    expect(md).toContain("📍 Home > Nav — ![](05-main-navigation/5-pin.png)")
    const review = await storage.readReview("t")
    expect(review.feedbacks[1].feedback.rows[0].children[0].text).toBe("sub")
    expect(review.meta.nextFeedback).toBe(6)
  })

  it("creates no asset folder without assets", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Plain", [], undefined, [])
    expect(existsSync(path.join(root, "t", "01-plain"))).toBe(false)
  })

  it("rejects bad asset names and unknown ids", async () => {
    await storage.createReview("t")
    for (const asset of [
      { rowId: "$feedback", name: "../evil.png", dataBase64: PNG },
      { rowId: "$feedback", name: "a/b.png", dataBase64: PNG },
      { rowId: "$9", name: "x.png", dataBase64: PNG },
      { rowId: "7.a", name: "x.png", dataBase64: PNG },
    ]) {
      await expect(storage.createFeedback("t", "T", [], undefined, [asset])).rejects.toMatchObject({
        status: 400,
      })
    }
  })
})

describe("applyOp", () => {
  it("reads the file fresh", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [row("one")], undefined, [])
    const file = path.join(root, "t", "01-nav.md")
    const md = await fs.readFile(file, "utf8")
    await fs.writeFile(file, md.replace("`open`\n", "`open`\n  - Claude: tried it\n"))
    await storage.applyOp("t", 1, { kind: "setStatus", rowId: "1.a", status: "review" }, [])
    const after = await fs.readFile(file, "utf8")
    expect(after).toContain("Claude: tried it")
    expect(after).toContain("`review`")
  })

  it("maps OpError to status codes", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [row("one")], undefined, [])
    await expect(
      storage.applyOp("t", 1, { kind: "setStatus", rowId: "1.z", status: "done" }, [])
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      storage.applyOp("t", 9, { kind: "setStatus", rowId: "9.a", status: "done" }, [])
    ).rejects.toMatchObject({ status: 404 })
    await storage.applyOp("t", 1, { kind: "setStatus", rowId: "1.a", status: "done" }, [])
    await expect(
      storage.applyOp("t", 1, { kind: "editText", rowId: "1.a", text: "x" }, [])
    ).rejects.toMatchObject({ status: 409 })
  })

  it("addChild maps draft-relative asset ids", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [row("one")], undefined, [])
    const res = await storage.applyOp(
      "t",
      1,
      { kind: "addChild", rowId: "1", row: row("two", [row("kid")]) },
      [
        { rowId: "$0", name: "a.png", dataBase64: PNG },
        { rowId: "$0.0", name: "b.png", dataBase64: PNG },
      ]
    )
    expect(res.addedRowIds).toEqual(["1.b", "1.b.1"])
    expect(existsSync(path.join(root, "t", "01-nav", "1.b-a.png"))).toBe(true)
    expect(existsSync(path.join(root, "t", "01-nav", "1.b.1-b.png"))).toBe(true)
  })

  it("a re-pin without a picture writes a bare pin line and drops the old png", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [], { path: "/a" }, [
      { rowId: "$feedback", name: "pin.png", dataBase64: PNG },
    ])
    expect(await fs.readFile(path.join(root, "t", "01-nav.md"), "utf8")).toContain(
      "📍 /a — ![](01-nav/1-pin.png)"
    )
    await storage.applyOp("t", 1, { kind: "setPin", rowId: "1", pin: { path: "/b" } }, [
      { rowId: "1", name: "pin.json", dataBase64: PNG },
    ])
    const md = await fs.readFile(path.join(root, "t", "01-nav.md"), "utf8")
    expect(md).toContain("📍 /b\n")
    expect(existsSync(path.join(root, "t", "01-nav", "1-pin.png"))).toBe(false)
    expect(existsSync(path.join(root, "t", "01-nav", "1-pin.json"))).toBe(true)
  })

  it("links every attachment under its row, and the link round-trips", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [row("one", [row("kid")]), row("two")], undefined, [
      { rowId: "$feedback", name: "overview.pdf", dataBase64: PNG },
      { rowId: "$0", name: "pin.png", dataBase64: PNG },
      { rowId: "$0", name: "pin.json", dataBase64: PNG },
      { rowId: "$0", name: "state.json", dataBase64: PNG },
      { rowId: "$0.0", name: "my shot.png", dataBase64: PNG },
      { rowId: "$1", name: "ref.png", dataBase64: PNG },
    ])
    const file = path.join(root, "t", "01-nav.md")
    const md = await fs.readFile(file, "utf8")
    expect(md).toBe(
      [
        "# 1. Nav",
        "",
        "📎 [1-overview.pdf](01-nav/1-overview.pdf)",
        "",
        "- a. one `open`",
        "  - 1. kid `open`",
        "    📎 [1.a.1-my shot.png](01-nav/1.a.1-my%20shot.png)",
        "- b. two `open`",
        "  📎 [1.b-ref.png](01-nav/1.b-ref.png)",
        "",
      ].join("\n")
    )
    expect(existsSync(path.join(root, "t", "01-nav", "1.a.1-my shot.png"))).toBe(true)
    // the row text is untouched, and a re-upload adds no second line
    await storage.applyOp("t", 1, { kind: "editText", rowId: "1.b", text: "two!" }, [
      { rowId: "1.b", name: "ref.png", dataBase64: PNG },
      { rowId: "1.b", name: "more.txt", dataBase64: PNG },
    ])
    const [{ feedback }] = (await storage.readReview("t")).feedbacks
    expect(feedback.rows[1].text).toBe("two!")
    expect(feedback.rows[1].extra).toEqual([
      "  📎 [1.b-ref.png](01-nav/1.b-ref.png)",
      "  📎 [1.b-more.txt](01-nav/1.b-more.txt)",
    ])
    expect(feedback.preamble).toEqual(["📎 [1-overview.pdf](01-nav/1-overview.pdf)"])
  })

  it("links an attachment of a row added with addChild", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [row("one")], undefined, [])
    await storage.applyOp("t", 1, { kind: "addChild", rowId: "1.a", row: row("kid") }, [
      { rowId: "$0", name: "a.png", dataBase64: PNG },
    ])
    const md = await fs.readFile(path.join(root, "t", "01-nav.md"), "utf8")
    expect(md).toContain("  - 1. kid `open`\n    📎 [1.a.1-a.png](01-nav/1.a.1-a.png)\n")
  })

  it("deleteRow removes the row's assets", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [row("one"), row("two")], undefined, [
      { rowId: "$0", name: "pin.png", dataBase64: PNG },
      { rowId: "$1", name: "pin.png", dataBase64: PNG },
    ])
    const dir = path.join(root, "t", "01-nav")
    await storage.applyOp("t", 1, { kind: "deleteRow", rowId: "1.a" }, [])
    expect(existsSync(path.join(dir, "1.a-pin.png"))).toBe(false)
    expect(existsSync(path.join(dir, "1.b-pin.png"))).toBe(true)
  })

  it("keeps the file name when the title is refined", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [], undefined, [])
    await storage.applyOp("t", 1, { kind: "refine", rowId: "1", text: "Menu" }, [])
    expect(existsSync(path.join(root, "t", "01-nav.md"))).toBe(true)
    expect((await storage.readReview("t")).feedbacks[0].feedback.title).toBe("Menu")
  })

  it("deleteFeedback removes the file and the asset folder", async () => {
    await storage.createReview("t")
    await storage.createFeedback("t", "Nav", [], undefined, [
      { rowId: "$feedback", name: "pin.png", dataBase64: PNG },
    ])
    await storage.deleteFeedback("t", 1)
    expect(existsSync(path.join(root, "t", "01-nav.md"))).toBe(false)
    expect(existsSync(path.join(root, "t", "01-nav"))).toBe(false)
  })
})

describe("assetPath", () => {
  it("stays inside the review folder", () => {
    expect(storage.assetPath("t", "01-nav/1-pin.png")).toBe(
      path.join(root, "t", "01-nav/1-pin.png")
    )
    expect(() => storage.assetPath("t", "../../etc/passwd")).toThrow(StorageError)
  })
})
