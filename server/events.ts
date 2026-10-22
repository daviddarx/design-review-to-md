import { existsSync, watch, type FSWatcher } from "node:fs"
import type http from "node:http"
import path from "node:path"

const DEBOUNCE_MS = 100
const KEEPALIVE_MS = 25_000

// The review folder a watched path belongs to (its first segment), or null for a path
// through any dot-file — storage's `.tmp-*` atomic writes, `.DS_Store`.
export function reviewOf(relative: string): string | null {
  const parts = relative.split(/[\\/]/).filter(Boolean)
  if (!parts.length || parts.some((p) => p.startsWith("."))) return null
  return parts[0]
}

// SSE change feed: one `data: {"review": …}` per changed review, debounced.
export function createChangeFeed(root: string) {
  const clients = new Set<http.ServerResponse>()
  const pending = new Set<string>()
  let timer: NodeJS.Timeout | undefined

  const flush = () => {
    timer = undefined
    for (const review of pending) {
      const msg = `data: ${JSON.stringify({ review })}\n\n`
      for (const res of clients) res.write(msg)
    }
    pending.clear()
  }

  let watcher: FSWatcher | undefined
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      const review = filename ? reviewOf(filename.toString()) : null
      if (!review) return
      // macOS reports a change to the watched folder itself under its own
      // basename; that is not a review unless one really has that name.
      if (review === path.basename(root) && !existsSync(path.join(root, review))) return
      pending.add(review)
      timer ??= setTimeout(flush, DEBOUNCE_MS)
    })
    watcher.on("error", (err) => console.error(`[design-review] watch error: ${err.message}`))
  } catch (err) {
    console.error(`[design-review] cannot watch ${path.resolve(root)}: ${(err as Error).message}`)
  }

  const keepAlive = setInterval(() => {
    for (const res of clients) res.write(": ping\n\n")
  }, KEEPALIVE_MS)
  keepAlive.unref()

  return {
    handle(req: http.IncomingMessage, res: http.ServerResponse) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      res.write(": connected\n\n")
      clients.add(res)
      req.on("close", () => clients.delete(res))
    },
    close() {
      watcher?.close()
      clearInterval(keepAlive)
      if (timer) clearTimeout(timer)
      for (const res of clients) res.end()
      clients.clear()
    },
  }
}
