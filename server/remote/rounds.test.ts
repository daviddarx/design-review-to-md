import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  chooseRound,
  isFinalized,
  latestRound,
  remotePort,
  roundName,
  startNextRound,
  urlKey,
} from "./rounds.ts"

let base: string
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "rounds-"))
})
afterEach(() => fs.rm(base, { recursive: true, force: true }))

describe("urlKey", () => {
  const long = "https://web1.stage.campos.ch/en_4765/desktopapp/map/MA_4765-1-3189"
  it("joins host and path", () => {
    expect(urlKey(long)).toBe("web1.stage.campos.ch_en_4765_desktopapp_map_MA_4765-1-3189")
  })
  it("ignores trailing slash, query, hash and host case", () => {
    const key = urlKey(long)
    expect(urlKey(long + "/")).toBe(key)
    expect(urlKey(long + "?x=1#h")).toBe(key)
    expect(urlKey(long.replace("web1.stage.campos.ch", "WEB1.Stage.Campos.CH"))).toBe(key)
  })
  it("drops the query of a root-ish path", () => {
    expect(urlKey("https://web3.stage.campos.ch/printingeditorapp/?gallery=1")).toBe(
      "web3.stage.campos.ch_printingeditorapp"
    )
  })
})

describe("remotePort", () => {
  it("is stable and within range", () => {
    const p = remotePort("web1.stage.campos.ch_x")
    expect(remotePort("web1.stage.campos.ch_x")).toBe(p)
    expect(p).toBeGreaterThanOrEqual(4900)
    expect(p).toBeLessThan(5700)
  })
})

describe("latestRound", () => {
  it("matches the exact key only", async () => {
    for (const d of ["k-0", "k-1", "k-x-0"]) await fs.mkdir(path.join(base, d))
    expect(await latestRound(base, "k")).toBe(1)
    expect(await latestRound(base, "none")).toBeNull()
  })
  it("is null when the base does not exist", async () => {
    expect(await latestRound(path.join(base, "nope"), "k")).toBeNull()
  })
})

describe("chooseRound", () => {
  it("creates -0, then reuses it while unfinalized", async () => {
    const ask = vi.fn(async () => "n")
    expect(await chooseRound(base, "k", ask)).toBe("k-0")
    expect((await fs.stat(path.join(base, "k-0"))).isDirectory()).toBe(true)
    expect(await chooseRound(base, "k", ask)).toBe("k-0")
    expect(ask).not.toHaveBeenCalled()
  })
  it("asks once finalized: n starts the next round, else continues", async () => {
    await chooseRound(base, "k", async () => "")
    await fs.writeFile(path.join(base, "k-0", "index.html"), "")
    expect(isFinalized(base, "k-0")).toBe(true)
    const ask = vi.fn(async () => "N")
    expect(await chooseRound(base, "k", ask)).toBe("k-1")
    expect(ask).toHaveBeenCalledWith("Continue round 0 or start round 1? [C/n] ")
    await fs.writeFile(path.join(base, "k-1", "index.html"), "")
    expect(await chooseRound(base, "k", async () => "c")).toBe("k-1")
  })
  it("returns an unfinalized latest without asking", async () => {
    await fs.mkdir(path.join(base, "k-0"))
    await fs.writeFile(path.join(base, "k-0", "index.html"), "")
    await fs.mkdir(path.join(base, "k-1"))
    const ask = vi.fn(async () => "n")
    expect(await chooseRound(base, "k", ask)).toBe("k-1")
    expect(ask).not.toHaveBeenCalled()
  })
})

describe("startNextRound", () => {
  const briefing = [
    "# 1. Title `open`",
    "",
    "📍 /x — ![](1-pin.png)",
    "",
    "weird unknown line",
    "",
    "- a. First `open`",
    "  - Claude: note",
    "- b. Second `done`",
    "- c. Third `open`",
    "  - 1. Sub `open`",
    "  - 2. Sub two `done`",
    "",
  ].join("\n")

  it("copies feedbacks, state, and retags open to review", async () => {
    const r0 = path.join(base, "k-0")
    await fs.mkdir(path.join(r0, "01-x"), { recursive: true })
    await fs.writeFile(path.join(r0, "01-x", "briefing.md"), briefing)
    await fs.writeFile(path.join(r0, "01-x", "1-pin.png"), "png")
    await fs.writeFile(path.join(r0, "index.html"), "")
    await fs.writeFile(path.join(r0, "readme.md"), "")
    await fs.writeFile(path.join(r0, "PROTOCOL.md"), "")
    await fs.mkdir(path.join(base, ".state", "k-0", "01-x"), { recursive: true })
    await fs.writeFile(path.join(base, ".state", "k-0", "01-x", "1-state.json"), "{}")

    expect(await startNextRound(base, "k", 0)).toBe("k-1")

    const r1 = path.join(base, "k-1")
    expect((await fs.readdir(r1)).sort()).toEqual(["01-x"])
    expect(await fs.readFile(path.join(r1, "01-x", "1-pin.png"), "utf8")).toBe("png")
    expect(
      await fs.readFile(path.join(base, ".state", "k-1", "01-x", "1-state.json"), "utf8")
    ).toBe("{}")
    const out = (await fs.readFile(path.join(r1, "01-x", "briefing.md"), "utf8")).split("\n")
    const src = briefing.split("\n")
    expect(out).toHaveLength(src.length)
    const changed = src.flatMap((l, i) => (l === out[i] ? [] : [i]))
    expect(changed).toEqual([0, 6, 9, 10])
    for (const i of changed) expect(out[i]).toBe(src[i].replace("`open`", "`review`"))
    // the source round is untouched
    expect(await fs.readFile(path.join(r0, "01-x", "briefing.md"), "utf8")).toBe(briefing)
  })

  it("works without a state dir", async () => {
    await fs.mkdir(path.join(base, "k-0", "01-x"), { recursive: true })
    await fs.writeFile(path.join(base, "k-0", "01-x", "briefing.md"), "# 1. T `open`\n")
    await startNextRound(base, "k", 0)
    expect(roundName("k", 1)).toBe("k-1")
  })
})
