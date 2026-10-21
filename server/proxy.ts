import http from "node:http"
import net from "node:net"
import type { Duplex } from "node:stream"

const TARGET_HOST = "localhost"

// Streams one HTTP request to the target and its response back, untouched:
// no buffering, no decompression, the `host` header as received (Next's
// dev-origin check must see the address the browser used).
export function proxyRequest(
  targetPort: number,
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const upstream = http.request(
    {
      host: TARGET_HOST,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, upRes.rawHeaders)
      upRes.pipe(res)
      upRes.on("error", () => res.destroy())
    }
  )
  upstream.on("error", (err) => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    const refused = (err as NodeJS.ErrnoException).code === "ECONNREFUSED"
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
    res.end(refused ? "App dev server not ready\n" : `Proxy error: ${err.message}\n`)
  })
  req.on("aborted", () => upstream.destroy())
  res.on("close", () => {
    if (!res.writableFinished) upstream.destroy()
  })
  req.pipe(upstream)
}

// Pipes an upgrade (HMR websocket) raw to the target: the request head is
// replayed byte-for-byte and both sockets are then joined.
export function proxyUpgrade(
  targetPort: number,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  track: (s: Duplex) => void
) {
  const upstream = net.connect(targetPort, TARGET_HOST)
  track(upstream)
  track(socket)
  const fail = () => {
    upstream.destroy()
    socket.destroy()
  }
  upstream.on("error", fail)
  socket.on("error", fail)
  upstream.on("connect", () => {
    let headText = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      headText += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
    }
    upstream.write(headText + "\r\n")
    if (head.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
}
