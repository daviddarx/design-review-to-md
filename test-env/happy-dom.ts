// A happy-dom environment for the package's DOM tests. Vitest's built-in
// `happy-dom` environment imports the library from vitest's own folder (the
// repo root), where it is not installed — it is a devDependency of this
// package only. Select it per file with `// @vitest-environment dr-happy-dom`
// (aliased in vitest.config.mts) so model/server tests stay in node.
import { GlobalWindow } from "happy-dom"
import { populateGlobal, type Environment } from "vitest/environments"

const environment: Environment = {
  name: "design-review-happy-dom",
  viteEnvironment: "client",
  async setup(global) {
    const win = new GlobalWindow({
      url: "http://localhost:3000",
      settings: { disableErrorCapturing: true },
    })
    const { keys, originals } = populateGlobal(global, win, {
      bindFunctions: true,
      additionalKeys: ["URL", "URLSearchParams"],
    })
    return {
      async teardown(global) {
        await win.happyDOM.abort()
        win.close()
        keys.forEach((key) => delete global[key])
        originals.forEach((v, k) => (global[k] = v))
      },
    }
  },
}

export default environment
