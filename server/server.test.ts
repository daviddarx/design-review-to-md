import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { promises as fs } from "node:fs"
import http from "node:http"
import type { AddressInfo, Socket } from "node:net"
import os from "node:os"
import path from "node:path"
import { Storage } from "./storage.ts"
import { createReviewServer, isLocalHost } from "./server.ts"
import { resolveEditorTarget } from "./openEditor.ts"
import { createShellBuild } from "./shellBuild.ts"
import { topicOf } from "./events.ts"
import { parseArgs } from "./cli.ts"

let root: string
let upstream: http.Server
let review: http.Server
let base: string

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "localhost", () => resolve((server.address() as AddressInfo).port))
  })
}

function close(server: http.Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve()
  return new Promise((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })
}

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string }

function request(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; json?: unknown } = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...opts.headers }
    let body: string | undefined
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json)
      headers["content-type"] = "application/json"
    }
    // Raw path: a URL string would be normalised ("/a/../b" → "/b") by the client.
    const { hostname, port } = new URL(base)
    const req = http.request({ hostname, port, path: url, method, headers }, (res) => {
      let data = ""
      res.setEncoding("utf8")
      res.on("data", (c) => (data += c))
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: data }))
    })
    req.on("error", reject)
    req.end(body)
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "review-server-"))
  upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain", "x-seen-host": req.headers.host ?? "" })
    res.end(req.url === "/_next/static/a.js" ? "asset" : "app")
  })
  upstream.on("upgrade", (_req, socket: Socket) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n")
    socket.pipe(socket)
  })
  const targetPort = await listen(upstream)
  review = createReviewServer({
    targetPort,
    storage: new Storage(root),
    shellAssets: async () => ({ js: "console.log('shell')", css: "body{}" }),
  })
  base = `http://localhost:${await listen(review)}`
})

afterEach(async () => {
  await close(review)
  await close(upstream)
  await fs.rm(root, { recursive: true, force: true })
})

describe("dispatch", () => {
  it("serves the shell for a top-level document request", async () => {
    const res = await request("GET", "/concept-08-4", {
      headers: { "sec-fetch-dest": "document" },
    })
    expect(res.status).toBe(200)
    expect(res.headers["content-type"]).toMatch(/text\/html/)
    expect(res.body).toMatch(/^<!doctype html>/)
    expect(res.body).toContain('<link rel="stylesheet" href="/__review/shell.css">')
    expect(res.body).toContain('<div id="root"></div>')
    expect(res.body).toContain('<script type="module" src="/__review/shell.js"></script>')
  })

  it("serves the shell assets", async () => {
    const js = await request("GET", "/__review/shell.js")
    expect(js.status).toBe(200)
    expect(js.headers["content-type"]).toMatch(/javascript/)
    expect(js.body).toBe("console.log('shell')")
    const css = await request("GET", "/__review/shell.css")
    expect(css.headers["content-type"]).toMatch(/text\/css/)
    expect(css.body).toBe("body{}")
  })

  it("proxies an iframe document request to the target", async () => {
    const res = await request("GET", "/concept-08-4", {
      headers: { "sec-fetch-dest": "iframe" },
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe("app")
    // The host header is passed through untouched.
    expect(res.headers["x-seen-host"]).toBe(new URL(base).host)
  })

  it("proxies assets", async () => {
    const res = await request("GET", "/_next/static/a.js")
    expect(res.body).toBe("asset")
  })

  it("answers 502 while the target is not listening", async () => {
    await close(upstream)
    const res = await request("GET", "/x", { headers: { "sec-fetch-dest": "iframe" } })
    expect(res.status).toBe(502)
    expect(res.body).toContain("App dev server not ready")
  })

  it("proxies a websocket upgrade", async () => {
    const echoed = await new Promise<string>((resolve, reject) => {
      const req = http.request(base + "/_next/webpack-hmr", {
        headers: { connection: "Upgrade", upgrade: "echo" },
      })
      req.on("upgrade", (_res, socket) => {
        let got = ""
        socket.on("data", (c) => {
          got += c.toString()
          if (got === "ping-pong") {
            socket.destroy()
            resolve(got)
          }
        })
        socket.write("ping-pong")
      })
      req.on("error", reject)
      req.end()
    })
    expect(echoed).toBe("ping-pong")
  })

  it("refuses tool routes unless the Host is loopback; the app is still proxied", async () => {
    const { port } = new URL(base)
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, "localhost"]) {
      const res = await request("GET", "/__review/shell.js", { headers: { host } })
      expect(res.status, host).toBe(200)
    }
    for (const host of ["evil.example", `evil.example:${port}`, "localhost.evil.example"]) {
      const res = await request("GET", "/__review/api/topics", { headers: { host } })
      expect(res.status, host).toBe(403)
    }
    expect(isLocalHost(undefined)).toBe(false)
    expect(isLocalHost("")).toBe(false)
    const app = await request("GET", "/x", {
      headers: { host: "evil.example", "sec-fetch-dest": "iframe" },
    })
    expect(app.status).toBe(200)
    expect(app.body).toBe("app")
  })

  it("refuses a tool upgrade from a foreign Host with 403", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = http.request(base + "/__review/events", {
        headers: { connection: "Upgrade", upgrade: "echo", host: "evil.example" },
      })
      req.on("response", (res) => {
        res.resume()
        resolve(res.statusCode)
      })
      req.on("upgrade", () => resolve(101))
      req.on("error", reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it("answers 404 for an unknown tool route", async () => {
    expect((await request("GET", "/__review/nope")).status).toBe(404)
  })
})

describe("api", () => {
  it("topic routes round-trip", async () => {
    const created = await request("POST", "/__review/api/topics", { json: { name: "my topic" } })
    expect(created.status).toBe(200)
    expect(JSON.parse(created.body)).toEqual({ name: "my-topic" })

    const list = await request("GET", "/__review/api/topics")
    expect(JSON.parse(list.body)).toEqual(["my-topic"])

    const point = await request("POST", "/__review/api/topics/my-topic/points", {
      json: {
        title: "Header spacing",
        rows: [{ text: "Too tight", children: [] }],
        assets: [
          { rowId: "$0", name: "note.txt", dataBase64: Buffer.from("hi").toString("base64") },
        ],
      },
    })
    expect(point.status).toBe(200)
    expect(JSON.parse(point.body)).toEqual({ number: 1, rowIds: ["1.a"] })

    const topic = JSON.parse((await request("GET", "/__review/api/topics/my-topic")).body)
    expect(topic.meta).toEqual({ nextPoint: 2, retired: [] })
    expect(topic.points).toHaveLength(1)
    expect(topic.points[0]).toMatchObject({
      number: 1,
      title: "Header spacing",
      folder: "01-header-spacing",
    })
    expect(topic.points[0].rows[0]).toMatchObject({ label: "a", text: "Too tight" })

    const file = await request("GET", "/__review/files/my-topic/01-header-spacing/1.a-note.txt")
    expect(file.status).toBe(200)
    expect(file.body).toBe("hi")

    const op = await request("POST", "/__review/api/topics/my-topic/points/1/ops", {
      json: { op: { kind: "setStatus", rowId: "1.a", status: "done" }, assets: [] },
    })
    expect(op.status).toBe(200)
    expect(JSON.parse(op.body).point.rows[0].status).toBe("done")

    const del = await request("DELETE", "/__review/api/topics/my-topic/points/1")
    expect(del.status).toBe(200)
    const after = JSON.parse((await request("GET", "/__review/api/topics/my-topic")).body)
    expect(after.points).toEqual([])
    expect(after.meta.retired).toEqual(["1"])
  })

  it("maps storage errors to their status and never crashes", async () => {
    expect((await request("GET", "/__review/api/topics/missing")).status).toBe(404)
    expect((await request("POST", "/__review/api/topics", { json: { name: "../x" } })).status).toBe(
      400
    )
    await request("POST", "/__review/api/topics", { json: { name: "t" } })
    const dup = await request("POST", "/__review/api/topics", { json: { name: "t" } })
    expect(dup.status).toBe(409)
    expect(JSON.parse(dup.body).error).toBeTruthy()
    const bad = await request("POST", "/__review/api/topics", {
      headers: { "content-type": "application/json" },
    })
    expect(bad.status).toBe(400)
    expect((await request("GET", "/__review/api/topics")).status).toBe(200)
  })

  it("refuses a write that is not JSON or comes from another site", async () => {
    const text = await request("POST", "/__review/api/topics", {
      headers: { "content-type": "text/plain" },
    })
    expect(text.status).toBe(415)
    const cross = await request("POST", "/__review/api/topics", {
      json: { name: "x" },
      headers: { "sec-fetch-site": "cross-site" },
    })
    expect(cross.status).toBe(403)
  })

  it("names the repo root", async () => {
    const res = await request("GET", "/__review/api/repo-root")
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ root: path.resolve(process.cwd()) })
  })

  it("rejects path traversal on /__review/files", async () => {
    const res = await request("GET", "/__review/files/t/../../package.json")
    expect(res.status).toBe(400)
    const encoded = await request("GET", "/__review/files/t/%2e%2e/%2e%2e/package.json")
    expect(encoded.status).toBe(400)
  })
})

describe("events", () => {
  it("emits an SSE event when a file in a topic changes", async () => {
    await fs.mkdir(path.join(root, "alpha"))
    const message = await new Promise<string>((resolve, reject) => {
      const req = http.get(base + "/__review/events", (res) => {
        expect(res.headers["content-type"]).toMatch(/text\/event-stream/)
        let data = ""
        res.setEncoding("utf8")
        res.on("data", (c: string) => {
          data += c
          const m = /data: (.*)\n\n/.exec(data)
          if (m) {
            req.destroy()
            resolve(m[1])
          }
        })
        // Give the watcher a beat, then touch a file inside the topic.
        setTimeout(() => {
          fs.writeFile(path.join(root, "alpha", ".tmp-ignored"), "x")
            .then(() => fs.writeFile(path.join(root, "alpha", "01-x.md"), "# 1. X\n"))
            .catch(reject)
        }, 150)
      })
      req.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") reject(err)
      })
    })
    expect(JSON.parse(message)).toEqual({ topic: "alpha" })
  })
})

describe("topicOf", () => {
  it("names the first segment and skips dot-files", () => {
    expect(topicOf("alpha/01-x.md")).toBe("alpha")
    expect(topicOf("alpha/01-x/1.a-state.json")).toBe("alpha")
    expect(topicOf("alpha")).toBe("alpha")
    expect(topicOf("alpha/.tmp-abc")).toBeNull()
    expect(topicOf(".DS_Store")).toBeNull()
    expect(topicOf("")).toBeNull()
  })
})

describe("openEditor", () => {
  it("only accepts files inside the repo root", () => {
    expect(resolveEditorTarget("/repo", "src/a.tsx", 12)).toBe("/repo/src/a.tsx:12")
    expect(resolveEditorTarget("/repo", "/repo/b.ts", 1)).toBe("/repo/b.ts:1")
    expect(() => resolveEditorTarget("/repo", "../etc/passwd", 1)).toThrow()
    expect(() => resolveEditorTarget("/repo", "/etc/passwd", 1)).toThrow()
    expect(() => resolveEditorTarget("/repo", "a.ts", -1)).toThrow()
  })
})

describe("shellBuild", () => {
  it("bundles the shell entry and reads the stylesheet", async () => {
    const build = createShellBuild()
    try {
      const { js, css } = await build.assets()
      expect(js).toContain("Design review")
      expect(typeof css).toBe("string")
    } finally {
      await build.dispose()
    }
  }, 20000)
})

describe("cli", () => {
  it("parses flags and the app command after --", () => {
    expect(
      parseArgs([
        "--port",
        "3000",
        "--target",
        "3001",
        "--root",
        "docs/review",
        "--",
        "npx",
        "next",
        "dev",
        "-p",
        "3001",
      ])
    ).toEqual({
      port: 3000,
      target: 3001,
      root: "docs/review",
      command: ["npx", "next", "dev", "-p", "3001"],
    })
    expect(() => parseArgs(["--port", "3000", "--target", "3001", "--root", "r"])).toThrow()
    expect(() => parseArgs(["--bogus", "1", "--", "x"])).toThrow()
  })
})
