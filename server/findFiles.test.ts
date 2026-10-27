import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createSourceResolver } from "./findFiles.ts"

let repo: string

async function put(...files: string[]) {
  for (const f of files) {
    await fs.mkdir(path.dirname(path.join(repo, f)), { recursive: true })
    await fs.writeFile(path.join(repo, f), "x")
  }
}

beforeEach(async () => {
  repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "find-files-")))
})

afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true })
})

// Both ways the repo can be listed: by git (a checkout) and by walking it.
describe.each([
  ["a git checkout", true],
  ["a plain folder", false],
])("createSourceResolver in %s", (_, git) => {
  beforeEach(() => {
    if (git) execFileSync("git", ["init", "-q"], { cwd: repo })
  })

  it("upgrades a unique basename to its repo-relative path", async () => {
    await put("packages/ds/src/components/actions/Button/Button.tsx", "src/App.tsx")
    const resolve = createSourceResolver(repo)
    expect(await resolve("Button.tsx")).toEqual({
      file: "packages/ds/src/components/actions/Button/Button.tsx",
    })
  })

  it("keeps the basename and lists the candidates when several match", async () => {
    await put("b/Button.tsx", "a/Button.tsx")
    const resolve = createSourceResolver(repo)
    expect(await resolve("Button.tsx")).toEqual({
      file: "Button.tsx",
      candidates: ["a/Button.tsx", "b/Button.tsx"],
    })
  })

  it("keeps the basename when nothing matches", async () => {
    await put("src/App.tsx")
    expect(await createSourceResolver(repo)("Button.tsx")).toEqual({ file: "Button.tsx" })
  })

  it("skips node_modules, dist, storybook-static and .git", async () => {
    await put(
      "src/Button.tsx",
      "node_modules/ui/Button.tsx",
      "packages/ds/node_modules/ui/Button.tsx",
      "dist/Button.tsx",
      "packages/ds/dist/Button.tsx",
      "storybook-static/Button.tsx",
      ".git/Button.tsx"
    )
    expect(await createSourceResolver(repo)("Button.tsx")).toEqual({ file: "src/Button.tsx" })
  })

  it("narrows several matches to the one the script URL names", async () => {
    await put(
      "packages/ds/src/components/actions/Button/Button.tsx",
      "scripts/fixtures/actions/Button/Button.tsx"
    )
    const resolve = createSourceResolver(repo)
    const real = "packages/ds/src/components/actions/Button/Button.tsx"
    // Vite serves a workspace file outside its root under /@fs/<absolute path>.
    expect(
      await resolve("Button.tsx", `http://localhost:6006/@fs${repo}/${real}?t=1700000000000`)
    ).toEqual({ file: real })
    // A script URL that names neither leaves the choice open.
    expect(await resolve("Button.tsx", "http://localhost:6006/assets/chunk.js")).toEqual({
      file: "Button.tsx",
      candidates: [real, "scripts/fixtures/actions/Button/Button.tsx"],
    })
  })

  it("searches once per basename", async () => {
    await put("src/Button.tsx")
    const resolve = createSourceResolver(repo)
    expect(await resolve("Button.tsx")).toEqual({ file: "src/Button.tsx" })
    await put("other/Button.tsx")
    expect(await resolve("Button.tsx")).toEqual({ file: "src/Button.tsx" })
    expect(await createSourceResolver(repo)("Button.tsx")).toMatchObject({
      candidates: ["other/Button.tsx", "src/Button.tsx"],
    })
  })
})

describe("createSourceResolver and .gitignore", () => {
  it("leaves out what the checkout ignores", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo })
    await fs.writeFile(path.join(repo, ".gitignore"), "generated/\n")
    await put("src/Button.tsx", "generated/Button.tsx")
    expect(await createSourceResolver(repo)("Button.tsx")).toEqual({ file: "src/Button.tsx" })
  })
})
