# Remote Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run review:remote` reviews a deployed site the user is logged into in Chrome. Feedback goes in rounds on the Desktop, and **Finalize review** writes a hand-over for a colleague.

**Architecture:** The CLI reads the site's cookies from Chrome's profile (macOS Keychain + AES) into an in-memory jar. The existing review server gets a remote proxy (HTTPS upstream, header rewrites, CSP dropped, session-expiry page) in place of the local dev-server proxy. Storage roots at `~/Desktop/design-review-to-md`, with one review folder per round and state snapshots kept beside it in `.state/`. The shell learns remote mode from `dr-config`: it locks to the round and swaps _Copy prompt_ for _Finalize review_, which writes `index.html`, `readme.md` and `PROTOCOL.md` into the round.

**Tech Stack:** Node ≥ 24.2 (native TS stripping, `node:sqlite`, `node:crypto`, `node:https`), React 19 shell bundled by esbuild, vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-11-11-remote-review-design.md`. Read it first; it holds the reasons.

## Global Constraints

- Node ≥ 24.2. No new runtime dependency (`node:sqlite`, `node:crypto`, `node:https` only).
- Cookies are never written to disk. Every server listens on `localhost` only, and the tool's routes keep refusing a non-loopback `Host`.
- The markdown format and `model/` types stay as they are. Rounds and canvas spots add nothing to `briefing.md`.
- Local mode (`cli.ts --root … -- <cmd>`) behaves exactly as before. Every existing test keeps passing.
- Remote file layout: `~/Desktop/design-review-to-md/<key>-<n>/` for rounds, `~/Desktop/design-review-to-md/.state/<key>-<n>/<NN-slug>/` for `*-state.json`.
- `<key>`: host + path of the URL, query and hash dropped, trailing `/` trimmed, every char not in `[A-Za-z0-9.-]` → `_`.
- After every file change run `npm run format`, then `npm test` and `npm run typecheck` before committing.
- Code style: match the surrounding files (prettier config in repo, no semicolons, comment density of the neighbours, `.ts` import extensions).
- Commit after each task, small and focused, on branch `feat/expand-non-local`. Never amend, never rewrite history. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A Chrome profile where the session cookie is a session-only cookie (`has_expires = 0`) must still be read, since SSO session cookies often are. Task 1 test: `has_expires=0` rows are included.
- A URL typed with a trailing slash, a query, or uppercase must map to the same `<key>` as without the slash; the query never changes the key. Task 3 tests.
- A second run while round `-1` exists but `-0` is the only finalized one must continue `-1`, not offer `-2`. Task 3 test: only the **latest** round decides.
- `Location: https://<host>/x?y` on a non-document request (API) must become `/x?y`, while a redirect to `login.microsoftonline.com` on an XHR passes through untouched. Task 2 tests.
- Finalizing a round whose every row is `done` must still write all three files, and `index.html` must say there is nothing left to do. Task 6 test.

---

### Task 1: Chrome cookies (go/no-go)

**Files:**

- Create: `server/remote/chromeCookies.ts`
- Test: `server/remote/chromeCookies.test.ts`

**Interfaces:**

- Produces:
  - `type StoredCookie = { name: string; value: string; domain: string; path: string; secure: boolean; hostOnly: boolean; expires?: number }`. `domain` has no leading dot, and `hostOnly` is true when Chrome's `host_key` had none.
  - `deriveKey(password: string): Buffer`: PBKDF2-SHA1, salt `saltysalt`, 1003 iterations, 16 bytes.
  - `decryptValue(encrypted: Buffer, key: Buffer, hostKey: string, dbVersion: number): string`. For a `v10` prefix it does AES-128-CBC with an IV of 16 spaces (0x20); when `dbVersion >= 24` it drops the first 32 bytes of plaintext (the SHA-256 of `hostKey`). An empty buffer returns `""`.
  - `hostKeysFor(host: string): string[]`, e.g. `web1.stage.campos.ch` → `["web1.stage.campos.ch", ".web1.stage.campos.ch", ".stage.campos.ch", ".campos.ch"]`. No single-label TLD.
  - `readCookiesFromDb(dbFile: string, host: string, key: Buffer): StoredCookie[]`. Copies `dbFile` (+ `-wal`, `-shm` if present) to a fresh `fs.mkdtempSync` dir, opens it with `node:sqlite` `DatabaseSync` read-only, reads `meta.version`, selects `host_key, name, value, encrypted_value, path, is_secure, has_expires, expires_utc` where `host_key IN hostKeysFor(host)`, decrypts, and deletes the temp copy in `finally`. Rows with `has_expires = 0` are included; expired ones are dropped. Chrome time is microseconds since 1601-01-01.
  - `chromeProfiles(base = ~/Library/Application Support/Google/Chrome): { name: string; cookiesFile: string }[]`: `Default` and `Profile *` dirs that have `Cookies` or `Network/Cookies` (newer Chrome).
  - `keychainPassword(): string`: runs `security find-generic-password -w -s "Chrome Safe Storage"` via `execFileSync` and throws a readable `Error` on failure.
  - `loadChromeCookies(host: string, pickProfile: (names: string[]) => Promise<string>): Promise<StoredCookie[]>`. Throws `Error("Log in to <host> in Chrome first")` when no profile has cookies for the host, and calls `pickProfile` only when several do. On a non-darwin platform it throws `Error("Remote review reads Chrome's cookies on macOS only")`.

- [ ] **Step 1: Write failing tests** in `chromeCookies.test.ts`:
  - `deriveKey("peanuts")` equals `crypto.pbkdf2Sync("peanuts","saltysalt",1003,16,"sha1")`.
  - Round-trip: encrypt `"abc"` with `aes-128-cbc`, IV `Buffer.alloc(16, 0x20)`, prefix `v10`. Then `decryptValue(…, 23)` → `"abc"`. With a 32-byte prefix prepended before encrypting, `decryptValue(…, 24)` → `"abc"`.
  - `hostKeysFor("web1.stage.campos.ch")` equals the list above.
  - `readCookiesFromDb` on a fixture DB built in the test with `DatabaseSync` (tables `meta(key,value)` with version 24, and `cookies` with the columns above). It has rows for `.campos.ch` (has_expires 0), `web1.stage.campos.ch`, an expired row, and `other.ch`. Expect the first two only, decrypted, `domain` without the dot, `hostOnly` `false`/`true`.
- [ ] **Step 2:** `npx vitest run server/remote/chromeCookies.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3:** Implement the module.
- [ ] **Step 4:** Run the tests again. Expect PASS.
- [ ] **Step 5: Spike, go/no-go.** Write a throwaway `scratch` script outside the repo (in the session scratchpad, not committed). It calls `loadChromeCookies("web1.stage.campos.ch", async (n) => n[0])` and then `https.get("https://web1.stage.campos.ch/en_4765/api/v1/Setting/GetCurrentUserPreferences", { headers: { cookie, "user-agent": <a current Chrome UA> } })`. Print the status code only, never the cookie values. Expect `200`. If it isn't 200 (cookie missing, 401/500, Cloudflare challenge 403), **stop the whole plan and report back**. The macOS Keychain prompt is expected on the first run; the user has to click it, so tell the controller to warn the user before running it.
- [ ] **Step 6:** `npm run format && npm run typecheck`, then commit `feat(remote): read a site's cookies from Chrome's profile`.

### Task 2: Remote proxy

**Files:**

- Create: `server/remote/cookieJar.ts`, `server/remote/remoteProxy.ts`
- Test: `server/remote/cookieJar.test.ts`, `server/remote/remoteProxy.test.ts`

**Interfaces:**

- Consumes: `StoredCookie` (Task 1).
- Produces:
  - `class CookieJar { constructor(cookies: StoredCookie[]); replace(cookies: StoredCookie[]): void; header(host: string, path: string): string; store(host: string, setCookie: string[]): void }`. `header` gives `name=value; …` for domain/path matches. `store` parses `Set-Cookie` (name, value, Domain, Path, Max-Age/Expires deletion), keeps cookies in memory only, and never touches disk.
  - `type RemoteTarget = { origin: URL; jar: CookieJar; refresh: () => Promise<void>; stale: boolean }`. `origin` is e.g. `https://web1.stage.campos.ch`. Tests may use `http:` origins, so pick `http`/`https` from `origin.protocol`.
  - `proxyRemoteRequest(target: RemoteTarget, req: http.IncomingMessage, res: http.ServerResponse): void`
  - `proxyRemoteUpgrade(target: RemoteTarget, req, socket: Duplex, head: Buffer, track: (s: Duplex) => void): void`, via `tls.connect` (or `net` for `http:`), with the request head replayed and `Host`, `Origin` and `Cookie` rewritten as below.
  - `SESSION_EXPIRED_HTML(host: string): string`: a short page reading `Session expired: log in to <host> in Chrome, then reload.`

Request rewrites:

- `host` becomes `origin.host`.
- `origin` and `referer`, when they start with the request's own `http://<req host>`, have that prefix replaced by `origin.origin`.
- `cookie` is the jar's header merged with the browser's; browser values win on the same name.

Response rewrites:

- `location` that starts with `origin.origin` is rewritten to its path + search + hash.
- `content-security-policy` and `content-security-policy-report-only` are removed.
- `set-cookie` goes into `jar.store`, and is then passed on with `Domain=…` removed.

Session expiry: when the request's `sec-fetch-dest` is `iframe` or `document`, and the response is a 3xx whose `location` resolves to a host other than `origin.host`, answer `200 text/html` with `SESSION_EXPIRED_HTML` and set `target.stale = true`. At the start of each request with `sec-fetch-dest` `iframe`/`document`, if `target.stale`, `await target.refresh()` and set `stale = false`. Upstream errors answer 502, as `proxy.ts` does.

- [ ] **Step 1: Write failing tests.** `cookieJar.test.ts` covers domain/path matching, host-only vs domain cookies, `store` overwrite, and `Max-Age=0` deletion. `remoteProxy.test.ts` starts a plain `http` upstream on port 0 and a front server on port 0 that calls `proxyRemoteRequest`, then asserts:
  - the upstream sees `host` = upstream host, `origin` rewritten, and a cookie header with the jar's cookie plus the browser's;
  - the response has no CSP header;
  - an absolute `location` to the upstream becomes `/next?q=1` for an XHR (no `sec-fetch-dest`);
  - a `302` to `https://login.microsoftonline.com/…` with `sec-fetch-dest: iframe` answers 200 with the expired text, and the next iframe request calls `refresh` exactly once;
  - the same 302 without `sec-fetch-dest` passes through as 302 with its `location` unchanged;
  - `set-cookie: a=1; Domain=127.0.0.1; Path=/` reaches the browser without `Domain`, and the jar's header then contains `a=1`.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement both modules. Stream bodies untouched, like `proxy.ts`.
- [ ] **Step 4:** Run them. Expect PASS.
- [ ] **Step 5:** Format, typecheck, commit `feat(remote): proxy to a remote origin with an in-memory cookie jar`.

### Task 3: URL key, port and rounds

**Files:**

- Create: `server/remote/rounds.ts`
- Test: `server/remote/rounds.test.ts`

**Interfaces:**

- Produces:
  - `REMOTE_BASE = path.join(os.homedir(), "Desktop", "design-review-to-md")`
  - `urlKey(url: string): string`, as in Global Constraints. The host is lowercased; the path keeps its case.
  - `REMOTE_PORT_BASE = 4900`, `REMOTE_PORTS = 800`, `remotePort(key: string): number`: FNV-1a as in `cli.ts`'s `portsFor` (reuse it by extracting the hash into an exported `fnv1a(text: string): number` in `cli.ts`), `REMOTE_PORT_BASE + hash % REMOTE_PORTS`.
  - `roundName(key: string, n: number): string` → `` `${key}-${n}` ``
  - `latestRound(base: string, key: string): number | null`: the highest `n` among the dirs named `` `${key}-${n}` `` (exact key match, so `…-3189-1` is not mistaken for key `…-3189` round 1 of another key; parse with `^<escaped key>-(\d+)$`).
  - `isFinalized(base: string, round: string): boolean`: `index.html` exists in it.
  - `startNextRound(base: string, key: string, from: number): Promise<string>`. It creates `roundName(key, from + 1)`, copies every `NN-*` feedback folder of round `from` (not `index.html`, `readme.md` or `PROTOCOL.md`), copies `.state/<from round>` to `.state/<new round>` if present, then in every copied `briefing.md` (parsed with `parseFeedback`, written with `serializeFeedback`) sets every `open` row, sub-row and title tag to `review`. It returns the new round name.
  - `chooseRound(base, key, ask: (q: string) => Promise<string>): Promise<string>`:
    - no round yet: create the `-0` dir and return it;
    - latest not finalized: return it;
    - latest finalized: `ask("Continue round <n> or start round <n+1>? [C/n] ")`, where `n`/`N` → `startNextRound`, anything else → latest.

- [ ] **Step 1: Write failing tests** (tmp dir as base):
  - `urlKey("https://web1.stage.campos.ch/en_4765/desktopapp/map/MA_4765-1-3189")` → `"web1.stage.campos.ch_en_4765_desktopapp_map_MA_4765-1-3189"`.
  - The same URL with a trailing `/`, with `?x=1#h`, and with the host in uppercase gives the same key.
  - `urlKey("https://web3.stage.campos.ch/printingeditorapp/?gallery=1")` → `"web3.stage.campos.ch_printingeditorapp"`.
  - `remotePort` is stable and within `[4900, 5700)`.
  - `latestRound`: dirs `k-0`, `k-1`, `k-x-0` → `1` for `k`.
  - `chooseRound`: creates `k-0` first; returns `k-0` again unfinalized (with `ask` not called); after `index.html` is written and `ask` returns `"n"`, returns `k-1`; when only `k-0` is finalized and `k-1` exists unfinalized, returns `k-1` without asking.
  - `startNextRound`: a fixture briefing with an `open` title, an `open` row, a `done` row and an `open` sub-row ends up with title and both open rows set to `review` and `done` unchanged. Every other line stays byte-identical. `index.html` and `readme.md` are not copied, and `.state/k-0/01-x/1-state.json` is copied to `.state/k-1/01-x/`.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expect PASS, along with `server/cli.test.ts`.
- [ ] **Step 5:** Format, typecheck, commit `feat(remote): url key, per-site port and review rounds`.

### Task 4: State snapshots outside the round

**Files:**

- Modify: `server/storage.ts` (constructor, `writeAssets`, `renameAssets`, `removeAssets`, `shiftPinFiles`, `deleteFeedback`, `assetPath`, `listReviews`)
- Test: `server/storage.test.ts`

**Interfaces:**

- Produces: `new Storage(root: string, opts?: { stateRoot?: string })`. With `stateRoot`, every file whose name (after `<rowId>-`) is a `state` pin asset (`parsePinAssetName(...)?.file === "state"`) lives in `<stateRoot>/<review>/<folder>/` instead of `<root>/<review>/<folder>/`. Writing, renaming, removing, shifting, deleting the feedback, and `assetPath` all follow it, so `handleFile` serves it unchanged. Without `stateRoot`, nothing changes. `listReviews` skips names starting with `.`.

- [ ] **Step 1: Write failing tests** in `storage.test.ts`, under a new `describe("stateRoot")`:
  - creating a feedback with assets `pin.png` + `state.json` puts the png in the review folder and the state in `<stateRoot>/<review>/<folder>/1-state.json`;
  - `assetPath(review, "<folder>/1-state.json")` resolves into `stateRoot`;
  - removing the first of two pins on a row shifts `state-2.json` → `state.json` inside `stateRoot`;
  - `deleteFeedback` removes the state folder too;
  - `listReviews` ignores a `.state` dir in root.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement. Route through one private helper `assetDirFor(dir, folder, name)` rather than duplicating the branches.
- [ ] **Step 4:** Run the whole `server/storage.test.ts`. Expect PASS.
- [ ] **Step 5:** Format, typecheck, commit `feat(storage): keep state snapshots in a separate root when asked`.

### Task 5: Server and CLI remote mode

**Files:**

- Modify: `server/server.ts`, `server/api.ts`, `server/cli.ts`, `package.json`, `shell/config.ts`
- Test: `server/server.test.ts`, `server/cli.test.ts`, `shell/config.test.ts`

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces:
  - `ReviewServerOptions` gains `remote?: { target: RemoteTarget; url: string; round: string }`. With it, non-tool requests go to `proxyRemoteRequest`/`proxyRemoteUpgrade` (`targetPort` is ignored), and `open-editor` and `resolve-source` answer 404.
  - `shellHtml(markers: string[], remote?: { url: string; round: string })` puts `remote` in the `dr-config` JSON.
  - `ShellConfig = { markers: string[]; remote?: { url: string; round: string } }`, and `readConfig` validates both strings.
  - `GET /__review/api/repo-root` in remote mode answers `{ root: <storage root>, reviews: "", agents: "" }`, so the shell's existing fetch doesn't fail.
  - `parseArgs` accepts `--remote` (no value) with optional `--url <url>` and `--markers`. It returns `{ remote: true, url?, markers }`, and the command after `--` is not required in that mode. Local parsing is unchanged.
  - `package.json` script: `"review:remote": "node server/cli.ts --remote"`. Pass `--url` after `--` of npm: `npm run review:remote -- --url <url>`.
  - `remoteMain` in `cli.ts`, run when `--remote`:
    1. Ask for the URL with `node:readline/promises` if `--url` is missing, then validate it is `https:` or `http:`.
    2. `loadChromeCookies(host, pickProfile)`, where `pickProfile` asks `Several Chrome profiles have cookies for <host>: 1) Default 2) Profile 1 … Which one? `.
    3. `key = urlKey(url)`, `round = await chooseRound(REMOTE_BASE, key, ask)`.
    4. `port = remotePort(key)`. If it isn't free, print `[design-review] Port <port> for <host> is taken — close what holds it` and exit 1.
    5. `new Storage(REMOTE_BASE, { stateRoot: path.join(REMOTE_BASE, ".state") })`, `CookieJar`. `refresh` re-runs `loadChromeCookies` with the same profile and `jar.replace`.
    6. Listen on `localhost`, then print `[design-review] Open http://localhost:<port><path+search>` and `[design-review] Round <round> in <REMOTE_BASE>`.
    7. Before step 2, print `[design-review] macOS may ask to let node read "Chrome Safe Storage" — choose Always Allow.`

- [ ] **Step 1: Write failing tests.**
  - `cli.test.ts`: `parseArgs(["--remote"])` → `{ remote: true, markers: [] }`; `parseArgs(["--remote","--url","https://x.ch/a"])`; and local usage still throws without `--root`.
  - `config.test.ts`: `remote` is read, and a malformed `remote` is dropped.
  - `server.test.ts`: `createReviewServer` with `remote` and an `http` upstream on port 0 (`RemoteTarget` built by hand) proxies `/api/x` to it, serves the shell for `sec-fetch-dest: document` with `"remote":{"url"` in the config, answers 404 on `POST /__review/api/open-editor`, and `repo-root` returns empty `reviews`.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement. Keep `main()` for local mode as is; branch on `parsed.remote` at the top.
- [ ] **Step 4:** Run them. Expect PASS; full `npm test` green.
- [ ] **Step 5:** Format, typecheck, commit `feat(remote): review:remote command serves a remote site through the proxy`.

### Task 6: Finalize review

**Files:**

- Create: `server/remote/finalize.ts`, `templates/PROTOCOL.md`
- Modify: `server/api.ts`, `server/server.ts`
- Test: `server/remote/finalize.test.ts`, `server/server.test.ts`

**Interfaces:**

- Consumes: `Storage.readReview`, `Feedback`/`Row` types, `REMOTE_BASE` layout.
- Produces:
  - `type HandOverRow = { id: string; text: string; kind: "new" | "refined" | "still-open"; was?: string; pins: { path: string; screenshot?: string }[]; attachments: string[]; children: HandOverRow[] }`
  - `handOverRows(feedback: Feedback): HandOverRow[]`. `done` rows are dropped. `open` with a `before` history entry → `refined`, with `was` = the last `before`. `open` without one → `new`. `review` → `still-open`. A `done` parent whose children are all dropped is dropped. A `done` parent with a kept child stays as a heading row with kind of its first kept child. (A sub-row inherits nothing; it is classified by its own tag.) Attachments come from each row's `extra` lines matching `📎 [name](name)`; check `model/markdown.ts` for how they are stored and use that.
  - `buildIndexHtml(opts: { url: string; round: string; feedbacks: Feedback[] }): string`. It's self-contained: inline `<style>`, no scripts, images by relative path `<NN-slug>/<file>`, and every text HTML-escaped. The header shows the site URL (as a link) and the round. One section per feedback with rows left (title `N. Title`). Each row shows the id (`3.b`), the text, a badge (`New`, `Refined`, `Still open from last round`), `was: …` for refined rows, the pin path and screenshot, and attachment links. When nothing is left, it says `Nothing left to do in this round.`. A feedback with no rows is treated as a row (its own tag), the way AGENTS.md says.
  - `readmeText(opts: { url: string; round: string }): string`:

    ```
    # Design review — <round>

    Site: <url>

    Paste this to your coding agent, in your repo:

    > Work through every row tagged `open` or `review` in this folder (<round>) — follow PROTOCOL.md in it. index.html shows the same corrections with their screenshots.
    ```

  - `templates/PROTOCOL.md`: an adaptation of `AGENTS.md`, written in its terse style:
    - **Before you start**: read every `open` and `review` row first, with `briefing.md`, pin screenshots, `pin.json` and attachments; then ask the colleague in the terminal, one question at a time.
    - **The files are read-only**: never edit, never retag, never write `Claude:` lines. The reviewer sees the result on the redeployed site.
    - **Statuses**: `open` is new or refined, and the newest `Before:` is what was asked last round. `review` was asked last round and isn't checked yet; fix it if it isn't already.
    - **Finding the code**: `pin.json`'s `url`, `element.selector` (built on `data-testid` first), `element.text`, `element.rect`; `component` is minified; there is no `source`.
    - **Canvas pins**: when `element.tag` is `canvas`, the pin marks a spot in a drawn surface. `mouse` relative to `rect` is the spot, and the screenshot's red dot shows it.
    - **Where things are**: same as AGENTS.md, minus `state.json`, which isn't included.
  - `finalizeRound(storage: Storage, review: string, url: string, openFolder: (dir: string) => void): Promise<void>` writes `index.html`, `readme.md` and `PROTOCOL.md` (copied from `templates/PROTOCOL.md`, path via `import.meta.dirname`) into the round dir, overwriting, then calls `openFolder(dir)`.
  - `POST /__review/api/reviews/:review/finalize` (remote mode only; 404 otherwise) calls `finalizeRound` with the server's `remote.url` and an `openFolder` from `ReviewServerOptions.openFolder ?? (dir => spawn("open", [dir], { detached: true, stdio: "ignore" }).unref())`. It answers `{ ok: true, dir }`.

- [ ] **Step 1: Write failing tests** in `finalize.test.ts`:
  - `handOverRows` on a fixture with a `done` row, an `open` row, an `open` row with two `before` entries (`was` = second), a `review` row, and a `done` row with an `open` sub-row. Expect the kinds, the `was` and the drop rules above.
  - `buildIndexHtml`:
    - contains `New`, `Refined`, `Still open from last round`, `src="01-nav/1.a-pin.png"`, and the escaped `&lt;b&gt;` for a row text `<b>`;
    - no `<script`;
    - does not contain the done row's text;
    - with every row done, contains `Nothing left to do in this round.`.
  - `finalizeRound` on a tmp `Storage` writes the three files and calls `openFolder` with the round dir, and a second call overwrites `index.html` with updated content.
  - `server.test.ts`: `POST …/finalize` in remote mode returns `{ ok: true }` and the files exist; in local mode it returns 404.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement, and write `templates/PROTOCOL.md`.
- [ ] **Step 4:** Run them. Expect PASS.
- [ ] **Step 5:** Format, typecheck, commit `feat(remote): finalize review writes index.html, readme.md and PROTOCOL.md`.

### Task 7: Shell remote mode

**Files:**

- Modify: `shell/App.tsx`, `shell/panel/Panel.tsx`, `shell/api.ts`
- Test: `shell/panel/Panel.test.tsx`, `shell/App.test.tsx`

**Interfaces:**

- Consumes: `ShellConfig.remote` (Task 5), `POST …/finalize` (Task 6).
- Produces:
  - `finalizeReview(review: string): Promise<{ ok: true; dir: string }>` in `shell/api.ts`.
  - `Panel` prop `remote?: { url: string; round: string }`. When set:
    - the `ReviewSelect` is replaced by a plain label showing the round;
    - the review is fixed to `remote.round` (App passes it, and the remembered review is ignored);
    - the _Copy prompt_ button reads **Finalize review**, calls `finalizeReview(round)`, and shows `Finalized` with the check icon for 1.5 s, the same pattern as `Copied`. It stays enabled every time;
    - errors go to the panel's existing error line.
  - Everything else (filters including _To review_, Validate/Refine/Devalidate, the drawer, pins) is unchanged. _Open in VS Code_ already hides when a pin has no `source`; leave it.

- [ ] **Step 1: Write failing tests** in `Panel.test.tsx`: with `remote`, no review select is rendered, the round label shows, the button reads `Finalize review`, and clicking it calls a mocked `fetch` `POST /__review/api/reviews/<round>/finalize` and shows `Finalized`. Without `remote`, `Copy prompt` stays. In `App.test.tsx`, a `dr-config` with `remote` makes the panel load that round.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expect PASS.
- [ ] **Step 5:** Format, typecheck, commit `feat(shell): remote mode locks the round and finalizes instead of copying a prompt`.

### Task 8: Canvas spot pins

`PinStep` already records `mouse` and `element.rect`. `markerPoint` (`shell/pick/PinMarkers.tsx`) already places a marker at the click's fraction of the element, and `grabPng` already draws a dot at the click. So a spot needs no new field (the spec leaves its shape to the builder). Only the parts that misbehave on a canvas change.

**Files:**

- Modify: `shell/pick/Picker.tsx`, `shell/pick/capture.ts`, `shell/pick/PinMarkers.tsx`, `AGENTS.md`
- Test: `shell/pick/PinMarkers.test.ts`, `shell/pick/Picker.test.tsx`

**Interfaces:**

- Produces:
  - `isSpot(step: PinStep): boolean`, exported from `PinMarkers.tsx` → `step.element.tag.toLowerCase() === "canvas"`.
  - For a spot:
    - no style overview tip in the screenshot (`tip` undefined) and none shown while picking;
    - the click mark drawn as a crosshair ring (radius 12 CSS px plus the existing dot) so it shows on a full-window capture;
    - hover replay skipped (no synthetic pointer events dispatched into the canvas).
  - `AGENTS.md`, under "Where things are", gets one line: `A pin on a <canvas> (element.tag) marks a spot in a drawn surface: mouse relative to rect is the spot; the screenshot's red mark shows it.`

- [ ] **Step 1: Write failing tests.** `PinMarkers.test.ts`: `isSpot` is true for `CANVAS`/`canvas` and false for `div`; `markerPoint` on a canvas step whose canvas is now twice as wide places x at the same fraction (pins that this existing behaviour holds for canvases). Hover on a spot marker doesn't call `replayHover` (mock it). `Picker.test.tsx`: picking a canvas passes no `tip` to the screenshot (spy on `grabPng`).
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expect PASS; full `npm test`.
- [ ] **Step 5:** Format, typecheck, commit `feat(pick): pins on a canvas are spots — no style tip, no hover replay, a visible mark`.

### Task 9: Docs

**Files:**

- Modify: `README.md`, `docs/context.md`

- [ ] **Step 1:** In `README.md`, add a section **Reviewing a deployed site** after _Getting started_. Cover: `npm run review:remote` (or `-- --url <url>`), the macOS + Chrome requirement and the Keychain prompt, the Desktop layout and rounds (and the continue/next question), session expiry, canvas spots, and _Finalize review_ (the three files; you zip the folder yourself; finalize again overwrites).
- [ ] **Step 2:** Append `## Remote review (2026-11-11)` to `docs/context.md`, with the decisions and their reasons from the spec: cookies via Chrome profile not an extension (media queries), CSP dropped and why, rounds reuse `review`, state outside the round, one port per site, spots reuse `mouse`/`rect`.
- [ ] **Step 3:** `npm run format`, commit `docs: remote review`.

### Task 10: End-to-end check (controller, with the user's Chrome)

- [ ] Start `npm run review:remote -- --url https://web1.stage.campos.ch/en_4765/desktopapp/map/MA_4765-1-3189` in the background, then open the printed URL in a new Chrome tab via claude-in-chrome. Verify the map renders logged in. Press ⌃R and pin a DOM element and the map canvas. Check that the files land in `~/Desktop/design-review-to-md/<key>-0/`, and that state goes under `.state/`.
- [ ] Finalize, then open `index.html` and check it.
- [ ] Repeat the load-only check with `https://web3.stage.campos.ch/printingeditorapp/?gallery=1`: it renders, a canvas pin's screenshot is not blank. Report a Web Worker or cross-origin-isolation problem if it shows up.
- [ ] Leave the test review folders on the Desktop and list them in the final report, so the user decides whether to delete them. Close the tabs and stop the server.
