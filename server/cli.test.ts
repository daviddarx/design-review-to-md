import { describe, expect, it } from "vitest"
import { isReadyOutput } from "./cli.ts"

describe("isReadyOutput", () => {
  it("matches Next's ready line, with or without colour codes", () => {
    expect(isReadyOutput(" ✓ Ready in 1186ms\n")).toBe(true)
    expect(isReadyOutput("\x1b[32m✓\x1b[39m \x1b[1mReady\x1b[22m in 1.2s\n")).toBe(true)
  })

  it("ignores the other startup lines", () => {
    expect(isReadyOutput("- Local:         http://localhost:3001\n")).toBe(false)
    expect(isReadyOutput("▲ Next.js 16.2.3 (Turbopack)\n")).toBe(false)
  })
})
