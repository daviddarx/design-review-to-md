// Usage: node packages/design-review/server/cli.ts [--port <n>] [--target <n>]
//          --root docs/review -- <app command…, {target} for the app's port>
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { createReviewServer } from "./server.ts"
import { createShellBuild } from "./shellBuild.ts"
import { Storage } from "./storage.ts"

// Without --port/--target the ports are the checkout's own (see portsFor).
type Args = { port?: number; target?: number; root: string; command: string[] }

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
  const port = values.port === undefined ? undefined : Number(values.port)
  const target = values.target === undefined ? undefined : Number(values.target)
  const valid = (n: number | undefined) => n === undefined || Number.isInteger(n)
  if (!valid(port) || !valid(target) || !values.root || !command.length) {
    throw new Error("Usage: cli.ts [--port <n>] [--target <n>] --root <dir> -- <app command…>")
  }
  return { port, target, root: values.root, command }
}

// Each checkout (every worktree) gets its own pair of ports, derived from
// its path so they stay the same from run to run: the review server on an
// even port in 4100–4898, the app on the next one. Clear of `next dev`'s
// 3000/3001 and of worktrunk's per-branch ports (10000+).
export const PORT_BASE = 4100
export const PORT_PAIRS = 400

export function portsFor(dir: string, step = 0): { port: number; target: number } {
  let hash = 0x811c9dc5 // FNV-1a
  for (const ch of dir) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0
  const port = PORT_BASE + ((hash + step) % PORT_PAIRS) * 2
  return { port, target: port + 1 }
}

// The app command names its port as {target}.
export function withTarget(command: string[], target: number): string[] {
  return command.map((arg) => arg.replaceAll("{target}", String(target)))
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once("error", () => resolve(false))
    probe.listen(port, () => probe.close(() => resolve(true)))
  })
}

// The checkout's pair, or the next free one when something else holds it.
async function pickPorts(args: Args): Promise<{ port: number; target: number }> {
  if (args.port !== undefined && args.target !== undefined) {
    return { port: args.port, target: args.target }
  }
  for (let step = 0; step < PORT_PAIRS; step++) {
    const auto = portsFor(process.cwd(), step)
    const pair = { port: args.port ?? auto.port, target: args.target ?? auto.target }
    if ((await isFree(pair.port)) && (await isFree(pair.target))) return pair
  }
  throw new Error("No free pair of ports")
}

// Next prints "✓ Ready in 1.2s" once it serves; colour codes are stripped first.
export function isReadyOutput(text: string): boolean {
  return /\bReady in\b/.test(text.replace(/\x1b\[[0-9;]*m/g, ""))
}

async function main() {
  let parsed: Args
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error((err as Error).message)
    process.exit(2)
  }
  const ports = await pickPorts(parsed).catch((err: Error) => {
    console.error(`[design-review] ${err.message}`)
    process.exit(1)
  })
  const args = { ...parsed, ...ports }
  args.command = withTarget(args.command, args.target)
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
      console.log(`\n[design-review] Open http://localhost:${args.port}\n`)
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

if (import.meta.main) void main()
