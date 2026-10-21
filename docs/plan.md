# Design Review Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An in-browser review tool (toolbar, inspector-style pins, feedback panel, point drawer) that writes numbered feedback as plain markdown into `docs/review/<topic>/`, with zero changes to the app's code.

**Architecture:** `packages/design-review/` holds three parts. (1) `model/`: pure TypeScript that parses and serializes the markdown format and applies edit operations. (2) `server/`: a Node process on `:3000` that serves the review **shell** for top-level document requests, reverse-proxies everything else (including HMR websockets) to `next dev` on `:3001`, exposes a JSON API plus an SSE change feed under `/__review/`, writes files, and opens VS Code. (3) `shell/`: a React app, bundled by esbuild, that shows the app in a same-origin iframe beside the panel and reaches into `iframe.contentDocument` for picking, shortcuts and URL mirroring. **No script is injected into the app**; the shell document gives style isolation, so no Shadow DOM is needed.

**Tech Stack:** Node 24 (native TypeScript type stripping for `server/` and `model/`), React 19 (resolved from the root `node_modules`), esbuild (package devDependency), vitest 4 (root binary, the package's own config), happy-dom (package devDependency) for DOM-dependent tests.

**Spec:** `docs/superpowers/specs/2026-10-21-feat-100-design-review-tool-design.md`

## Global Constraints

- Nothing under `src/` is changed, and nothing in `packages/design-review/` imports from `src/` or vice versa.
- Allowed edits outside the package: root `package.json` gets a `"review"` script (the `dev` script is unchanged), `.gitignore` gets `docs/review/**/*-state.json`, root `tsconfig.json` gets `"packages"` in `exclude` (**deviation from the spec**: Next's build type-checks every included `.ts` file and would fail on the package's `.ts`-extension imports; record it in the handover), and `CLAUDE.md` gets one pointer line plus an index row.
- Review mode toggles on **⌃R** (Control+R, `e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r"`), caught in both the shell document and the iframe document.
- Markdown format is exactly the spec's: `# N. Title`, rows `- a. text \`status\``, sub-sub rows ` - 1. text \`status\``, pin line `📍 <path> — ![](asset)`, history lines `Before: …`/`Claude: …`indented under their row, oldest first. Status words:`open`, `review`, `done`. **No** strikethrough, HTML comments or front-matter.
- Files: `docs/review/<topic>/<NN>-<slug>.md`, assets in `docs/review/<topic>/<NN>-<slug>/`, named `<rowId>-pin.png`, `<rowId>-pin.json`, `<rowId>-state.json`, `<rowId>-<original-name>`. `rowId` is `5`, `5.c` or `5.b.1`. `NN` is zero-padded to 2 digits.
- Topic-level bookkeeping lives in `docs/review/<topic>/topic.json`: `{ "nextPoint": number, "retired": string[] }`. Numbers and row labels are never reused.
- The shell's own localStorage keys use the prefix `design-review:` and are excluded from state snapshots.
- Tool URLs live under `/__review/` (`/__review/shell.js`, `/__review/shell.css`, `/__review/api/*`, `/__review/events`).
- Prettier (root `.prettierrc`): run `npx prettier --write <changed files>` after every change. Never run the bare `npm run format`.
- Commit after every task with the attribution line; never amend.

## Review Focus

1. **A hand-edited or Claude-edited file round-trips.** A row missing its status tag reads as `open`; unknown lines under a row (or between rows) are kept verbatim on rewrite; a row whose text ends in a backticked word that is not a status word keeps it as text. Owned by Task 1.
2. **An operation lands on the file as it is now, not as the panel last saw it.** If Claude added a `Claude:` line after the panel loaded, a later Validate keeps the line. Owned by Task 2 (applied against a freshly read file in Task 3).
3. **Deleting the last point or the last child does not free its number.** Delete point 7 (the highest), create a new one: it is 8. Delete `5.d` (the last child), add a child: it is `5.e`. Owned by Task 2.
4. **Topic names come from a text field.** `../x`, `a/b` and empty names are rejected by the server with a 400, never resolved outside `docs/review/`. Owned by Task 3.
5. **Go to pin on an element that no longer exists** still navigates and shows a "pinned element not found" notice instead of throwing. Owned by Task 8.

---

## File Structure

```
packages/design-review/
  package.json            ← private, "type": "module", devDeps esbuild + happy-dom, peerDeps react/react-dom
  tsconfig.json           ← own: allowImportingTsExtensions, noEmit, jsx react-jsx, lib dom
  vitest.config.mts       ← own: include "**/*.test.{ts,tsx}" inside the package
  AGENTS.md               ← Claude's protocol (Task 10)
  model/
    types.ts              ← Status, HistoryEntry, PinRef, Row, Point, TopicMeta, PinRecord
    markdown.ts           ← parsePoint / serializePoint
    labels.ts             ← nextLabel, slugify, pointFileBase, rowIdOf
    ops.ts                ← Op union + applyOp
  server/
    cli.ts                ← argument parsing, spawns the app command, starts the server
    storage.ts            ← topic folders, read/write points, assets, topic.json
    api.ts                ← /__review/api/* routes
    events.ts             ← SSE feed + fs.watch on the review root
    proxy.ts              ← HTTP + upgrade pass-through to the target port
    shellBuild.ts         ← esbuild of shell/main.tsx, rebuilt on change
    server.ts             ← request dispatch: shell vs tool routes vs proxy
    openEditor.ts         ← spawn `code -g file:line`
  shell/
    main.tsx              ← mount
    shell.css             ← all tool styles (plain CSS, loaded as text)
    App.tsx               ← layout: iframe + panel + toolbar + picker layer
    useReviewMode.ts      ← ⌃R in both documents, persisted
    useFrameUrl.ts        ← iframe ↔ address bar mirroring
    api.ts                ← fetch wrappers + useTopicFeed (SSE)
    Toolbar.tsx
    panel/Panel.tsx, panel/TopicSelect.tsx, panel/PointList.tsx, panel/RowItem.tsx, panel/ShortcutHelp.tsx
    drawer/PointDrawer.tsx, drawer/draft.ts
    pick/Picker.tsx, pick/inspect.ts, pick/capture.ts, pick/goToPin.ts
    source/sourceLookup.ts ← Open in VS Code (Task 9, droppable)
```

---

### Task 1: Package scaffold, model types, markdown parse/serialize

**Files:**

- Create: `packages/design-review/package.json`, `tsconfig.json`, `vitest.config.mts`, `model/types.ts`, `model/markdown.ts`
- Test: `packages/design-review/model/markdown.test.ts`
- Modify: root `tsconfig.json` (`exclude` gains `"packages"`), root `package.json` scripts (`"test:review": "vitest run --config packages/design-review/vitest.config.mts"`)

**Interfaces:**

- Produces (`model/types.ts`):
  ```ts
  export type Status = "open" | "review" | "done"
  export type HistoryEntry = { kind: "before" | "claude"; text: string }
  export type PinRef = { path: string; screenshot: string } // as written on the 📍 line
  export type Row = {
    label: string // "a" | "1" — the row's own segment
    text: string
    status: Status
    pin?: PinRef
    history: HistoryEntry[]
    extra: string[] // unrecognised lines under this row, verbatim
    children: Row[]
  }
  export type Point = {
    number: number
    title: string
    status?: Status // tag on the title line, if any
    pin?: PinRef
    history: HistoryEntry[]
    preamble: string[] // unrecognised lines between title/pin and the first row
    rows: Row[]
  }
  export type TopicMeta = { nextPoint: number; retired: string[] }
  export type PinStep = {
    url: string
    path: string
    viewport: { width: number; height: number; dpr: number }
    mouse: { x: number; y: number }
    element: {
      selector: string
      tag: string
      component?: string
      text: string
      rect: { x: number; y: number; width: number; height: number }
      source?: { file: string; line: number }
    }
    inTool: boolean // picked inside the review tool's own UI
  }
  export type PinRecord = { version: 1; at: string; steps: PinStep[] } // list-shaped for future sequences
  ```
- Produces (`model/markdown.ts`): `parsePoint(md: string): Point`, `serializePoint(p: Point): string`.

- [ ] **Step 1: Scaffold.** `package.json` (`"name": "@icfm/design-review"`, `"private": true`, `"type": "module"`, devDependencies `esbuild` and `happy-dom` at current versions, peerDependencies `react`/`react-dom` `^19`). Run `npm install` inside `packages/design-review/` (it gets its own lockfile; commit it). `tsconfig.json`: `strict`, `noEmit`, `allowImportingTsExtensions`, `module`/`moduleResolution` `nodenext`, `jsx: "react-jsx"`, `lib: ["dom","dom.iterable","esnext"]`, `types: ["node"]`. Relative imports inside the package always carry the `.ts`/`.tsx` extension (Node strips types natively and needs it).

- [ ] **Step 2: Write failing tests** in `model/markdown.test.ts`:
  - `parses the spec example`: feed the spec's "Markdown format" block verbatim; expect `number 5`, `title "Main navigation"`, `pin {path:"/concept-08-4/tickets", screenshot:"05-main-navigation/5-pin.png"}`, four rows `a..d` with statuses `done, open, review, open`, row `b.history` equal to `[{kind:"before",text:"Active state is hard to see"},{kind:"claude",text:"100% fails contrast on the hover fill, kept 80%"}]`, row `c.pin.screenshot === "05-main-navigation/5.c-pin.png"`.
  - `round-trips the spec example byte-for-byte`: `serializePoint(parsePoint(x)) === x`.
  - `a row without a tag reads as open`, and re-serializes **with** `` `open` `` appended (the only normalisation allowed).
  - `a trailing backticked non-status word stays in the text`: `` - a. Use `font-semibold` `` → `text "Use \`font-semibold\`"`, `status "open"`.
  - `unknown lines are preserved`: a free paragraph under row `b` and a line between title and first row survive a round trip in place.
  - `sub-sub-points`: `  - 1. text \`open\``under row`b`parses as`b.children[0].label === "1"` and round-trips.

- [ ] **Step 3: Run** `npm run test:review` → FAIL (module missing).

- [ ] **Step 4: Implement** `parsePoint` / `serializePoint`. Line-based: indentation depth (0 / 2 / 4 spaces) decides the level; a row line matches `^(\s*)- ([a-z]+|\d+)\. (.*?)(?: \`(open|review|done)\`)?$`; history lines are `^(\s*)- (Before|Claude): (.*)$`one level deeper than their row; a pin line is`📍 <path> — ![](asset)`at the row's text indent; anything else goes into the nearest`extra`/`preamble`. Serialize in the spec's exact order: row line, pin line, history, extra, children.

- [ ] **Step 5: Run** `npm run test:review` → PASS. Run `npm run build` once to confirm the `tsconfig` exclude keeps Next's type-check green.

- [ ] **Step 6: Commit** `feat(review-tool): package scaffold and the markdown model`.

### Task 2: Labels, numbering and edit operations

**Files:**

- Create: `packages/design-review/model/labels.ts`, `model/ops.ts`
- Test: `model/labels.test.ts`, `model/ops.test.ts`

**Interfaces:**

- Consumes: Task 1 types.
- Produces (`labels.ts`):
  - `rowIdOf(pointNumber: number, path: string[]): string` → `rowIdOf(5, ["b","1"]) === "5.b.1"`, `rowIdOf(5, []) === "5"`.
  - `nextLabel(depth: 1 | 2, taken: string[]): string`: depth 1 = letters `a…z, aa, ab…`; depth 2 = `1, 2, …`; returns one past the highest of `taken` (which includes retired labels).
  - `slugify(title: string): string`: lowercase, ASCII-folded (`ü→u`), non-alphanumerics → `-`, trimmed, max 40 chars, `"point"` if empty.
  - `pointFileBase(n: number, title: string): string` → `"05-main-navigation"`; at least 2 digits (`"123-x"` beyond 99).
- Produces (`ops.ts`):

  ```ts
  export type DraftRow = { text: string; pin?: PinRef; children: DraftRow[] }
  export type Op =
    | { kind: "setStatus"; rowId: string; status: Status }
    | { kind: "refine"; rowId: string; text: string } // old text → Before:, status → open
    | { kind: "editText"; rowId: string; text: string } // silent; only if open and no claude entry
    | { kind: "addChild"; rowId: string; row: DraftRow } // rowId may be the point itself ("5")
    | { kind: "setPin"; rowId: string; pin: PinRef | undefined }
    | { kind: "deleteRow"; rowId: string }
  export type OpResult = {
    point: Point
    retired: string[]
    addedRowIds: string[]
    deletedRowIds: string[]
  }
  export function applyOp(point: Point, op: Op, retired: string[]): OpResult
  export function newPoint(
    number: number,
    title: string,
    rows: DraftRow[],
    pin?: PinRef
  ): { point: Point; rowIds: string[] }
  ```

  `applyOp` throws `OpError` (exported class with `code: "not-found" | "locked"`) for an unknown `rowId` or for `editText` on a row that is not `open` or carries a `claude` entry.

- [ ] **Step 1: Write failing tests:**
  - labels: `nextLabel(1, ["a","b","d"]) === "e"`, `nextLabel(1, ["z"]) === "aa"`, `nextLabel(2, []) === "1"`, `slugify("Größe & Farbe!") === "grosse-farbe"`, `pointFileBase(5,"Main navigation") === "05-main-navigation"`.
  - ops: `refine moves the old text into Before and reopens` (row `c` in `review` → text replaced, history ends with `{before, old}`, status `open`).
  - `editText is refused once Claude has written on the row` → throws `OpError` with code `"locked"`.
  - `addChild after deleting the last child skips the retired label` (Review Focus 3): delete `5.d`, then `addChild` on `"5"` → `addedRowIds` `["5.e"]`, and `retired` contains `"5.d"`.
  - `deleteRow reports every removed descendant id` (`5.b` with child `1` → `["5.b","5.b.1"]`).
  - `setStatus keeps a Claude line written after the panel loaded` (Review Focus 2): apply to a point parsed from a file that has the extra `Claude:` line; the line is still in the serialized output.

- [ ] **Step 2: Run** `npm run test:review` → FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(review-tool): labels, numbering and edit operations`.

### Task 3: Storage

**Files:**

- Create: `packages/design-review/server/storage.ts`
- Test: `server/storage.test.ts` (uses a temp dir from `fs.mkdtemp`)
- Modify: root `.gitignore` (`docs/review/**/*-state.json`)

**Interfaces:**

- Consumes: Tasks 1–2.
- Produces:
  ```ts
  export type Asset = { rowId: string; name: string; dataBase64: string } // name: "pin.png" | "pin.json" | "state.json" | original file name
  export class Storage {
    constructor(root: string) // absolute path of docs/review
    listTopics(): Promise<string[]> // folder names, sorted
    createTopic(name: string): Promise<void> // writes topic.json {nextPoint:1, retired:[]}
    readTopic(topic: string): Promise<{ meta: TopicMeta; points: { file: string; point: Point }[] }> // by number
    createPoint(
      topic: string,
      title: string,
      rows: DraftRow[],
      pin: PinRef | undefined,
      assets: Asset[]
    ): Promise<{ number: number; rowIds: string[] }>
    applyOp(topic: string, pointNumber: number, op: Op, assets: Asset[]): Promise<OpResult>
    deletePoint(topic: string, pointNumber: number): Promise<void>
    assetPath(topic: string, relative: string): string // resolved + checked inside root
  }
  export class StorageError extends Error {
    status: 400 | 404 | 409
  }
  ```
- Behaviour pinned here: every `applyOp` reads the file **fresh** from disk, applies, serializes, writes. Asset file names are `<rowId>-<name>`. Assets in a draft row are given as `rowId`s **relative to the draft** (`"$0"`, `"$0.1"`, paths into `rows`) and translated to the real `rowIds` returned by `newPoint`. `deleteRow`/`deletePoint` delete the matching asset files and add the ids to `topic.json`'s `retired` (point numbers retire as `"7"`). The pin line's `screenshot` is written relative to the topic folder.

- [ ] **Step 1: Write failing tests:**
  - `rejects unsafe topic names` (Review Focus 4): `createTopic("../x")`, `createTopic("a/b")`, `createTopic("  ")` reject with `StorageError` status 400. Allowed: letters, digits, `.`, `-`, `_`, spaces → spaces become `-`.
  - `numbers are never reused` (Review Focus 3): create points 1, 2, 3, delete 3, create → number 4.
  - `createPoint writes the file and assets`: `05-…`-style name for point 5 (seed `nextPoint` 5 in topic.json), `05-main-navigation/5-pin.png` exists, md contains the pin line.
  - `applyOp reads the file fresh`: write a `Claude:` line into the file by hand after `createPoint`, `applyOp(setStatus)`, the line survives.
  - `deleteRow removes the row's assets`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(review-tool): file storage for topics, points and assets`.

### Task 4: Server — proxy, API, change feed, CLI

**Files:**

- Create: `server/proxy.ts`, `server/api.ts`, `server/events.ts`, `server/shellBuild.ts`, `server/openEditor.ts`, `server/server.ts`, `server/cli.ts`
- Test: `server/server.test.ts` (starts a fake upstream `http.createServer` + the review server on ephemeral ports)
- Modify: root `package.json` scripts: `"review": "node packages/design-review/server/cli.ts --port 3000 --target 3001 --root docs/review -- npx next dev -p 3001"`

**Interfaces:**

- Consumes: Task 3 `Storage`.
- Produces:
  - `createReviewServer(opts: { targetPort: number; storage: Storage; shellAssets: () => Promise<{ js: string; css: string }> }): http.Server`
  - Dispatch rule (`server.ts`): `GET` with `sec-fetch-dest: document` and a path **not** under `/__review/` → the shell HTML (`<!doctype html>`, `<link href="/__review/shell.css">`, `<div id="root">`, `<script type="module" src="/__review/shell.js">`). `/__review/*` → tool routes. Everything else (including `sec-fetch-dest: iframe`) → proxy. Upgrade requests → piped raw to the target with `net.connect`.
  - Proxy keeps the `host` header as received (Next must see `localhost:3000`, or its dev-origin check rejects HMR).
  - API (JSON in/out, body limit 50 MB):
    - `GET /__review/api/topics` → `string[]`
    - `POST /__review/api/topics` `{name}` → `{name}` (sanitized)
    - `GET /__review/api/topics/:topic` → `{ meta, points: Point[] }`
    - `POST /__review/api/topics/:topic/points` `{title, rows, pin?, assets}` → `{number, rowIds}`
    - `POST /__review/api/topics/:topic/points/:n/ops` `{op, assets}` → `OpResult`
    - `DELETE /__review/api/topics/:topic/points/:n`
    - `GET /__review/files/:topic/*` → a topic asset (screenshots for the panel)
    - `POST /__review/api/open-editor` `{file, line}` → spawns `code -g <abs file>:<line>`; `file` must resolve inside the repo root
  - `GET /__review/events` → SSE; one `data: {"topic":"<name>"}` message per changed topic, debounced 100 ms, from `fs.watch(root, { recursive: true })`.
  - `shellBuild.ts`: `esbuild.context({ entryPoints: [shell/main.tsx], bundle: true, format: "esm", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, loader: { ".css": "text" }, write: false, minify: false })`, rebuilt when a file under `shell/` or `model/` changes (so self-review iteration needs only a shell reload).
  - `cli.ts`: parses `--port --target --root -- <app command…>`, spawns the app command (inherit stdio), resolves `--root` against `process.cwd()`, creates it if missing, kills the child on `SIGINT`/`SIGTERM`/exit.
- [ ] **Step 1: Write failing tests:** `serves the shell for a top-level document request`; `proxies an iframe document request to the target` (fake upstream answers `"app"`); `proxies a websocket upgrade` (fake upstream echoes on upgrade; assert the echoed bytes); `topic routes round-trip` (POST topic, POST point, GET topic contains it); `rejects path traversal on /__review/files` (`/__review/files/t/../../package.json` → 400); `emits an SSE event when a file in a topic changes`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Manual check:** `npm run review`, `curl -s -H 'sec-fetch-dest: document' localhost:3000/concept-08-4 | head -3` shows the shell; `curl -s -H 'sec-fetch-dest: iframe' localhost:3000/concept-08-4 -o /dev/null -w '%{http_code}'` → `200`. Stop the server by its captured PID (never `pkill next`).
- [ ] **Step 6: Commit** `feat(review-tool): companion server with proxy, API and change feed`.

### Task 5: Shell skeleton — iframe, URL mirroring, review mode, toolbar

**Files:**

- Create: `shell/main.tsx`, `shell/shell.css`, `shell/App.tsx`, `shell/useReviewMode.ts`, `shell/useFrameUrl.ts`, `shell/Toolbar.tsx`, `shell/api.ts`
- Test: `shell/useFrameUrl.test.ts` (happy-dom) for the pure helper below

**Interfaces:**

- Produces:
  - `useReviewMode(frame: HTMLIFrameElement | null): [on: boolean, set: (v: boolean) => void]`, persisted at `design-review:mode`; installs the ⌃R `keydown` listener on the shell `window` **and** on `frame.contentWindow` after every frame `load`, calling `preventDefault`.
  - `useFrameUrl(frame)`: on frame `load` and on `frame.contentWindow.navigation`'s `navigatesuccess`, `history.replaceState(null, "", frameLocationToShellUrl(contentWindow.location))`. Initial `src` = `location.pathname + location.search + location.hash`.
  - `frameLocationToShellUrl(loc: { pathname: string; search: string; hash: string }): string`.
  - `api.ts`: typed wrappers for every Task 4 route, plus `useTopicFeed(topic: string | null, onChange: () => void)` (one `EventSource("/__review/events")`).
  - `Toolbar` props: `{ onPinAndAdd(): void; onNewPoint(): void; onToggleList(): void; onExit(): void; listCount: number }`. Fixed, dark, rounded pill; a grip drags it (pointer events with capture); its position persists at `design-review:toolbar` and is clamped back inside the window on resize.
  - Layout: review off → the iframe is `position: fixed; inset: 0`, no chrome. Review on → flex row: iframe (flex 1) + panel slot (Task 6) + toolbar overlay.
- [ ] **Step 1: Failing test** `frameLocationToShellUrl` keeps path, search and hash; never includes `/__review`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Manual check** under `npm run review`: app usable full-screen; ⌃R shows the toolbar from both a click inside the app and a click on the toolbar; navigating in the app updates the address bar; reload returns to the same page and the same mode.
- [ ] **Step 6: Commit** `feat(review-tool): shell with the app in a frame, review mode and toolbar`.

### Task 6: Feedback panel

**Files:**

- Create: `shell/panel/Panel.tsx`, `TopicSelect.tsx`, `PointList.tsx`, `RowItem.tsx`, `ShortcutHelp.tsx`, `shell/panel/listModel.ts`
- Test: `shell/panel/listModel.test.ts`

**Interfaces:**

- Consumes: `api.ts`, `useTopicFeed`, model types.
- Produces:
  - `listModel.ts`: `flattenRows(points: Point[], filter: "all" | Status): FlatRow[]` with `FlatRow = { rowId: string; depth: 0 | 1 | 2; text: string; status: Status | undefined; pin?: PinRef; history: HistoryEntry[]; inheritedPinFrom?: string }`, and `counts(points): Record<Status, number>`. `inheritedPinFrom` is the nearest ancestor's `rowId` when the row has no pin of its own.
  - `Panel` props: `{ topic: string | null; onTopicChange(t: string): void; onNewPoint(): void; onEditPoint(n: number): void; onGoToPin(rowId: string): void; onRestoreState(rowId: string): void; onOpenSource(rowId: string): void }`.
  - Panel width persisted at `design-review:panel-width` (default 440, min 320, max 70% of the window); the drag handle sits on its left edge and resizes the iframe next to it. Last topic at `design-review:topic`.
  - Header: `TopicSelect` (lists topics; "New topic…" prompts inline with a name suggested from the frame URL's first segment, e.g. `/concept-08-4/x` → `08.4`), **＋ New point**, **Copy prompt** (copies `Work through the open points in docs/review/<topic>/ — follow packages/design-review/AGENTS.md.`), `ShortcutHelp` (keyboard icon, tooltip listing every shortcut of toolbar, picker, drawer and panel). Filter chips: All / Open / To review / Done with counts.
  - `RowItem`: number, text, status tag, 📍 badge (solid when its own, dashed "from 5" when inherited). Hover actions with their key in the tooltip: **Validate** (`V`, op `setStatus done`), **Refine** (`R`, inline field, Enter → op `refine`, Shift+Enter newline, Esc cancels), **🕘** (`H`, expands history **above** the current text, greyed, read-only), and for pinned rows **Go to pin**, **screenshot** (thumbnail popover from `/__review/files/…`), **Restore state** (confirm first), **Open in VS Code** (only when `pin.json` has `element.source`).
  - Keyboard: ↑/↓ move focus between rows; `V`/`R`/`H` act on the focused row; ignored while typing in a field.
  - Live update: refetch the topic on every `useTopicFeed` event.
- [ ] **Step 1: Failing tests:** `flattenRows` gives depths 0/1/2 and `inheritedPinFrom` `"5"` for `5.a` when only `5` is pinned and `undefined` when nothing above is pinned; filter `"review"` keeps only review rows **and their ancestors** (so a sub-point is never shown without its point); `counts` over the spec example → `{open: 2, review: 1, done: 1}`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Manual check:** create a topic, hand-write the spec's example file into it, see it appear without reload; Validate it from the panel and see the file change on disk.
- [ ] **Step 6: Commit** `feat(review-tool): feedback panel with topics, statuses, refine and history`.

### Task 7: Point drawer

**Files:**

- Create: `shell/drawer/PointDrawer.tsx`, `shell/drawer/draft.ts`
- Test: `shell/drawer/draft.test.ts`

**Interfaces:**

- Consumes: `DraftRow`, `Op`, api wrappers, `startPick` from Task 8 (`(mode: "pin") => Promise<CapturedPin | null>`; until Task 8 lands, the pin action is hidden behind `startPick` being undefined).
- Produces:
  - `draft.ts` pure editor state: `type DraftNode = DraftRow & { id: string; savedRowId?: string; files: { name: string; dataBase64: string }[]; capture?: CapturedPin }`; functions `insertSiblingAfter(tree, id)`, `appendChild(tree, id)`, `indent(tree, id)`, `outdent(tree, id)`, `remove(tree, id)`, each returning a new tree. `indent`/`outdent` are no-ops on nodes with `savedRowId` (structure frozen once saved). Max depth 3 (point → letter → number).
  - `PointDrawer` props: `{ topic: string; pointNumber?: number; initialCapture?: CapturedPin; onClose(): void }`. It slides over the panel's list, full panel width. New point: title row + rows; ⌘Enter saves via `POST …/points` (assets: every node's files and captured pin png/json/state). Existing point: saved rows show their text editable only when `open` with no Claude entry (`editText`), otherwise read-only with a hint to use Refine; new rows appended to saved rows are saved with `addChild`; deletes use `deleteRow`.
  - Hover actions per row: ＋ sub, 📎 attach (file input; stored as `<rowId>-<original name>`), 📍 pin/re-pin, 🗑 delete. Enter = new sibling, Tab / Shift+Tab = indent/outdent, ⌘Enter = save, Esc = close (asks only if the draft has content).
- [ ] **Step 1: Failing tests:** `indent turns the next sibling into the last child of the previous one`; `indent is a no-op on a saved node`; `a fourth level is refused`; `remove drops the subtree`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Manual check:** write point with a sub-sub-point and an attachment; the file on disk matches the spec format exactly; the attachment is `5.d-<name>`.
- [ ] **Step 6: Commit** `feat(review-tool): point drawer with outliner keyboard and attachments`.

### Task 8: Picker, capture, Pin & add, Go to pin, Restore state

**Files:**

- Create: `shell/pick/Picker.tsx`, `shell/pick/inspect.ts`, `shell/pick/capture.ts`, `shell/pick/goToPin.ts`
- Test: `shell/pick/inspect.test.ts` (happy-dom)

**Interfaces:**

- Produces:
  - `inspect.ts`: `uniqueSelector(el: Element): string` (prefers `#id`, then `[data-slot]`/`[data-product-tour-id]`/other `data-*` marker attributes, then `tag:nth-of-type` path; must satisfy `el.ownerDocument.querySelector(sel) === el`); `componentName(el: Element): string | undefined` (walks the `__reactFiber$*` key's `.return` chain to the first function/class component's `displayName ?? name`); `describe(el: Element): string` (`component ?? tag`, plus `width×height`).
  - `capture.ts`: `ensureStream(): Promise<MediaStream | null>` (one `getDisplayMedia({ video: true, preferCurrentTab: true })` per shell session, kept for reuse; `null` if refused); `grabPng(stream, crop: DOMRect, outline: DOMRect): Promise<string /* base64 */>` (draws the current frame into a canvas scaled by the track's width / `innerWidth`, crops to `crop`, strokes `outline` in `#e11d48`, 2px); `snapshotLocalStorage(): string` (JSON of every key not starting with `design-review:`).
  - `type CapturedPin = { pin: PinRef; record: PinRecord; png?: string; state: string }`.
  - `Picker`: `startPick(): Promise<CapturedPin | null>`. While active: a full-window layer in the shell with `pointer-events: none` draws the outline + label; `pointermove`/`click` listeners on both the shell document and `frame.contentDocument` (capture phase, `preventDefault` + `stopPropagation` on the click so the app never receives it); elements inside the picker layer itself are skipped; ↑/↓ walk to `parentElement` / first element child; Esc cancels. Elements in the tool's own UI are pickable (`inTool: true`, `path: "(review tool)"`). The drawer is hidden (not unmounted) during a pick; the screenshot crop is the iframe rect, or the whole window for `inTool`.
  - Pin & add: the toolbar button and the shortcut **⌃P** call `startPick()` then open `PointDrawer` with `initialCapture`.
  - `goToPin(frame, record): Promise<"found" | "missing">`: sets `frame.src` when the path differs, waits for `load`, `querySelector(selector)`, `scrollIntoView({ block: "center" })`, outlines it for 2 s; returns `"missing"` when the selector finds nothing (Review Focus 5), and the panel shows "Pinned element not found — the page changed since."
  - Restore state: after confirm, clear every non-`design-review:` key, write the snapshot's keys, reload the frame.
- [ ] **Step 1: Failing tests:** `uniqueSelector` round-trips for an element with an id, one with only a `data-slot`, and a third `<li>` in a list with no attributes; `componentName` returns `"Fake"` for an element given a hand-built `__reactFiber$x` whose `.return.type` is `function Fake(){}`; `snapshotLocalStorage` omits `design-review:` keys.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Manual check:** pin an app element and a toolbar button; both md pin lines and `5-pin.png` with the red outline are right; Go to pin on a deleted selector shows the notice.
- [ ] **Step 6: Commit** `feat(review-tool): inspector picker, screenshots and pins`.

### Task 9: Open in VS Code (spike — drop if unreliable)

**Files:**

- Create: `shell/source/sourceLookup.ts`; modify `pick/Picker.tsx` to fill `element.source`.

**Interfaces:**

- Produces: `sourceOf(el: Element): Promise<{ file: string; line: number } | undefined>`. React-only route: the nearest component fiber's `_debugStack` (React 19 dev) → first frame outside `react`/`react-dom`/`next` → fetch that script URL's source map (`//# sourceMappingURL=` or `<url>.map`) → map with `source-map-js` (add to the package's devDependencies; it is bundled) → strip the bundler's source prefix to a repo-relative path. No Next endpoints.
- [ ] **Step 1:** Implement and try it on five different pins in concept 08.4 (a nav button, a list row, a drawer field, a header control, a plan element).
- [ ] **Step 2: Decide.** If at least 4 of 5 land on the right file and line: keep, wire the panel's **Open in VS Code** to `POST /__review/api/open-editor`, commit `feat(review-tool): open a pinned component in VS Code`. Otherwise revert the files, leave `element.source` unset (the button never shows), and record the finding in `docs/context/design-review-tool.md` — commit `doc(review-tool): open-in-editor dropped, React-only lookup unreliable`.

### Task 10: AGENTS.md, docs, and the self-review topic

**Files:**

- Create: `packages/design-review/AGENTS.md`, `docs/review/design-review-tool/topic.json` (`{"nextPoint":1,"retired":[]}`)
- Modify: `CLAUDE.md` (one line under **Docs — Features & Branches**: "Design review feedback lives in `docs/review/<topic>/`; follow `packages/design-review/AGENTS.md` when asked to work through it."), `docs/context/design-review-tool.md` (final state of the decisions)

- [ ] **Step 1: Write `AGENTS.md`** with these rules, verbatim in substance:
  - Work only on rows whose status is `open`, in the topic you were given. Read the pin's `5-pin.json` / screenshot for location; `*-state.json` restores what he saw.
  - After implementing a row, change its tag to `` `review` ``. Touch nothing else on that line.
  - Add a `- Claude: …` line under a row **only** if the result differs from what he asked, something was not possible, or he must decide something. One line, as short as possible.
  - **Never** write "done", "fixed", "implemented", or a restatement of the request. A row with nothing to report changes status silently.
  - Never edit his text, never renumber, never reorder, never touch `done` rows, never delete `Before:` lines.
  - The terminal recap still happens as usual; it does not repeat what the file notes say.
  - Show the exact format with the spec's example.
- [ ] **Step 2:** Update `CLAUDE.md` and check `wc -c CLAUDE.md` stays under 60k.
- [ ] **Step 3: End-to-end check** under `npm run review`: ⌃R, Pin & add on an app element, two sub-points, save; Validate one; Refine the other; hand-add a `Claude:` line in the file and watch it appear; filters show the right counts; `git status` shows no `*-state.json`.
- [ ] **Step 4: Commit** `doc(review-tool): AGENTS.md protocol and the self-review topic`.
