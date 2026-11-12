// Usage: node <this package>/server/cli.ts [--port <n>] [--target <n>] [--markers <a,b>]
//          --root docs/review -- <app command…, {target} for the app's port>
//        node <this package>/server/cli.ts --remote [--url <url>] [--markers <a,b>]
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import readline from "node:readline/promises"
import { loadChromeCookies } from "./remote/chromeCookies.ts"
import { CookieJar } from "./remote/cookieJar.ts"
import type { RemoteTarget } from "./remote/remoteProxy.ts"
import { chooseRound, REMOTE_BASE, remotePort, urlKey } from "./remote/rounds.ts"
import { createReviewServer } from "./server.ts"
import { createShellBuild } from "./shellBuild.ts"
import { Storage } from "./storage.ts"

// Without --port/--target the ports are the checkout's own (see portsFor).
// --markers: comma-separated attributes the picker anchors on first, e.g.
// `data-testid,data-tour-id`.
type Args = { port?: number; target?: number; root: string; markers: string[]; command: string[] }
// --remote: review a deployed site at --url (asked for when missing).
type RemoteArgs = { remote: true; url?: string; markers: string[] }

function parseMarkers(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)
}

function parseRemoteArgs(argv: string[]): RemoteArgs {
  const values: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]
    const value = argv[i + 1]
    if (!["--url", "--markers"].includes(name) || value === undefined) {
      throw new Error("Usage: cli.ts --remote [--url <url>] [--markers <a,b>]")
    }
    values[name.slice(2)] = value
  }
  const markers = parseMarkers(values.markers)
  return values.url === undefined
    ? { remote: true, markers }
    : { remote: true, url: values.url, markers }
}

export function parseArgs(argv: string[]): Args | RemoteArgs {
  const sep = argv.indexOf("--")
  // Only a flag of ours: an app command after `--` may take its own --remote.
  const remote = argv.indexOf("--remote")
  if (remote !== -1 && (sep === -1 || remote < sep)) {
    return parseRemoteArgs(argv.toSpliced(remote, 1))
  }
  const flags = sep === -1 ? argv : argv.slice(0, sep)
  const command = sep === -1 ? [] : argv.slice(sep + 1)
  const values: Record<string, string> = {}
  for (let i = 0; i < flags.length; i += 2) {
    const name = flags[i]
    const value = flags[i + 1]
    if (!["--port", "--target", "--root", "--markers"].includes(name) || value === undefined) {
      throw new Error(`Unexpected argument ${name}`)
    }
    values[name.slice(2)] = value
  }
  const port = values.port === undefined ? undefined : Number(values.port)
  const target = values.target === undefined ? undefined : Number(values.target)
  const valid = (n: number | undefined) => n === undefined || Number.isInteger(n)
  if (!valid(port) || !valid(target) || !values.root || !command.length) {
    throw new Error(
      "Usage: cli.ts [--port <n>] [--target <n>] [--markers <a,b>] --root <dir> -- <app command…>"
    )
  }
  const markers = parseMarkers(values.markers)
  return { port, target, root: values.root, markers, command }
}

// Each checkout (every worktree) gets its own pair of ports, derived from
// its path so they stay the same from run to run: the review server on an
// even port in 4100–4898, the app on the next one. Clear of `next dev`'s
// 3000/3001 and of worktrunk's per-branch ports (10000+).
export const PORT_BASE = 4100
export const PORT_PAIRS = 400

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (const ch of text) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0
  return hash
}

export function portsFor(dir: string, step = 0): { port: number; target: number } {
  const hash = fnv1a(dir)
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
  return /\bready in\b/i.test(text.replace(/\x1b\[[0-9;]*m/g, ""))
}

async function main() {
  let parsed: Args | RemoteArgs
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error((err as Error).message)
    process.exit(2)
  }
  if ("remote" in parsed) return remoteMain(parsed)
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
    markers: args.markers,
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

function fail(message: string): never {
  console.error(`[design-review] ${message}`)
  process.exit(1)
}

// Reviews a deployed site: no app to start, the proxy's target is the remote
// origin, with the cookies of his Chrome login. Reviews go to rounds on the
// Desktop (server/remote/rounds.ts).
async function remoteMain(args: RemoteArgs) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string) => rl.question(q)
  // Ctrl+C at a prompt: readline would otherwise just close the interface.
  rl.on("SIGINT", () => process.exit(130))

  const raw = args.url ?? (await ask("URL to review: ")).trim()
  const url = URL.parse(raw)
  if (!url || !["https:", "http:"].includes(url.protocol)) {
    rl.close()
    fail(`Not an http(s) URL: ${raw}`)
  }
  const host = url.hostname

  console.log(
    '[design-review] macOS may ask to let node read "Chrome Safe Storage" — choose Always Allow.'
  )
  let profile = ""
  const pickProfile = async (names: string[]) => {
    const list = names.map((n, i) => `${i + 1}) ${n}`).join(" ")
    const answer = await ask(
      `Several Chrome profiles have cookies for ${host}: ${list} Which one? `
    )
    return names[Number(answer.trim()) - 1] ?? answer.trim()
  }
  const key = urlKey(url.href)
  let cookies
  let round
  try {
    cookies = await loadChromeCookies(host, pickProfile, (name) => (profile = name))
    round = await chooseRound(REMOTE_BASE, key, ask)
  } catch (err) {
    rl.close()
    fail((err as Error).message)
  }
  // Closed before listening: an open interface would swallow Ctrl+C.
  rl.close()

  const port = remotePort(key)
  if (!(await isFree(port))) fail(`Port ${port} for ${host} is taken — close what holds it`)

  const jar = new CookieJar(cookies)
  const target: RemoteTarget = {
    origin: new URL(url.origin),
    jar,
    // The profile chosen at startup, without asking again.
    refresh: async () => {
      jar.replace(await loadChromeCookies(host, async () => profile))
    },
    stale: false,
  }
  const shell = createShellBuild()
  const server = createReviewServer({
    targetPort: 0,
    storage: new Storage(REMOTE_BASE, { stateRoot: path.join(REMOTE_BASE, ".state") }),
    shellAssets: () => shell.assets(),
    markers: args.markers,
    remote: { target, url: url.href, round },
  })
  server.on("error", (err) => fail(err.message))
  server.listen(port, "localhost", () => {
    console.log(`[design-review] Round ${round} in ${REMOTE_BASE}`)
    console.log(`\n[design-review] Open http://localhost:${port}${url.pathname}${url.search}\n`)
  })
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0))
}

if (import.meta.main) void main()
