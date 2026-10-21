# feat-100 — Design Review Tool — Design

Source briefing: `docs/briefing/design-review-tool/briefing.md`. Everything
below marked _(Claude's call)_ was decided during brainstorming without the
designer stating it; everything else is his.

## Intent

The designer (David) reviews every concept in the browser on localhost and
writes feedback as markdown files: numbered points (`5.`), sub-points
(`5.a`), sub-sub-points (`5.b.1`). Each round he copies the previous file and
annotates every item (`ok`, or a refinement), so neither of us has to restate
where we are. The process works; the copying, the re-typing of context ("the
title above the side nav, on detail pages, when sticky…") and the hunting for
what changed are the redundant parts.

The tool moves that loop into the browser: he points at the thing, writes the
point, and the tool records where it was. Claude reads and answers the same
files. The markdown stays the source of truth and stays pleasant to read raw.

## Goals

- Enter/leave **review mode** with a keyboard shortcut. In review mode the app
  keeps working 1:1.
- Add a numbered point with nested sub-points, any row of which can be
  **pinned** to an element on the page, inspector-style.
- A **feedback panel** beside the app (resizable, and the app genuinely
  narrows next to it) listing every point of the current **topic**, with
  per-row **validate** / **refine** and a **history** of earlier versions.
- Claude reports per row through the same files, under strict rules, and
  flips statuses; the open panel updates live.
- **The tool can review itself** — its own toolbar, panel and drawer can be
  pinned. Its own finalisation feedback is given through it.

## Non-goals (for now)

- Recording a sequence of interactions (future — see _Future_; the data shape
  must not preclude it).
- Use on the deployed Netlify site. Localhost only.
- Migrating the existing `docs/briefing/**/feedback-*.md` files.
- Multi-user, sync, accounts.
- Mobile / touch review.

## Anti-goals — failure even if it works

- **Slower than typing in the md file.** Any common action needing more steps
  than the markdown equivalent is a bug. Keyboard paths for everything common.
- **Less freedom than the md file.** He can always edit the files by hand; the
  tool must tolerate that (hand-written text, reordered lines, a missing tag)
  rather than break or overwrite it.
- **Noisy markdown.** No machine data, no HTML comments, no front-matter in the
  `.md`. Only content, statuses, and Claude's short notes.
- **Chatty Claude notes.** See _AGENTS.md_ below.
- **Any footprint on the app.** No app component, style, store or config
  changes; the tool's styles cannot leak into the app nor the app's into it.

## Vocabulary

- **Topic** — a folder grouping points; chosen manually. Replaces "branch /
  concept / feature" grouping.
- **Point** — a numbered top-level item (`5.`), one markdown file.
- **Sub-point** `5.a`, **sub-sub-point** `5.b.1` — rows inside a point. Depth
  is three levels (point → letter → number).
- **Row** — any of the above.
- **Pin** — the recorded location of a row: URL, viewport, mouse position,
  picked element, screenshot, localStorage snapshot.
- **Status** — `open` → `review` → `done`.

## How it is used

### Review mode and the toolbar

- **⌃R** (Control+R) toggles review mode — the designer's choice; ⌥⇧R is
  taken by Todoist. It must be caught in both the shell and the iframe, and
  must not collide with the app's own cmd+S / cmd+E. Review mode survives a
  reload _(Claude's call)_.
- A small dark floating toolbar, draggable by a grip so it never blocks the
  app: **Pin & add**, **New point**, **List** (toggles the panel), **Exit**.

### Picking (pins)

- Inspector-style, like Chrome DevTools: hovering outlines the element with a
  label (component name if resolvable, else tag, plus size). Click selects.
  Before clicking, ↑/↓ walk to parent/child _(Claude's call)_. Escape cancels.
- The picker can pick the tool's own UI (self-review).
- **Pin & add** (toolbar, and a shortcut) goes straight to picking; the click
  opens a new point whose title row is already pinned.

### Writing a point — the drawer

- New points and edits open in a **drawer inside the feedback panel**, full
  panel width, over the list. Never a popup over the app.
- One drawer = one point. The title row is `N.`; rows below are sub-points.
- Hovering any row shows its actions: **＋ sub** (adds a child at the end of
  that row), **📎 attach**, **📍 pin / re-pin**, **🗑 delete**. There is no
  global "add point" inside the drawer — the next point comes from the toolbar
  after saving this one.
- Outliner keyboard _(Claude's call)_: Enter = new sibling below, Tab /
  Shift+Tab = indent / outdent, ⌘Enter = save.
- **Pin inheritance:** any row may carry a pin; rows below it without their
  own pin use the nearest pinned ancestor's. A row with no pin anywhere above
  it is a general note — URL and viewport are still recorded _(Claude's call)_.
- Attachments: any file, saved as `<row>-<original-name>.<ext>`, e.g.
  `5.d-reference.png`.
- Numbers are assigned in save order and **never shift** when a point or row
  is deleted _(Claude's call — "5" must keep meaning the same thing in
  conversation)_.

### The feedback panel

- Only in review mode. Docked right; dragging its edge resizes it **and the
  app next to it** (the app's viewport really narrows — media queries and
  `position: fixed` drawers respond).
- Header: **topic selector** (lists topic folders; switching back to an older
  topic is just selecting it; **New topic** suggests a name from the current
  URL's concept, editable; reopens on the last-used topic), **＋ New point**,
  **Copy prompt** (copies e.g. _"Work through the open points in
  docs/review/08.4-look-n-feel/"_ for pasting into Claude Code) _(Claude's
  call)_.
- Filters: All / Open / To review / Done, with counts.
- Rows show number, current text, status tag, pin badge. Hover actions:
  **Validate**, **Refine**, **🕘 history**.
- **Refine**: he types the new text; it becomes the row's current text; the
  previous text moves into history; status → `open`.
- **History** (🕘, also on hover): expands earlier versions and Claude's notes
  **above** the current text, greyed out, read-only.
- Keyboard _(Claude's call)_: ↑/↓ move between rows, `V` validate, `R`
  refine, `H` history.
- **Shortcut reminder** (designer's request): a small keyboard icon in the
  panel header shows every shortcut (toolbar, picker, drawer, panel) in a
  tooltip; each action's own tooltip also names its key.
- Pinned rows offer: **Go to pin** (navigates to the URL, outlines the
  element), **screenshot** preview, **Open in VS Code** (see constraints),
  **Restore state** (writes the localStorage snapshot back; asks for
  confirmation first — Go to pin never restores on its own, since that would
  wipe current work) _(Claude's call)_.
- The panel updates live when files change on disk (Claude's edits, hand
  edits).
- No "rounds": per-row history replaces the copy-the-file habit _(Claude's
  call)_.

## Files on disk

Root: `docs/review/` _(Claude's call)_. One folder per topic, one `.md` per
point, one asset folder per point (created only when needed):

```
docs/review/08.4-look-n-feel/
  05-main-navigation.md
  05-main-navigation/
    5-pin.png           ← screenshot, element outlined     (committed)
    5-pin.json          ← url, viewport, mouse, selector…  (committed)
    5-state.json        ← localStorage snapshot            (GITIGNORED)
    5.c-pin.png
    5.c-pin.json
    5.c-state.json
    5.d-reference.png   ← attachment                       (committed)
  06-font-weights.md    ← general point, no folder
```

- File names: zero-padded number + slug of the title. Every asset is prefixed
  with its row number.
- `*-state.json` is gitignored (local only — the 07.x/08.x apps store ~2 MB;
  committing it per pin would bloat history). Screenshots and pin JSON are
  committed.

### Markdown format

Exactly this shape — the designer approved it:

```md
# 5. Main navigation

📍 /concept-08-4/tickets — ![](05-main-navigation/5-pin.png)

- a. Icons are too small `done`
- b. Still too faint on hover, make it the brand blue at 100% `open`
  - Before: Active state is hard to see
  - Claude: 100% fails contrast on the hover fill, kept 80%
- c. Search field next to it is misaligned `review`
  📍 /concept-08-4/tickets — ![](05-main-navigation/5.c-pin.png)
- d. Compare with [5.d-reference.png](05-main-navigation/5.d-reference.png) `open`
```

- Status: an inline-code tag at the end of the row line: `open`, `review`,
  `done`.
- Pin: a line under the row, `📍 <path> — ![](screenshot)`.
- History: indented lines under the row, oldest first, `Before:` for his
  earlier versions and `Claude:` for Claude's notes. **Not `~~strikethrough~~`**
  — he asked for `Before:`.
- Sub-sub-points nest one level further, `1.`, `2.` …
- The title row's own status, if needed, follows the same tag rule.
- The parser must be tolerant: a hand-edited file missing a tag reads as
  `open`; unknown lines are preserved verbatim on rewrite.

## Claude's side — `AGENTS.md`

The package ships an `AGENTS.md` that the repo's `CLAUDE.md` points to. It
defines the protocol, and it is **restrictive by design**:

- Work the rows whose status is `open` in the given topic.
- After implementing a row: set it to `review`.
- Add a `Claude:` line **only** when the result differs from what was asked,
  was not possible, or needs his decision. **Never** "done", "fixed", or a
  restatement of the request. One line, as short as possible. A row with
  nothing to report just changes status, silently.
- Never edit his text, never renumber, never touch `done` rows.
- The terminal recap still happens as usual; the file notes do not replace it.

## Constraints

- **The app's codebase is untouched.** The tool lives in
  `packages/design-review/` with its own `package.json`, importing nothing from
  `src/` and imported by nothing in `src/`. Later this folder becomes its own
  repo/package; until then it stays here so it can be used on the concepts
  immediately _(Claude's call)_.
- **The end product is React-only, not Next-specific.** The overlay must work
  in any React app; no dependency on Next internals.
- **Style isolation both ways:** the overlay renders in a Shadow DOM.
- **A small companion Node server** (designer chose this over Chrome's
  File System Access API): writes markdown and assets, watches the review
  folder and pushes changes to the panel, opens files in VS Code. Also proxies the dev server — see _How the overlay reaches the page_.
- **Open in VS Code:** implement **only if achievable React-only** — i.e.
  without Next's dev endpoints. Expected route: React 19 dev builds record
  where each element was created (`_debugStack` on the fiber); mapping that to
  a source file/line through the dev build's source maps, then the companion
  server launches the editor. If this proves unreliable, drop it rather than
  fall back to Next internals.
- **Screenshots:** must capture what he actually sees, element outlined.
  _(Claude's call, builder to verify)_ Prefer real pixels via
  `getDisplayMedia({ preferCurrentTab: true })`, asking once per review
  session; DOM-re-rendering libraries are a fallback only, as they misdraw
  fonts and canvas (the plans are canvas).
- **Real resize of the app beside the panel** — via the iframe shell below.
- Localhost only; desktop Chrome is the target browser.
- Project rules apply: Prettier, Tailwind-free inside the shadow root is fine,
  `npm run test` (vitest) for the parser/serializer and numbering.

## First deliverable includes self-review

As soon as the tool runs, a topic `design-review-tool` exists and the designer
finalises the tool through the tool. That means picking inside the tool's
shadow root works from day one.

## Future (inform the shape, don't build)

- Record a **sequence** (several clicks/steps), not just one element. Keep the
  pin record a list-capable structure so a sequence is a pin with many steps.
- Extract `packages/design-review/` into its own repo and install it here.

## How the overlay reaches the page — decided

Shrinking `<html>` with CSS does not narrow the viewport: media queries and
`position: fixed` overlays still use the full window. Only an iframe gives the
app a genuinely narrower viewport. So (designer approved):

- The companion server serves the **review shell** (toolbar + panel + drawer)
  and shows the app in an **iframe on the same origin**, reverse-proxying the
  Next dev server (HTML, assets, HMR websockets). It injects a small in-frame
  agent (picker, shortcut relay, localStorage access) into HTML responses, so
  **the app has no mount line at all**.
- **The shell takes `:3000`**; Next runs on a hidden port behind it. He starts
  with `npm run review` instead of `npm run dev` — same address, same
  localStorage. With review mode off the iframe fills the window and no chrome
  shows.
- The address bar mirrors the iframe's URL (and a reload restores it).
- The `getDisplayMedia` stream lives in the shell, so it survives iframe
  reloads and HMR.
- Self-review: the picker must work in both documents — the app inside the
  iframe and the tool's own shadow root in the shell.
- The core overlay stays React-only and host-agnostic; only the proxy knows
  which dev server it fronts (configurable target).

## Editing saved points _(Claude's call, settled after the builder check)_

- A saved row's text can be edited in the drawer **silently** (no `Before:`)
  as long as it is `open` and carries no `Claude:` note — it is still a draft
  nobody has acted on. Once Claude has touched it (status `review` or a note
  exists), the only way to change its text is **Refine**, which writes history.
- **Structure is frozen once saved**: no indent/outdent or reordering of saved
  rows (that would renumber them and orphan their assets). New children can
  still be appended to any row; Tab/Shift+Tab apply to unsaved rows only.
- Deleting a saved row is allowed; its number is retired, never reused, and
  its assets are deleted with it.

## Tooling boundaries _(Claude's call, settled after the builder check)_

- The package has **its own** `tsconfig`, vitest config and test script; the
  app's `tsconfig.json`, `vitest.config.mts` and `eslint.config.mjs` are not
  touched. Allowed outside the package: a `.gitignore` line for
  `*-state.json`, a sibling script in `package.json`, a pointer to the
  package's `AGENTS.md` in `CLAUDE.md`.
- Tailwind v4 already scans `docs/`, so class-like words in feedback text can
  compile into dead CSS rules. That is the existing behaviour for every
  briefing file and is accepted; `globals.css` is not touched. The package
  itself uses no Tailwind.

## Left to the builder

- Internal state management, component structure, transport between overlay
  and server (WebSocket or SSE), parser implementation.
- Exact visual design — the designer will review it live, through the tool.
- How `npm run review` starts Next on the hidden port and the shell on
  `:3000` (the existing `dev` script stays as it is).
- Slug rules, zero-padding width (2 digits until 99).
