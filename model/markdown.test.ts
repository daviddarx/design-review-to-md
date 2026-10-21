import { describe, expect, it } from "vitest"
import { parsePoint, serializePoint } from "./markdown.ts"

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

describe("markdown", () => {
  it("parses the spec example", () => {
    const p = parsePoint(SPEC)
    expect(p.number).toBe(5)
    expect(p.title).toBe("Main navigation")
    expect(p.pin).toEqual({
      path: "/concept-08-4/tickets",
      screenshot: "05-main-navigation/5-pin.png",
    })
    expect(p.rows.map((r) => r.label)).toEqual(["a", "b", "c", "d"])
    expect(p.rows.map((r) => r.status)).toEqual(["done", "open", "review", "open"])
    expect(p.rows[1].history).toEqual([
      { kind: "before", text: "Active state is hard to see" },
      { kind: "claude", text: "100% fails contrast on the hover fill, kept 80%" },
    ])
    expect(p.rows[2].pin?.screenshot).toBe("05-main-navigation/5.c-pin.png")
  })

  it("round-trips the spec example byte-for-byte", () => {
    expect(serializePoint(parsePoint(SPEC))).toBe(SPEC)
  })

  it("a row without a tag reads as open", () => {
    const md = "# 1. T\n\n- a. plain\n"
    const p = parsePoint(md)
    expect(p.rows[0].status).toBe("open")
    expect(serializePoint(p)).toBe("# 1. T\n\n- a. plain `open`\n")
  })

  it("a trailing backticked non-status word stays in the text", () => {
    const p = parsePoint("# 1. T\n\n- a. Use `font-semibold`\n")
    expect(p.rows[0].text).toBe("Use `font-semibold`")
    expect(p.rows[0].status).toBe("open")
  })

  it("unknown lines are preserved", () => {
    const md = `# 1. T

A note before the rows.

- a. one \`open\`
- b. two \`open\`
  A free paragraph under b.
- c. three \`done\`
`
    const p = parsePoint(md)
    expect(p.preamble).toEqual(["A note before the rows."])
    expect(p.rows[1].extra).toEqual(["  A free paragraph under b."])
    expect(serializePoint(p)).toBe(md)
  })

  it("sub-sub-points", () => {
    const md = `# 1. T

- a. one \`open\`
- b. two \`open\`
  - 1. inner \`open\`
  - 2. inner two \`review\`
- c. three \`done\`
`
    const p = parsePoint(md)
    expect(p.rows[1].children[0].label).toBe("1")
    expect(p.rows[1].children[1].status).toBe("review")
    expect(serializePoint(p)).toBe(md)
  })
})
