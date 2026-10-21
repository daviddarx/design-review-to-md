import * as esbuild from "esbuild"
import { watch, type FSWatcher } from "node:fs"
import { promises as fs } from "node:fs"
import path from "node:path"

const PACKAGE = path.resolve(import.meta.dirname, "..")
const SHELL = path.join(PACKAGE, "shell")
const MODEL = path.join(PACKAGE, "model")

// Bundles shell/main.tsx in memory. A change under shell/ or model/ marks the
// bundle stale and the next request rebuilds it, so iterating on the tool
// needs only a reload of the shell.
export function createShellBuild() {
  const ctx = esbuild.context({
    entryPoints: [path.join(SHELL, "main.tsx")],
    bundle: true,
    format: "esm",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".css": "text" },
    write: false,
    minify: false,
    outfile: "shell.js",
    logLevel: "silent",
  })
  let js: Promise<string> | undefined
  const watchers: FSWatcher[] = []
  for (const dir of [SHELL, MODEL]) {
    try {
      watchers.push(watch(dir, { recursive: true }, () => (js = undefined)))
    } catch {
      // A missing folder simply never invalidates.
    }
  }

  const build = async () => {
    const result = await (await ctx).rebuild()
    return result.outputFiles?.[0]?.text ?? ""
  }

  return {
    async assets(): Promise<{ js: string; css: string }> {
      js ??= build()
      const current = js
      current.catch(() => {
        if (js === current) js = undefined
      })
      const css = await fs.readFile(path.join(SHELL, "shell.css"), "utf8").catch(() => "")
      return { js: await current, css }
    },
    async dispose() {
      for (const w of watchers) w.close()
      await (await ctx).dispose()
    },
  }
}
