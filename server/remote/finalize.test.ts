import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseFeedback } from "../../model/markdown.ts"
import { fromBriefing, Storage } from "../storage.ts"
import { buildIndexHtml, finalizeRound, handOverRows, readmeText } from "./finalize.ts"

const NAV = `# 1. Nav \`open\`

📍 /home — ![](1-pin.png)

- a. Icons <b> \`open\`
  📍 /home — ![](1.a-pin.png)
  📎 [1.a-ref.png](1.a-ref.png)
- b. Old icons \`done\`
- c. Brand blue \`open\`
  - Before: first ask
  - Before: second ask
  - Claude: kept 80%
- d. Spacing \`review\`
- e. Header \`done\`
  - 1. Left edge \`open\`
  - 2. Right edge \`done\`
- f. Footer \`done\`
  - 1. Gone \`done\`
`
const FONTS = "# 2. Fonts `done`\n\n- a. Weights are off `done`\n"
const LOGO = "# 3. Logo too big `review`\n\n📍 /home\n"

// As storage.readReview hands them over: links relative to the review.
const read = (md: string, folder: string) => fromBriefing(parseFeedback(md), folder)

describe("handOverRows", () => {
  it("keeps open and review rows, drops done ones, and keeps a done parent as context", () => {
    const rows = handOverRows(read(NAV, "01-nav"))
    expect(rows.map((r) => [r.id, r.kind])).toEqual([
      ["1.a", "new"],
      ["1.c", "refined"],
      ["1.d", "still-open"],
      ["1.e", "context"],
    ])
    expect(rows[0]).toMatchObject({
      text: "Icons <b>",
      pins: [{ path: "/home", screenshot: "01-nav/1.a-pin.png" }],
      attachments: ["01-nav/1.a-ref.png"],
    })
    expect(rows[1].was).toBe("second ask")
    expect(rows[0].was).toBeUndefined()
    expect(rows[3].children.map((r) => [r.id, r.kind])).toEqual([["1.e.1", "new"]])
  })

  it("treats a feedback without rows as a row", () => {
    expect(handOverRows(read(LOGO, "03-logo"))).toEqual([
      {
        id: "3",
        text: "Logo too big",
        kind: "still-open",
        pins: [{ path: "/home" }],
        attachments: [],
        children: [],
      },
    ])
    expect(handOverRows(read("# 4. Gone `done`\n", "04-gone"))).toEqual([])
  })
})

describe("buildIndexHtml", () => {
  const html = buildIndexHtml({
    url: "https://x.ch/a?b=1&c=2",
    round: "x.ch_a-0",
    feedbacks: [read(NAV, "01-nav"), read(FONTS, "02-fonts"), read(LOGO, "03-logo")],
  })

  it("shows every row left, with its badge, pins and attachments", () => {
    expect(html).toContain("New")
    expect(html).toContain("Refined")
    expect(html).toContain("Still open from last round")
    expect(html).toContain('src="01-nav/1.a-pin.png"')
    expect(html).toContain('href="01-nav/1.a-ref.png"')
    expect(html).toContain("was: second ask")
    expect(html).toContain("1.e.1")
    expect(html).toContain("3. Logo too big")
  })

  it("escapes every text and has no script", () => {
    expect(html).toContain("Icons &lt;b&gt;")
    expect(html).not.toContain("<b>")
    expect(html).toContain('href="https://x.ch/a?b=1&amp;c=2"')
    expect(html).not.toContain("<script")
  })

  it("leaves out done rows and feedbacks with nothing left", () => {
    expect(html).not.toContain("Old icons")
    expect(html).not.toContain("Footer")
    expect(html).not.toContain("Fonts")
    expect(html).not.toContain("Nothing left to do in this round.")
  })

  it("says so when nothing is left", () => {
    const empty = buildIndexHtml({
      url: "https://x.ch",
      round: "x-1",
      feedbacks: [read(FONTS, "02-fonts")],
    })
    expect(empty).toContain("Nothing left to do in this round.")
  })

  it("links only relative and http(s) attachments", () => {
    const md = "# 5. Ref `open`\n\n📎 [evil](javascript:alert(1))\n📎 [web](https://e.x/y.png)\n"
    const out = buildIndexHtml({
      url: "https://x.ch",
      round: "x-1",
      feedbacks: [read(md, "05-ref")],
    })
    expect(out).not.toContain(`href="javascript:`)
    expect(out).toContain('href="https://e.x/y.png"')
  })
})

describe("readmeText", () => {
  it("is the hand-over prompt", () => {
    expect(readmeText({ url: "https://x.ch/a", round: "x.ch_a-0" })).toBe(
      [
        "# Design review — x.ch_a-0",
        "",
        "Site: https://x.ch/a",
        "",
        "Paste this to your coding agent, in your repo:",
        "",
        "> Work through every row tagged `open` or `review` in this folder (x.ch_a-0) — follow PROTOCOL.md in it. index.html shows the same corrections with their screenshots.",
        "",
      ].join("\n")
    )
  })
})

describe("finalizeRound", () => {
  let root: string
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "finalize-"))
  })
  afterEach(() => fs.rm(root, { recursive: true, force: true }))

  it("writes index.html, readme.md and PROTOCOL.md, then opens the folder", async () => {
    const dir = path.join(root, "x.ch_a-0")
    await fs.mkdir(path.join(dir, "01-nav"), { recursive: true })
    await fs.writeFile(path.join(dir, "01-nav", "briefing.md"), NAV)
    const openFolder = vi.fn()
    const storage = new Storage(root)

    await finalizeRound(storage, "x.ch_a-0", "https://x.ch/a", openFolder)
    expect(openFolder).toHaveBeenCalledWith(dir)
    expect(await fs.readFile(path.join(dir, "index.html"), "utf8")).toContain("Brand blue")
    expect(await fs.readFile(path.join(dir, "readme.md"), "utf8")).toContain("Site: https://x.ch/a")
    const protocol = await fs.readFile(path.join(dir, "PROTOCOL.md"), "utf8")
    expect(protocol).toBe(
      await fs.readFile(path.resolve(import.meta.dirname, "../../templates/PROTOCOL.md"), "utf8")
    )

    await fs.writeFile(path.join(dir, "01-nav", "briefing.md"), NAV.replace("Brand blue", "Teal"))
    await finalizeRound(storage, "x.ch_a-0", "https://x.ch/a", openFolder)
    const again = await fs.readFile(path.join(dir, "index.html"), "utf8")
    expect(again).toContain("Teal")
    expect(again).not.toContain("Brand blue")
  })

  it("refuses a round that does not exist", async () => {
    const openFolder = vi.fn()
    await expect(
      finalizeRound(new Storage(root), "nope-0", "https://x.ch", openFolder)
    ).rejects.toMatchObject({
      status: 404,
    })
    expect(openFolder).not.toHaveBeenCalled()
  })
})
