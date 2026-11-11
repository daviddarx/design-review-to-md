import http from "node:http"
import net, { type AddressInfo } from "node:net"
import type { Duplex } from "node:stream"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CookieJar } from "./cookieJar.ts"
import {
  SESSION_EXPIRED_HTML,
  proxyRemoteRequest,
  proxyRemoteUpgrade,
  type RemoteTarget,
} from "./remoteProxy.ts"

const LOGIN = "https://login.microsoftonline.com/common/oauth2/authorize?x=1"

let upstream: http.Server
let front: http.Server
let target: RemoteTarget
let refreshes: number
let seen: http.IncomingHttpHeaders

const listen = (s: http.Server) =>
  new Promise<number>((resolve) =>
    s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port))
  )

beforeEach(async () => {
  upstream = http.createServer((req, res) => {
    seen = req.headers
    const origin = `http://${req.headers.host}`
    if (req.url === "/csp") {
      res.writeHead(200, {
        "content-security-policy": "upgrade-insecure-requests",
        "content-security-policy-report-only": "default-src 'self'",
      })
    } else if (req.url === "/moved") {
      res.writeHead(302, { location: `${origin}/next?q=1` })
    } else if (req.url === "/login") {
      res.writeHead(302, { location: LOGIN })
    } else if (req.url === "/set") {
      res.writeHead(200, { "set-cookie": "a=1; Domain=127.0.0.1; Path=/" })
    } else {
      res.writeHead(200, { "content-type": "text/plain" })
    }
    res.end("body")
  })
  const upPort = await listen(upstream)
  refreshes = 0
  target = {
    origin: new URL(`http://127.0.0.1:${upPort}`),
    jar: new CookieJar([
      { name: "jar", value: "j", domain: "127.0.0.1", path: "/", secure: true, hostOnly: true },
      {
        name: "both",
        value: "fromJar",
        domain: "127.0.0.1",
        path: "/",
        secure: false,
        hostOnly: true,
      },
    ]),
    refresh: async () => {
      refreshes++
    },
    stale: false,
  }
  front = http.createServer((req, res) => proxyRemoteRequest(target, req, res))
  frontPort = await listen(front)
})

let frontPort: number

afterEach(async () => {
  await new Promise((r) => front.close(r))
  await new Promise((r) => upstream.close(r))
})

function get(path: string, headers: http.OutgoingHttpHeaders = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: frontPort, path, headers }, (res) => {
        let body = ""
        res.setEncoding("utf8")
        res.on("data", (c) => (body += c))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
      })
      req.on("error", reject)
      req.end()
    }
  )
}

describe("proxyRemoteRequest", () => {
  it("rewrites host and origin, and merges the jar's cookies with the browser's", async () => {
    const res = await get("/x", {
      origin: `http://127.0.0.1:${frontPort}`,
      referer: `http://127.0.0.1:${frontPort}/page?a=1`,
      cookie: "both=fromBrowser; mine=m",
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe("body")
    expect(seen.host).toBe(target.origin.host)
    expect(seen.origin).toBe(target.origin.origin)
    expect(seen.referer).toBe(`${target.origin.origin}/page?a=1`)
    const sent = seen.cookie!.split("; ").sort()
    expect(sent).toEqual(["both=fromBrowser", "jar=j", "mine=m"])
  })

  it("drops the CSP headers", async () => {
    const res = await get("/csp")
    expect(res.headers["content-security-policy"]).toBeUndefined()
    expect(res.headers["content-security-policy-report-only"]).toBeUndefined()
  })

  it("makes a location to the upstream relative", async () => {
    const res = await get("/moved")
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe("/next?q=1")
  })

  it("answers a document redirected to another host with the expired page, then refreshes once", async () => {
    const res = await get("/login", { "sec-fetch-dest": "iframe" })
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toMatch(/^text\/html/)
    expect(res.body).toBe(SESSION_EXPIRED_HTML(target.origin.host))
    expect(res.body).toContain(
      `Session expired: log in to ${target.origin.host} in Chrome, then reload.`
    )
    expect(target.stale).toBe(true)
    expect(refreshes).toBe(0)

    expect((await get("/ok", { "sec-fetch-dest": "iframe" })).status).toBe(200)
    expect(refreshes).toBe(1)
    expect(target.stale).toBe(false)
    await get("/ok", { "sec-fetch-dest": "document" })
    expect(refreshes).toBe(1)
  })

  it("passes the same redirect through for a fetch", async () => {
    const res = await get("/login")
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe(LOGIN)
    expect(target.stale).toBe(false)
  })

  it("stores set-cookie in the jar and passes it on without Domain", async () => {
    const res = await get("/set")
    expect(res.headers["set-cookie"]).toEqual(["a=1; Path=/"])
    expect(target.jar.header("127.0.0.1", "/")).toContain("a=1")
  })

  it("answers 502 when the upstream is down", async () => {
    target.origin = new URL("http://127.0.0.1:1")
    const res = await get("/x")
    expect(res.status).toBe(502)
  })
})

describe("proxyRemoteUpgrade", () => {
  it("replays the head with host and cookie rewritten, then joins the sockets", async () => {
    const raw = net.createServer((s) => {
      let head = ""
      s.on("data", (c) => {
        head += c.toString()
        if (head.includes("\r\n\r\n"))
          s.end(
            `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nx-head: ${encodeURIComponent(head)}\r\n\r\n`
          )
      })
    })
    const rawPort = await new Promise<number>((r) =>
      raw.listen(0, "127.0.0.1", () => r((raw.address() as AddressInfo).port))
    )
    target.origin = new URL(`http://127.0.0.1:${rawPort}`)
    const sockets: Duplex[] = []
    front.on("upgrade", (req, socket, head) =>
      proxyRemoteUpgrade(target, req, socket, head, (s) => sockets.push(s))
    )
    const head = await new Promise<string>((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: frontPort,
        path: "/ws",
        headers: { connection: "Upgrade", upgrade: "websocket", cookie: "mine=m" },
      })
      req.on("upgrade", (res, socket) => {
        socket.destroy()
        resolve(decodeURIComponent(String(res.headers["x-head"])))
      })
      req.on("error", reject)
      req.end()
    })
    await new Promise((r) => raw.close(r))
    expect(head).toMatch(/^GET \/ws HTTP\/1\.1\r\n/)
    expect(head).toContain(`host: 127.0.0.1:${rawPort}\r\n`)
    expect(head).toContain("cookie: jar=j; both=fromJar; mine=m\r\n")
    expect(sockets).toHaveLength(2)
  })
})
