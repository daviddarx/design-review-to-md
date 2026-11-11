import { spawn } from "node:child_process"
import http from "node:http"
import { mkdirSync } from "node:fs"
import type { Duplex } from "node:stream"
import { handleApi, handleFile, HttpError, sendError } from "./api.ts"
import { createChangeFeed } from "./events.ts"
import { createSourceResolver } from "./findFiles.ts"
import { proxyRequest, proxyUpgrade } from "./proxy.ts"
import { proxyRemoteRequest, proxyRemoteUpgrade, type RemoteTarget } from "./remote/remoteProxy.ts"
import type { Storage } from "./storage.ts"

export type ReviewServerOptions = {
  targetPort: number
  storage: Storage
  shellAssets: () => Promise<{ js: string; css: string }>
  repoRoot?: string // open-editor confinement and source search; defaults to process.cwd()
  markers: string[] // attributes the picker anchors on first (--markers)
  // Review a deployed site: everything not ours goes to `target` (targetPort
  // is ignored), and there is no local source to open or search.
  remote?: { target: RemoteTarget; url: string; round: string }
  openFolder?: (dir: string) => void // shows a finalized round; tests stub it
}

// Finder, so he can check the hand-over and zip it.
function openInFinder(dir: string) {
  spawn("open", [dir], { detached: true, stdio: "ignore" }).unref()
}

const TOOL_PREFIX = "/__review/"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

// The tool's routes answer only to a loopback Host: a DNS-rebound name
// pointing at this port is refused (the proxied app is not ours to guard).
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false
  try {
    return LOCAL_HOSTS.has(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

// The shell's settings ride in the document itself (shell/config.ts reads
// them), so they are there before the first pick. `<` is escaped so a value
// cannot close the script element.
export function shellHtml(markers: string[], remote?: { url: string; round: string }): string {
  const config = JSON.stringify({ markers, remote }).replace(/</g, "\\u003c")
  return SHELL_HTML.replace(
    "<body>\n",
    `<body>\n<script id="dr-config" type="application/json">${config}</script>\n`
  )
}

const SHELL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design review</title>
<link rel="stylesheet" href="/__review/shell.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/__review/shell.js"></script>
</body>
</html>
`

// The remote proxy adds his real session cookies, so in remote mode another
// site (or a DNS-rebound name) must not reach the remote through it.
function remoteRequestRefused(req: http.IncomingMessage): boolean {
  const site = req.headers["sec-fetch-site"]
  return (
    !isLocalHost(req.headers.host) ||
    (site !== undefined && site !== "same-origin" && site !== "none")
  )
}

function remoteUpgradeRefused(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin
  return (
    !isLocalHost(req.headers.host) ||
    (origin !== undefined && origin !== `http://${req.headers.host}`)
  )
}

const FORBIDDEN_UPGRADE = "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"

export function createReviewServer(opts: ReviewServerOptions): http.Server {
  const { targetPort, storage, shellAssets } = opts
  const repoRoot = opts.repoRoot ?? process.cwd()
  const { remote } = opts
  const ctx = {
    storage,
    repoRoot,
    resolveSource: createSourceResolver(repoRoot),
    remote: remote && {
      url: remote.url,
      round: remote.round,
      openFolder: opts.openFolder ?? openInFinder,
    },
  }
  const html = shellHtml(opts.markers, remote && { url: remote.url, round: remote.round })
  mkdirSync(storage.root, { recursive: true })
  const feed = createChangeFeed(storage.root)
  const tunnels = new Set<Duplex>()

  async function tool(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
    const parts = pathname.slice(TOOL_PREFIX.length).split("/").filter(Boolean)
    const [area, ...rest] = parts
    const method = req.method ?? "GET"
    if (area === "api") return handleApi(req, res, rest, ctx)
    if (method !== "GET") throw new HttpError(404, "Not found")
    if (area === "events" && !rest.length) return feed.handle(req, res)
    if (area === "files") return handleFile(res, rest, ctx)
    if (area === "shell.js" || area === "shell.css") {
      const assets = await shellAssets()
      const js = area === "shell.js"
      res.writeHead(200, {
        "content-type": js ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8",
        "cache-control": "no-cache",
      })
      return res.end(js ? assets.js : assets.css)
    }
    throw new HttpError(404, "Not found")
  }

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0]
    if (pathname.startsWith(TOOL_PREFIX)) {
      if (!isLocalHost(req.headers.host)) {
        sendError(res, new HttpError(403, "The review tool only answers on localhost"))
        return
      }
      tool(req, res, pathname).catch((err) => sendError(res, err))
      return
    }
    if (req.method === "GET" && req.headers["sec-fetch-dest"] === "document") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      })
      res.end(html)
      return
    }
    if (!remote) return proxyRequest(targetPort, req, res)
    if (remoteRequestRefused(req)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" })
      res.end("Refused: the remote review only answers its own localhost pages\n")
      return
    }
    proxyRemoteRequest(remote.target, req, res)
  })

  server.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").startsWith(TOOL_PREFIX)) {
      if (!isLocalHost(req.headers.host)) {
        socket.end(FORBIDDEN_UPGRADE)
      } else {
        socket.destroy()
      }
      return
    }
    const track = (s: Duplex) => {
      tunnels.add(s)
      s.on("close", () => tunnels.delete(s))
    }
    if (!remote) return proxyUpgrade(targetPort, req, socket, head, track)
    if (remoteUpgradeRefused(req)) {
      socket.end(FORBIDDEN_UPGRADE)
      return
    }
    proxyRemoteUpgrade(remote.target, req, socket, head, track)
  })

  // Close the watcher, the SSE streams and any websocket tunnel with the
  // server, or `close()` would wait on them forever.
  const close = server.close.bind(server)
  server.close = ((cb?: (err?: Error) => void) => {
    feed.close()
    for (const s of tunnels) s.destroy()
    return close(cb)
  }) as typeof server.close
  return server
}
