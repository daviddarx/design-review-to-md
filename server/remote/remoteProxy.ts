import http from "node:http"
import https from "node:https"
import net from "node:net"
import type { Duplex } from "node:stream"
import tls from "node:tls"
import type { CookieJar } from "./cookieJar.ts"

export type RemoteTarget = {
  origin: URL
  jar: CookieJar
  // Re-reads the site's cookies from Chrome into the jar.
  refresh: () => Promise<void>
  // Set when a document was redirected to a login; the next one refreshes.
  stale: boolean
}

export const SESSION_EXPIRED_HTML = (host: string) =>
  `<!doctype html><meta charset="utf-8"><title>Session expired</title>` +
  `<p style="font:14px system-ui;margin:2em">Session expired: log in to ${escapeHtml(host)} in Chrome, then reload.</p>\n`

// Streams one request to the remote origin and its response back. Bodies pass
// untouched; only the headers that tie the page to its real origin change.
export function proxyRemoteRequest(
  target: RemoteTarget,
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const isDocument = ["iframe", "document"].includes(String(req.headers["sec-fetch-dest"]))
  const send = () => {
    const { origin } = target
    const { pathname } = new URL(req.url ?? "/", origin)
    const upstream = (origin.protocol === "https:" ? https : http).request(
      {
        host: origin.hostname,
        port: portOf(origin),
        method: req.method,
        path: req.url,
        headers: requestHeaders(target, req),
      },
      (upRes) => {
        const location = upRes.headers.location
        if (
          isDocument &&
          location &&
          (upRes.statusCode ?? 0) >= 300 &&
          (upRes.statusCode ?? 0) < 400 &&
          (URL.parse(location, origin)?.host ?? origin.host) !== origin.host
        ) {
          // A login redirect: following it in the frame would leave the proxy.
          const setCookie = upRes.headers["set-cookie"]
          if (setCookie) target.jar.store(origin.hostname, setCookie, pathname)
          upRes.resume()
          target.stale = true
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
          res.end(SESSION_EXPIRED_HTML(origin.host))
          return
        }
        const setCookie = upRes.headers["set-cookie"]
        if (setCookie) target.jar.store(origin.hostname, setCookie, pathname)
        res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, responseHeaders(target, upRes))
        upRes.pipe(res)
        upRes.on("error", () => res.destroy())
      }
    )
    upstream.on("error", (err) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
      res.end(`Proxy error: ${err.message}\n`)
    })
    req.on("aborted", () => upstream.destroy())
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy()
    })
    req.pipe(upstream)
  }
  if (isDocument && target.stale) {
    // He has logged in again in Chrome (or not): pick up its cookies first.
    refreshOnce(target).finally(() => {
      if (!res.destroyed) send()
    })
  } else {
    send()
  }
}

const refreshing = new WeakMap<RemoteTarget, Promise<void>>()

// Documents that arrive together while stale share one refresh.
function refreshOnce(target: RemoteTarget) {
  let pending = refreshing.get(target)
  if (!pending) {
    pending = target
      .refresh()
      .then(() => {
        target.stale = false
      })
      // Still stale on failure: the next document tries again.
      .catch(() => {})
      .finally(() => refreshing.delete(target))
    refreshing.set(target, pending)
  }
  return pending
}

// Pipes an upgrade (websocket) to the remote origin: the request head is
// replayed with the rewritten headers and both sockets are then joined.
export function proxyRemoteUpgrade(
  target: RemoteTarget,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  track: (s: Duplex) => void
) {
  const { origin } = target
  const onConnect = () => {
    let headText = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
    for (const [name, value] of Object.entries(requestHeaders(target, req))) {
      for (const v of Array.isArray(value) ? value : [value]) headText += `${name}: ${v}\r\n`
    }
    upstream.write(headText + "\r\n")
    if (head.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  }
  const upstream =
    origin.protocol === "https:"
      ? tls.connect(
          { host: origin.hostname, port: portOf(origin), servername: origin.hostname },
          onConnect
        )
      : net.connect(portOf(origin), origin.hostname, onConnect)
  track(upstream)
  track(socket)
  const fail = () => {
    upstream.destroy()
    socket.destroy()
  }
  upstream.on("error", fail)
  socket.on("error", fail)
}

function portOf(origin: URL) {
  return Number(origin.port) || (origin.protocol === "https:" ? 443 : 80)
}

function requestHeaders(target: RemoteTarget, req: http.IncomingMessage) {
  const { origin } = target
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: origin.host }
  const local = `http://${req.headers.host}`
  for (const name of ["origin", "referer"]) {
    const value = req.headers[name]
    if (typeof value === "string" && value.startsWith(local)) {
      headers[name] = origin.origin + value.slice(local.length)
    }
  }
  const path = new URL(req.url ?? "/", origin).pathname
  const cookie = mergeCookies(target.jar.header(origin.hostname, path), req.headers.cookie ?? "")
  if (cookie) headers.cookie = cookie
  else delete headers.cookie
  return headers
}

// The jar's cookies plus the browser's; the jar wins on the same name, since
// the browser's localhost copy may predate a refresh from Chrome.
function mergeCookies(jar: string, browser: string) {
  const nameOf = (pair: string) => pair.split("=")[0].trim()
  const fromJar = jar.split("; ").filter(Boolean)
  const names = new Set(fromJar.map(nameOf))
  const fromBrowser = browser
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && !names.has(nameOf(p)))
  return [...fromJar, ...fromBrowser].join("; ")
}

function responseHeaders(target: RemoteTarget, upRes: http.IncomingMessage) {
  const prefix = target.origin.origin
  const out: string[] = []
  for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
    const name = upRes.rawHeaders[i]
    let value = upRes.rawHeaders[i + 1]
    const lower = name.toLowerCase()
    // upgrade-insecure-requests would send the page to https://localhost, and
    // connect-src would refuse the localhost origin.
    if (lower === "content-security-policy" || lower === "content-security-policy-report-only") {
      continue
    }
    if (lower === "location" && startsWithOrigin(value, prefix)) {
      const url = new URL(value)
      value = url.pathname + url.search + url.hash
    }
    // The browser keeps it for localhost; Secure stays (Chrome allows it there).
    // HttpOnly ones stay in the jar only: page scripts can't read them anyway,
    // and real session tokens don't land in Chrome's localhost cookies.
    if (lower === "set-cookie") {
      if (value.split(";").some((part) => /^\s*httponly\s*$/i.test(part))) continue
      value = value
        .split(";")
        .filter((part) => !/^\s*domain\s*=/i.test(part))
        .join(";")
    }
    out.push(name, value)
  }
  return out
}

function startsWithOrigin(value: string, prefix: string) {
  return value.startsWith(prefix) && /^($|[/?#])/.test(value.slice(prefix.length))
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
}
