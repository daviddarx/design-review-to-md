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
    expect(rows[1].before).toBe("second ask")
    expect(rows[0].before).toBeUndefined()
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
    expect(html).toContain(
      '<div class="files"><p>Attached data</p><ul><li><a href="01-nav/1.a-ref.png">1.a-ref.png</a></li></ul></div>'
    )
    expect(html).toContain("Before: second ask")
    expect(html).not.toContain("was:")
    expect(html).toContain("1.e.1")
    expect(html).toContain(`<span class="id">3</span><div class="body"><h2>Logo too big`)
  })

  it("puts the attached data under the pin's link, above its picture", () => {
    expect(html).toContain(
      '<figcaption><a href="https://x.ch/home" target="_blank" rel="noopener">https://x.ch/home</a></figcaption><div class="files">'
    )
    expect(html.indexOf("Attached data")).toBeLessThan(html.indexOf('src="01-nav/1.a-pin.png"'))
  })

  it("escapes every text and loads no script from elsewhere", () => {
    expect(html).toContain("Icons &lt;b&gt;")
    expect(html).not.toContain("<b>")
    expect(html).toContain('href="https://x.ch/a?b=1&amp;c=2"')
    expect(html).not.toMatch(/<script[^>]*\bsrc=/)
  })

  it("links each pin to its full page on the site, without the pin icon", () => {
    expect(html).toContain(
      '<a href="https://x.ch/home" target="_blank" rel="noopener">https://x.ch/home</a>'
    )
    expect(html).not.toContain("📍")
  })

  it("opens a screenshot in a lightbox at the size it was captured", () => {
    const out = buildIndexHtml({
      url: "https://x.ch/a",
      round: "x.ch_a-0",
      feedbacks: [read(NAV, "01-nav")],
      dprs: { "01-nav/1.a-pin.png": 2 },
    })
    expect(out).toContain('src="01-nav/1.a-pin.png" alt="" data-dpr="2"')
    expect(out).toContain('id="lightbox"')
  })

  describe("several pins on one page", () => {
    const TWO = `# 6. Toolbar \`open\`

- a. Both icons \`open\`
  📍 /map — ![](6.a-pin.png)
  📍 /map — ![](6.a-pin-2.png)
  📍 /list — ![](6.a-pin-3.png)
`
    const at = (x: number, spot = false) => ({
      viewport: { width: 800, height: 600 },
      rect: { x, y: 10, width: 30, height: 20 },
      mouse: { x: x + 5, y: 15 },
      spot,
    })
    const marks = {
      "06-bar/6.a-pin.png": at(100),
      "06-bar/6.a-pin-2.png": at(400, true),
      "06-bar/6.a-pin-3.png": at(50),
    }
    const svgOf = (html: string) => {
      const m = /src="data:image\/svg\+xml;base64,([^"]+)"/.exec(html)
      return m ? Buffer.from(m[1], "base64").toString() : null
    }
    const build = (opts: object) =>
      buildIndexHtml({
        url: "https://x.ch",
        round: "x-0",
        feedbacks: [read(TWO, "06-bar")],
        ...opts,
      })

    it("draws them numbered on the latest one's unmarked picture, once", () => {
      const html = build({ marks, plains: { "06-bar/6.a-pin-2.png": "UExBSU4=" } })
      const svg = svgOf(html)!
      expect(svg).toContain('width="800" height="600" viewBox="0 0 800 600"')
      expect(svg).toContain('href="data:image/png;base64,UExBSU4="')
      expect(svg).toContain('<rect x="100" y="10" width="30" height="20"')
      expect(svg).toContain('<circle cx="405" cy="15" r="16"')
      expect(svg).toContain(">1</text>")
      expect(svg).toContain(">2</text>")
      expect(svg).not.toContain(">3</text>")
      expect(html).not.toContain('src="06-bar/6.a-pin.png"')
      expect(html).not.toContain('src="06-bar/6.a-pin-2.png"')
      expect(html).toContain('src="06-bar/6.a-pin-3.png"')
      expect(html.match(/https:\/\/x\.ch\/map</g)).toHaveLength(1)
    })

    it("keeps them apart without the unmarked picture or at another window size", () => {
      expect(svgOf(build({ marks }))).toBeNull()
      const resized = {
        ...marks,
        "06-bar/6.a-pin.png": { ...at(100), viewport: { width: 1, height: 600 } },
      }
      const html = build({ marks: resized, plains: { "06-bar/6.a-pin-2.png": "UExBSU4=" } })
      expect(svgOf(html)).toBeNull()
      expect(html).toContain('src="06-bar/6.a-pin.png"')
    })
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
        "> Work through every row tagged `open` (new or refined) or `review` (asked last round, not checked yet) in this folder (x.ch_a-0) — follow PROTOCOL.md in it. index.html shows the same corrections with their screenshots.",
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
    await fs.writeFile(
      path.join(dir, "01-nav", "1.a-pin.json"),
      JSON.stringify({ version: 1, at: "", steps: [{ viewport: { width: 1, height: 1, dpr: 2 } }] })
    )
    const openFolder = vi.fn()
    const storage = new Storage(root)

    await finalizeRound(storage, "x.ch_a-0", "https://x.ch/a", openFolder)
    expect(openFolder).toHaveBeenCalledWith(dir)
    const index = await fs.readFile(path.join(dir, "index.html"), "utf8")
    expect(index).toContain("Brand blue")
    expect(index).toContain('src="01-nav/1.a-pin.png" alt="" data-dpr="2"')
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

  it("draws a row's pins on one page together, from the unmarked picture in the state root", async () => {
    const dir = path.join(root, "x.ch_a-0")
    await fs.mkdir(path.join(dir, "01-bar"), { recursive: true })
    await fs.writeFile(
      path.join(dir, "01-bar", "briefing.md"),
      "# 1. Bar `open`\n\n📍 /map — ![](1-pin.png)\n📍 /map — ![](1-pin-2.png)\n"
    )
    const step = {
      viewport: { width: 800, height: 600, dpr: 2 },
      mouse: { x: 5, y: 5 },
      element: { tag: "div", rect: { x: 0, y: 0, width: 10, height: 10 } },
    }
    for (const name of ["1-pin.json", "1-pin-2.json"]) {
      await fs.writeFile(path.join(dir, "01-bar", name), JSON.stringify({ steps: [step] }))
    }
    const state = path.join(root, ".state")
    await fs.mkdir(path.join(state, "x.ch_a-0", "01-bar"), { recursive: true })
    await fs.writeFile(path.join(state, "x.ch_a-0", "01-bar", "1-plain-2.png"), "PLAIN")

    await finalizeRound(
      new Storage(root, { stateRoot: state }),
      "x.ch_a-0",
      "https://x.ch/a",
      vi.fn()
    )
    const index = await fs.readFile(path.join(dir, "index.html"), "utf8")
    const svg = /src="data:image\/svg\+xml;base64,([^"]+)"/.exec(index)
    expect(Buffer.from(svg![1], "base64").toString()).toContain(
      `base64,${Buffer.from("PLAIN").toString("base64")}`
    )
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
