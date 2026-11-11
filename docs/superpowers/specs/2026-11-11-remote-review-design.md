# Remote review — design

Briefing: `docs/briefing/01-non-local/briefing.md`. Branch `feat/expand-non-local`.

## Intent

The tool works well for an app the reviewer runs locally: `npm run review` in
the app's repo, ⌃R, pins, and the feedback lands in that repo for his own
Claude. He now wants to review **a colleague's deployed branch**: a remote
site behind Microsoft SSO that he is already logged into in Chrome. The
colleague's code is not on his machine, so the review goes to his Desktop, he
zips it and sends it, and the colleague's own agent works through it. When the
colleague redeploys (same URL), he runs the command again, validates or
refines what changed, and sends the next round.

Two real targets, both on the company's stage setup:

- `https://web1.stage.campos.ch/en_4765/desktopapp/map/MA_4765-1-3189`: a React
  app (Vite production build, no source maps, minified component names,
  `data-testid` present) with a PixiJS map in one WebGL canvas.
- `https://web3.stage.campos.ch/printingeditorapp/?gallery=1`: a .NET Avalonia
  app compiled to WebAssembly. Its whole UI is one WebGL canvas, and its DOM
  holds about 25 elements (the loading splash).

What recon found on both: the session is an HttpOnly cookie (no MSAL or token
in the page), the API sits on the same host under relative paths and fails
without the cookie, there's no `X-Frame-Options` and no `frame-ancestors`, the
CSP has `script-src`/`connect-src` and `upgrade-insecure-requests`, and the
host sits behind Cloudflare.

## Goals

- One command in this repo starts a review of a remote URL, with no new login.
- Everything the local tool does keeps working against the remote site wherever
  the page allows it: ⌃R panel, pins on several pages, pins inside popups and
  overlays, Go to pin, Show pins, hover replay, screenshots, state snapshots.
- Canvas apps can be reviewed, with **spot pins**.
- **Finalize review** writes a hand-over the colleague can use without the
  tool: `index.html`, `readme.md` and an adapted protocol.
- Rounds: a later run for the same URL continues or starts the next round from
  the previous one, and the next hand-over shows only what is still to do.

## Non-goals

- No Chrome extension and no injecting the shell into the remote page. He
  rejected this: the site's media queries would see the full window instead of
  the frame.
- Nothing comes back from the colleague except the redeployed site: no
  `Claude:` notes, no `review` tags written by their agent.
- No zipping. He zips the folder himself after checking it.
- No source lookup on a remote build. "Open in VS Code" stays hidden when a pin
  has no source; it already is (`RowItem.tsx`, `source && …`).
- Local mode (`npm run review` in an app repo) does not change.

## Anti-goals

- Writing his Chrome cookies anywhere on disk, or exposing the proxy beyond
  localhost.
- A hand-over that shows `done` items again, or silently drops items nobody
  touched.
- A second run that overwrites or forks a round he is still working on.

## How it works

### Command

`npm run review:remote` in this repo (a new script; an optional `--url <url>`
skips the prompt). It asks in the terminal for the URL, then prints
`Open http://localhost:<port><path+query>`, the full page he typed, not just the
origin. There's no app child process: the proxy target is the remote origin.

**Port** (my call): derived from the URL key (below) with the same FNV scheme
as `portsFor`, in a range clear of local mode's. One site therefore always gets
the same localhost origin, so the shell's remembered settings and the proxied
app's own localStorage stay per site and never mix two sites. Note: that
localStorage is the localhost origin's, not the real site's, so the app starts
with its own preferences unset the first time. If that port is taken, the
command refuses to start and says what holds it (my call); falling back to
another port would mix two sites' localStorage.

### Login: Chrome's cookies, server-side

The CLI reads the cookies for the target host (and its parent domains) from
Chrome's profile on macOS:

- `~/Library/Application Support/Google/Chrome/<profile>/Cookies` (SQLite).
  Copy it with its `-wal` file first, because Chrome holds it open. Read it
  with `node:sqlite` (Node ≥ 24.2 is already required).
- Values are `v10`-encrypted: AES-128-CBC, key = PBKDF2-SHA1(Keychain password
  of "Chrome Safe Storage", salt `saltysalt`, 1003 iterations, 16 bytes), IV =
  16 spaces. Read the password with
  `security find-generic-password -w -s "Chrome Safe Storage"`. macOS asks once,
  and "Always allow" makes it silent after that. Recent Chrome versions prefix
  the plaintext with a 32-byte SHA-256 of the host key; strip it when present.
- Profile (my call): search `Default` and `Profile *` for cookies on that host.
  If exactly one has them, use it. If several do, ask in the terminal. If none
  do, say "Log in to <host> in Chrome first" and exit.
- Cookies live only in the server's memory, as a jar. Responses' `Set-Cookie`
  updates the jar.

**Spike first.** Before building anything else, prove on `web1` that the
decrypted cookies alone make `GET /en_4765/api/v1/Setting/GetCurrentUserPreferences`
answer 200 from Node. Two risks need to be retired: Chrome not having written
the session cookie to disk yet, and Cloudflare challenging a non-browser
client. If the spike fails, stop and come back. The fallback design is not
decided.

### Proxy to a remote origin

`server/proxy.ts` today streams to `localhost:<target>` untouched. Remote mode
needs an HTTPS upstream with these changes:

- Request: `Host` set to the remote host. `Origin` and `Referer` rewritten from
  `http://localhost:<port>` to the remote origin. `Cookie` set to the jar's
  cookies for that path, merged with any the browser sent. `User-Agent` passed
  through unchanged.
- Response: `Location` pointing at the remote origin is rewritten to the
  localhost origin. `Content-Security-Policy` (and `-Report-Only`) is dropped:
  `upgrade-insecure-requests` would send every request to `https://localhost`,
  and `connect-src` would refuse the localhost origin. `Set-Cookie` goes into
  the jar; whether it is also passed to the browser (with `Domain` and `Secure`
  stripped) is left to the builder, so long as page scripts that read their own
  cookies keep working.
- Bodies stream through untouched (my call): both targets use relative URLs.
  Absolute links to other hosts (Azure monitoring) load directly.
- WebSocket upgrades are proxied to the remote host too (TLS).

### Session expiry

A document request answered by a redirect to another host (Microsoft's login)
means the session expired. The proxy doesn't follow it. It serves a small page
in the frame: "Session expired: log in to <host> in Chrome, then reload". It
also re-reads Chrome's cookies on the next document request, so no restart is
needed. API calls that hit the same redirect just fail in the app.

### Where the files go

`~/Desktop/design-review-to-md/<key>-<n>/`, one folder per round, side by side:

```
~/Desktop/design-review-to-md/
  web1.stage.campos.ch_en_4765_desktopapp_map_MA_4765-1-3189-0/
  web1.stage.campos.ch_en_4765_desktopapp_map_MA_4765-1-3189-1/
```

- `<key>` = host + path of the URL he typed. The query and hash are dropped, the
  trailing slash is trimmed, and every character other than `[A-Za-z0-9.-]`
  becomes `_` (my call). The frame still opens the full URL, query included.
- Each round folder is a review in the existing sense: `NN-slug/briefing.md`
  with pins and attachments, same format, same `model/`. The storage root is
  `~/Desktop/design-review-to-md`. In remote mode the panel is locked to the
  current round, and the review picker and "new review" are hidden (my call).
- **State snapshots** (`*-state.json`) are kept out of the round folder (my
  call), because he zips that folder as is. They go to
  `~/Desktop/design-review-to-md/.state/<key>-<n>/<NN-slug>/`, which Go to pin
  reads in remote mode.

### Rounds

- No round exists yet: create `-0`.
- The latest round is **not finalized** (no `index.html` in it): continue it.
- The latest round **is finalized**: the terminal asks
  `Continue round <n> or start round <n+1>? [C/n]`. Continue is the default.
- **Starting round n+1** copies round n's feedback folders only (feedback files
  and their assets; state snapshots copied under `.state/`), never its
  `index.html`, `readme.md` or `PROTOCOL.md`, or the new round would read as
  finalized. It then sets every `open` row and title to
  `review` (my call). That reuses the existing UI as is:
  - `review` here means "the colleague was asked to fix it, you haven't checked
    yet". _Validate_ sets `done`, _Refine_ sets `open` with a `Before:` line,
    and the _To review_ filter lists what's left to check.
  - New feedback is `open` as usual.

  The agent's `review` step no longer exists in this mode, because nobody but
  him writes these files.

### Pins on remote pages

All of today's pin capture applies unchanged where the page has DOM: selector
(with `--markers`, default the first stable `data-*`, so `data-testid` here),
openers, frames, screenshot, style box, state snapshot. The component is
whatever the fiber names (minified) and source is absent, which is fine.

### Spot pins (canvas)

A pin whose element is a `<canvas>` also records **where** in it he clicked:
the click point relative to the canvas box, as a fraction of its width and
height so a resized window still places it (my call). This applies on both
targets: the map site's Pixi map and the whole printing editor. The capture
code is shared, so local mode records spots too (my call). It's an optional
field, and `AGENTS.md` gets one line about it.

Check during the build: the Avalonia app may render from a Web Worker
(OffscreenCanvas) or need cross-origin isolation headers. Either would affect
the screenshot or loading it in the frame. If so, report it rather than work
around it silently.

- Screenshot: as today. `keepCanvasPixels` already keeps WebGL pixels. A marker
  is drawn at the spot in the saved image.
- Show pins and Go to pin place the marker at that point of the canvas instead
  of on the canvas box. Restoring what the canvas showed is out of reach: he
  brings the app back to the same screen himself. Hover replay is skipped for
  spots.
- Record shape: an optional `spot: { x, y }` (fractions) on the step's
  `element`. Existing records read as before. The exact shape is the builder's
  choice within that.

### Finalize review

In remote mode the _Copy prompt_ button reads **Finalize review**. It writes
three files into the current round folder (overwriting earlier ones) and opens
the folder in Finder. He checks them, can edit in the panel, and can press it
again. It never zips and never locks.

1. **`index.html`**: one self-contained page (inline CSS, no scripts needed,
   relative image paths) listing every feedback and row to act on: number
   (`3`, `3.b`, `3.b.1`), text, the pin screenshots, attachments as links, and
   the page path per pin. Which rows appear:
   - `open` rows: new ones, plus refined ones, which show their latest `Before:`
     as "was: …".
   - `review` rows (inherited and untouched): shown with a "still open from last
     round" badge.
   - `done` rows are left out; a feedback whose rows are all `done` is left out
     too.

   The page header names the site URL and the round. Visual design is the
   builder's call, kept close to the panel's style.

2. **`readme.md`**: the hand-over text: the site URL, the round, and one
   instruction like today's prompt ("Work through every row tagged `open` or
   `review` in this folder, in your repo — follow PROTOCOL.md"). The colleague
   pastes it to their agent.
3. **`PROTOCOL.md`**: an adapted copy of `AGENTS.md` for the colleague's agent:
   - Read every `open` and `review` row first, then ask the colleague about
     anything unclear, one question at a time.
   - Find the code from `pin.json` (`url`, `selector`, `component`, `text`,
     `rect`); there is no `source`. A spot pin points at a place on a canvas,
     so use the screenshot.
   - Fix in their own repo.
   - Never edit the review files, never set tags, never write `Claude:` notes.
     The review files are read-only for them.
   - `Before:` explains how a refined row's request changed.

   Its source is a template in this repo (for example
   `templates/PROTOCOL.md`), not a rewrite of `AGENTS.md` at run time.

## Constraints

- macOS + Chrome only, for the cookie read. Other platforms or browsers fail
  with a clear message.
- Node ≥ 24.2, no new runtime dependency unless the cookie decryption needs one
  (`node:crypto` and `node:sqlite` should be enough).
- The tool's routes still answer only on a loopback `Host`. The server listens
  on `localhost` only.
- The markdown format and `model/` stay as they are. Rounds and spots are
  additions, not changes to existing fields.
- Follow the repo's conventions: tests with vitest beside the code, decisions
  appended to `docs/context.md`, the README updated with the remote command.

## Left to the builder

- How the remote mode is threaded through `server.ts`/`cli.ts` (a separate
  entry or a flag) and how the shell learns it is in remote mode (the existing
  `dr-config` JSON is the natural place).
- Whether `Set-Cookie` is mirrored to the browser.
- `index.html` layout and styling.
- Handling multiple Chrome profiles beyond the rule above.
