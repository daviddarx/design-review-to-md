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

describe("topics", () => {
  it("rejects unsafe topic names", async () => {
    for (const bad of ["../x", "a/b", "  ", ".."]) {
      await expect(storage.createTopic(bad)).rejects.toMatchObject({
        name: "StorageError",
        status: 400,
      })
    }
    await expect(storage.createTopic("../x")).rejects.toBeInstanceOf(StorageError)
  })

  it("turns spaces into dashes and lists sorted", async () => {
    await storage.createTopic("b topic")
    await storage.createTopic("a")
    expect(await storage.listTopics()).toEqual(["a", "b-topic"])
    const meta = JSON.parse(await fs.readFile(path.join(root, "a", "topic.json"), "utf8"))
    expect(meta).toEqual({ nextPoint: 1, retired: [] })
  })

  it("404s on a missing topic", async () => {
    await expect(storage.readTopic("nope")).rejects.toMatchObject({ status: 404 })
  })
})

describe("points", () => {
  it("numbers are never reused", async () => {
    await storage.createTopic("t")
    for (let i = 0; i < 3; i++) await storage.createPoint("t", `P${i}`, [], undefined, [])
    await storage.deletePoint("t", 3)
    const { number } = await storage.createPoint("t", "Again", [], undefined, [])
    expect(number).toBe(4)
    const { meta } = await storage.readTopic("t")
    expect(meta.retired).toContain("3")
  })

  it("createPoint writes the file and assets", async () => {
    await storage.createTopic("t")
    await fs.writeFile(
      path.join(root, "t", "topic.json"),
      JSON.stringify({ nextPoint: 5, retired: [] })
    )
    const res = await storage.createPoint(
      "t",
      "Main navigation",
      [row("first", [row("sub")]), row("second")],
      pin,
      [
        { rowId: "$point", name: "pin.png", dataBase64: PNG },
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
    const topic = await storage.readTopic("t")
    expect(topic.points[0].point.rows[0].children[0].text).toBe("sub")
    expect(topic.meta.nextPoint).toBe(6)
  })

  it("creates no asset folder without assets", async () => {
    await storage.createTopic("t")
    await storage.createPoint("t", "Plain", [], undefined, [])
    expect(existsSync(path.join(root, "t", "01-plain"))).toBe(false)
  })

  it("rejects bad asset names and unknown ids", async () => {
    await storage.createTopic("t")
    for (const asset of [
      { rowId: "$point", name: "../evil.png", dataBase64: PNG },
      { rowId: "$point", name: "a/b.png", dataBase64: PNG },
      { rowId: "$9", name: "x.png", dataBase64: PNG },
      { rowId: "7.a", name: "x.png", dataBase64: PNG },
    ]) {
      await expect(storage.createPoint("t", "T", [], undefined, [asset])).rejects.toMatchObject({
        status: 400,
      })
    }
  })
})

describe("applyOp", () => {
  it("reads the file fresh", async () => {
    await storage.createTopic("t")
    await storage.createPoint("t", "Nav", [row("one")], undefined, [])
    const file = path.join(root, "t", "01-nav.md")
    const md = await fs.readFile(file, "utf8")
    await fs.writeFile(file, md.replace("`open`\n", "`open`\n  - Claude: tried it\n"))
    await storage.applyOp("t", 1, { kind: "setStatus", rowId: "1.a", status: "review" }, [])
    const after = await fs.readFile(file, "utf8")
    expect(after).toContain("Claude: tried it")
    expect(after).toContain("`review`")
  })

  it("maps OpError to status codes", async () => {
    await storage.createTopic("t")
    await storage.createPoint("t", "Nav", [row("one")], undefined, [])
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
    await storage.createTopic("t")
    await storage.createPoint("t", "Nav", [row("one")], undefined, [])
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

  it("deleteRow removes the row's assets and retires its id", async () => {
    await storage.createTopic("t")
    await storage.createPoint("t", "Nav", [row("one"), row("two")], undefined, [
      { rowId: "$0", name: "pin.png", dataBase64: PNG },
      { rowId: "$1", name: "pin.png", dataBase64: PNG },
    ])
    const dir = path.join(root, "t", "01-nav")
    await storage.applyOp("t", 1, { kind: "deleteRow", rowId: "1.a" }, [])
    expect(existsSync(path.join(dir, "1.a-pin.png"))).toBe(false)
    expect(existsSync(path.join(dir, "1.b-pin.png"))).toBe(true)
    expect((await storage.readTopic("t")).meta.retired).toContain("1.a")
  })

  it("keeps the file name when the title is refined", async () => {
    await storage.createTopic("t")
    await storage.createPoint("t", "Nav", [], undefined, [])
    await storage.applyOp("t", 1, { kind: "refine", rowId: "1", text: "Menu" }, [])
    expect(existsSync(path.join(root, "t", "01-nav.md"))).toBe(true)
    expect((await storage.readTopic("t")).points[0].point.title).toBe("Menu")
  })

  it("deletePoint removes the file and the asset folder", async () => {
    await storage.createTopic("t")
    await storage.createPoint("t", "Nav", [], undefined, [
      { rowId: "$point", name: "pin.png", dataBase64: PNG },
    ])
    await storage.deletePoint("t", 1)
    expect(existsSync(path.join(root, "t", "01-nav.md"))).toBe(false)
    expect(existsSync(path.join(root, "t", "01-nav"))).toBe(false)
  })
})

describe("assetPath", () => {
  it("stays inside the topic folder", () => {
    expect(storage.assetPath("t", "01-nav/1-pin.png")).toBe(
      path.join(root, "t", "01-nav/1-pin.png")
    )
    expect(() => storage.assetPath("t", "../../etc/passwd")).toThrow(StorageError)
  })
})
