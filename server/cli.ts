// Usage: node packages/design-review/server/cli.ts --port 3000 --target 3001
//          --root docs/review -- <app command…>
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { createReviewServer } from "./server.ts"
import { createShellBuild } from "./shellBuild.ts"
import { Storage } from "./storage.ts"

type Args = { port: number; target: number; root: string; command: string[] }

export function parseArgs(argv: string[]): Args {
  const sep = argv.indexOf("--")
  const flags = sep === -1 ? argv : argv.slice(0, sep)
  const command = sep === -1 ? [] : argv.slice(sep + 1)
  const values: Record<string, string> = {}
  for (let i = 0; i < flags.length; i += 2) {
    const name = flags[i]
    const value = flags[i + 1]
    if (!["--port", "--target", "--root"].includes(name) || value === undefined) {
      throw new Error(`Unexpected argument ${name}`)
    }
    values[name.slice(2)] = value
  }
  const port = Number(values.port)
  const target = Number(values.target)
  if (!Number.isInteger(port) || !Number.isInteger(target) || !values.root || !command.length) {
    throw new Error("Usage: cli.ts --port <n> --target <n> --root <dir> -- <app command…>")
  }
  return { port, target, root: values.root, command }
}

// Next prints "✓ Ready in 1.2s" once it serves; colour codes are stripped first.
export function isReadyOutput(text: string): boolean {
  return /\bReady in\b/.test(text.replace(/\x1b\[[0-9;]*m/g, ""))
}

function main() {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error((err as Error).message)
    process.exit(2)
  }
  const root = path.resolve(process.cwd(), args.root)
  mkdirSync(root, { recursive: true })

  // Own process group, so the whole tree (npx → next) is signalled at once.
  // stdout is piped so the review URL can follow the app's "Ready" line,
  // which would otherwise leave the app's own port as the last URL shown.
  const child = spawn(args.command[0], args.command.slice(1), {
    stdio: ["inherit", "pipe", "inherit"],
    detached: true,
    env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" },
  })
  let announced = false
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk)
    if (!announced && isReadyOutput(chunk.toString())) {
      announced = true
      console.log(`\n[design-review] Open http://localhost:${args.port} (not :${args.target})\n`)
    }
  })
  const killChild = (signal: NodeJS.Signals = "SIGTERM") => {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
    try {
      process.kill(-child.pid, signal)
    } catch {
      // Already gone.
    }
  }

  const shell = createShellBuild()
  const server = createReviewServer({
    targetPort: args.target,
    storage: new Storage(root),
    shellAssets: () => shell.assets(),
  })
  server.on("error", (err) => {
    console.error(`[design-review] ${err.message}`)
    killChild()
    process.exit(1)
  })
  server.listen(args.port, "localhost", () => {
    console.log(
      `[design-review] http://localhost:${args.port} → app on :${args.target}, review files in ${root}`
    )
  })

  child.on("exit", (code, signal) => {
    console.log(`[design-review] app command exited (${signal ?? code})`)
    process.exit(code ?? 1)
  })
  child.on("error", (err) => {
    console.error(`[design-review] cannot start ${args.command[0]}: ${err.message}`)
    process.exit(1)
  })
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      killChild(signal)
      process.exit(0)
    })
  }
  process.on("exit", () => killChild())
}

if (import.meta.main) main()
