import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      // `// @vitest-environment dr-happy-dom` in a DOM test file resolves the
      // package `vitest-environment-dr-happy-dom`; point it at the local file
      // (see test-env/happy-dom.ts for why the built-in one cannot be used).
      "vitest-environment-dr-happy-dom": path.join(import.meta.dirname, "test-env/happy-dom.ts"),
    },
  },
  test: {
    include: ["**/*.test.{ts,tsx}"],
  },
})
