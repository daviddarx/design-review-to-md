import { describe, expect, it } from "vitest"
import type { StoredCookie } from "./chromeCookies.ts"
import { CookieJar } from "./cookieJar.ts"

const cookie = (c: Partial<StoredCookie> & { name: string }): StoredCookie => ({
  value: "v",
  domain: "a.ch",
  path: "/",
  secure: false,
  hostOnly: false,
  ...c,
})

describe("CookieJar.header", () => {
  it("sends a domain cookie to the domain and its subdomains only", () => {
    const jar = new CookieJar([cookie({ name: "d", value: "1", domain: "a.ch" })])
    expect(jar.header("a.ch", "/")).toBe("d=1")
    expect(jar.header("web1.a.ch", "/")).toBe("d=1")
    expect(jar.header("b.ch", "/")).toBe("")
    expect(jar.header("xa.ch", "/")).toBe("")
  })

  it("sends a host-only cookie to its exact host only", () => {
    const jar = new CookieJar([cookie({ name: "h", value: "1", hostOnly: true })])
    expect(jar.header("a.ch", "/")).toBe("h=1")
    expect(jar.header("web1.a.ch", "/")).toBe("")
  })

  it("matches paths on segment boundaries", () => {
    const jar = new CookieJar([cookie({ name: "p", value: "1", path: "/api" })])
    expect(jar.header("a.ch", "/api")).toBe("p=1")
    expect(jar.header("a.ch", "/api/x")).toBe("p=1")
    expect(jar.header("a.ch", "/apix")).toBe("")
    expect(jar.header("a.ch", "/")).toBe("")
  })

  it("sends secure cookies (the upstream is https) and skips expired ones", () => {
    const now = Date.now() / 1000
    const jar = new CookieJar([
      cookie({ name: "s", value: "1", secure: true }),
      cookie({ name: "old", value: "1", expires: now - 10 }),
      cookie({ name: "new", value: "1", expires: now + 100 }),
    ])
    expect(jar.header("a.ch", "/")).toBe("s=1; new=1")
  })

  it("puts longer paths first", () => {
    const jar = new CookieJar([
      cookie({ name: "root", value: "1" }),
      cookie({ name: "deep", value: "2", path: "/x/y" }),
    ])
    expect(jar.header("a.ch", "/x/y/z")).toBe("deep=2; root=1")
  })

  it("replace swaps the whole jar", () => {
    const jar = new CookieJar([cookie({ name: "a", value: "1" })])
    jar.replace([cookie({ name: "b", value: "2" })])
    expect(jar.header("a.ch", "/")).toBe("b=2")
  })
})

describe("CookieJar.store", () => {
  it("keeps a cookie without Domain as host-only", () => {
    const jar = new CookieJar([])
    jar.store("web1.a.ch", ["sid=abc; Path=/; HttpOnly; Secure"])
    expect(jar.header("web1.a.ch", "/x")).toBe("sid=abc")
    expect(jar.header("other.a.ch", "/")).toBe("")
  })

  it("keeps a Domain cookie for the domain, leading dot dropped", () => {
    const jar = new CookieJar([])
    jar.store("web1.a.ch", ["d=1; Domain=.a.ch; Path=/"])
    expect(jar.header("other.a.ch", "/")).toBe("d=1")
  })

  it("ignores a Domain the host does not belong to", () => {
    const jar = new CookieJar([])
    jar.store("web1.a.ch", ["d=1; Domain=b.ch"])
    expect(jar.header("b.ch", "/")).toBe("")
    expect(jar.header("web1.a.ch", "/")).toBe("")
  })

  it("overwrites a cookie with the same name, domain and path", () => {
    const jar = new CookieJar([cookie({ name: "sid", value: "old", domain: "a.ch" })])
    jar.store("a.ch", ["sid=new; Domain=a.ch; Path=/"])
    expect(jar.header("a.ch", "/")).toBe("sid=new")
  })

  it("deletes on Max-Age=0 and on a past Expires", () => {
    const jar = new CookieJar([
      cookie({ name: "a", value: "1" }),
      cookie({ name: "b", value: "1" }),
      cookie({ name: "c", value: "1" }),
    ])
    jar.store("a.ch", [
      "a=; Domain=a.ch; Path=/; Max-Age=0",
      "b=; Domain=a.ch; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ])
    expect(jar.header("a.ch", "/")).toBe("c=1")
  })

  it("defaults a cookie without Path to the request's directory", () => {
    const jar = new CookieJar([])
    jar.store("a.ch", ["dir=1"], "/app/login")
    jar.store("a.ch", ["top=1"], "/login")
    jar.store("a.ch", ["bad=1; Path=rel"], "/x/y/z")
    jar.store("a.ch", ["none=1"])
    expect(jar.header("a.ch", "/app/home")).toBe("dir=1; top=1; none=1")
    expect(jar.header("a.ch", "/other")).toBe("top=1; none=1")
    expect(jar.header("a.ch", "/x/y/q")).toBe("bad=1; top=1; none=1")
  })

  it("Max-Age wins over Expires", () => {
    const jar = new CookieJar([])
    jar.store("a.ch", ["a=1; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT"])
    expect(jar.header("a.ch", "/")).toBe("a=1")
  })
})
