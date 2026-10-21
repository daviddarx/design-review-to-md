import http from "node:http"
import { mkdirSync } from "node:fs"
import type { Duplex } from "node:stream"
import { handleApi, handleFile, HttpError, sendError } from "./api.ts"
import { createChangeFeed } from "./events.ts"
import { proxyRequest, proxyUpgrade } from "./proxy.ts"
import type { Storage } from "./storage.ts"

export type ReviewServerOptions = {
  targetPort: number
  storage: Storage
  shellAssets: () => Promise<{ js: string; css: string }>
  repoRoot?: string // open-editor confinement; defaults to process.cwd()
}

const TOOL_PREFIX = "/__review/"

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

export function createReviewServer(opts: ReviewServerOptions): http.Server {
  const { targetPort, storage, shellAssets } = opts
  const ctx = { storage, repoRoot: opts.repoRoot ?? process.cwd() }
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
      tool(req, res, pathname).catch((err) => sendError(res, err))
      return
    }
    if (req.method === "GET" && req.headers["sec-fetch-dest"] === "document") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      })
      res.end(SHELL_HTML)
      return
    }
    proxyRequest(targetPort, req, res)
  })

  server.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").startsWith(TOOL_PREFIX)) {
      socket.destroy()
      return
    }
    proxyUpgrade(targetPort, req, socket, head, (s) => {
      tunnels.add(s)
      s.on("close", () => tunnels.delete(s))
    })
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
