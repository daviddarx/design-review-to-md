import { describe, expect, it } from "vitest"
import { isReadyOutput, PORT_BASE, PORT_PAIRS, portsFor, withTarget } from "./cli.ts"

describe("isReadyOutput", () => {
  it("matches Next's ready line, with or without colour codes", () => {
    expect(isReadyOutput(" ✓ Ready in 1186ms\n")).toBe(true)
    expect(isReadyOutput("\x1b[32m✓\x1b[39m \x1b[1mReady\x1b[22m in 1.2s\n")).toBe(true)
  })

  it("matches Vite's ready line", () => {
    expect(isReadyOutput("  VITE v7.1.0  ready in 312 ms\n")).toBe(true)
  })

  it("ignores the other startup lines", () => {
    expect(isReadyOutput("- Local:         http://localhost:3001\n")).toBe(false)
    expect(isReadyOutput("▲ Next.js 16.2.3 (Turbopack)\n")).toBe(false)
  })
})

describe("portsFor", () => {
  it("gives a checkout the same pair every time, away from 3000/3001", () => {
    const a = portsFor("/Users/me/Gits/app")
    expect(portsFor("/Users/me/Gits/app")).toEqual(a)
    expect(a.target).toBe(a.port + 1)
    expect(a.port % 2).toBe(0)
    expect(a.port).toBeGreaterThanOrEqual(PORT_BASE)
    expect(a.target).toBeLessThan(PORT_BASE + PORT_PAIRS * 2)
  })

  it("gives another worktree another pair", () => {
    expect(portsFor("/Users/me/Gits/app.feat-1").port).not.toBe(
      portsFor("/Users/me/Gits/app.feat-2").port
    )
  })

  it("steps to the next pair, wrapping inside the range", () => {
    const a = portsFor("/x")
    const b = portsFor("/x", 1)
    expect(b.port === a.port + 2 || b.port === PORT_BASE).toBe(true)
  })
})

describe("withTarget", () => {
  it("puts the app's port into its command", () => {
    expect(withTarget(["npx", "next", "dev", "-p", "{target}"], 4321)).toEqual([
      "npx",
      "next",
      "dev",
      "-p",
      "4321",
    ])
  })
})
