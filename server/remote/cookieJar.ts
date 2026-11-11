import type { StoredCookie } from "./chromeCookies.ts"

// The remote site's cookies, in memory only: seeded from Chrome, kept up to
// date from the upstream's Set-Cookie. Never written to disk.
export class CookieJar {
  private cookies: StoredCookie[]

  constructor(cookies: StoredCookie[]) {
    this.cookies = [...cookies]
  }

  replace(cookies: StoredCookie[]) {
    this.cookies = [...cookies]
  }

  // `name=value; …` for a request to host + path. Secure cookies go too: the
  // upstream is always https, whatever the browser side is.
  header(host: string, path: string): string {
    const now = Date.now() / 1000
    return this.cookies
      .filter(
        (c) =>
          (c.expires === undefined || c.expires > now) &&
          domainMatches(host, c) &&
          pathMatches(path, c.path)
      )
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join("; ")
  }

  // `requestPath` is the pathname the Set-Cookie answered: a cookie without
  // its own Path is scoped to that path's directory.
  store(host: string, setCookie: string[], requestPath = "/") {
    for (const line of setCookie) {
      const parsed = parseSetCookie(host, line, defaultPath(requestPath))
      if (!parsed) continue
      this.cookies = this.cookies.filter(
        (c) => !(c.name === parsed.name && c.domain === parsed.domain && c.path === parsed.path)
      )
      if (parsed.expires === undefined || parsed.expires > Date.now() / 1000) {
        this.cookies.push(parsed)
      }
    }
  }
}

function domainMatches(host: string, c: StoredCookie) {
  if (c.hostOnly) return host === c.domain
  return host === c.domain || host.endsWith(`.${c.domain}`)
}

// RFC 6265 path-match: a prefix ending on a segment boundary.
function pathMatches(reqPath: string, cookiePath: string) {
  if (reqPath === cookiePath) return true
  if (!reqPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith("/") || reqPath[cookiePath.length] === "/"
}

// RFC 6265 default-path: up to, not including, the last "/"; "/" at the top.
function defaultPath(requestPath: string) {
  if (!requestPath.startsWith("/")) return "/"
  const i = requestPath.lastIndexOf("/")
  return i === 0 ? "/" : requestPath.slice(0, i)
}

function parseSetCookie(host: string, line: string, path: string): StoredCookie | null {
  const [pair, ...attrs] = line.split(";")
  const eq = pair.indexOf("=")
  if (eq < 1) return null
  const cookie: StoredCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    domain: host,
    path,
    secure: false,
    hostOnly: true,
  }
  let maxAge: number | undefined
  let expires: number | undefined
  for (const attr of attrs) {
    const i = attr.indexOf("=")
    const key = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase()
    const val = i < 0 ? "" : attr.slice(i + 1).trim()
    if (key === "domain" && val) {
      const domain = val.replace(/^\./, "").toLowerCase()
      // A Domain the host doesn't belong to is rejected, as a browser would.
      if (host !== domain && !host.endsWith(`.${domain}`)) return null
      cookie.domain = domain
      cookie.hostOnly = false
    } else if (key === "path" && val.startsWith("/")) {
      cookie.path = val
    } else if (key === "secure") {
      cookie.secure = true
    } else if (key === "max-age" && /^-?\d+$/.test(val)) {
      maxAge = Number(val)
    } else if (key === "expires") {
      const ms = Date.parse(val)
      if (!Number.isNaN(ms)) expires = ms / 1000
    }
  }
  // Max-Age wins over Expires; <= 0 means delete.
  if (maxAge !== undefined) cookie.expires = maxAge <= 0 ? 0 : Date.now() / 1000 + maxAge
  else if (expires !== undefined) cookie.expires = expires
  return cookie
}
