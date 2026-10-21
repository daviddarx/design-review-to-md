# Design Review Tool — `packages/design-review/`

Decision record for feat-100: the in-browser review tool that replaces the
copy-the-feedback-file loop. Read this before touching `packages/design-review/`
or `docs/review/`.

Branch `feat/100-design-review-tool`, briefing
`docs/briefing/design-review-tool/briefing.md`, spec
`docs/superpowers/specs/2026-10-21-feat-100-design-review-tool-design.md` and
plan beside it.

## Decisions (planning)

- **Not a concept.** It sits outside the fork chain, touches nothing in `src/`,
  and gets no version-history section (that file lists concept variants).
- **Shell + proxy, no injection.** `npm run review` puts the companion server
  on `:3000` and `next dev` on `:3001`. A top-level document request gets the
  review shell; the shell shows the app in a same-origin iframe; everything
  else is proxied, HMR websockets included. Same origin means the same
  localStorage as plain `npm run dev` on `:3000`. The shell reaches into
  `iframe.contentDocument` for picking, ⌃R and URL mirroring, so nothing is
  injected into the app's HTML.
- **The shell document is the style isolation.** The spec named a Shadow DOM;
  with the app in an iframe the tool's UI is already in its own document, so
  neither side's CSS can reach the other.
- **One allowed edit to app config:** root `tsconfig.json` excludes `packages`.
  Next's build type-checks every included `.ts`, and the package's
  `.ts`-extension imports (needed for Node's native type stripping) would fail
  it.
- **Markdown is the source of truth.** Every write reads the file fresh,
  applies one operation, and writes it back, so Claude's and hand edits are
  never clobbered by a stale panel. Unknown lines round-trip verbatim.
- **Numbers and labels are never reused** — `topic.json` keeps `nextPoint` and
  the retired ids. It is **gitignored** (his call: no counter noise in the
  working copy). The next number is never below the highest point file + 1,
  so a fresh checkout only risks reusing the number of a point deleted on
  another machine.
- **`*-state.json` is gitignored** (localStorage snapshots, ~2 MB on 07.x/08.x).
- **Open in VS Code is a spike** (plan Task 9): React-only via `_debugStack` +
  source maps, dropped if unreliable. Next's dev endpoints are off-limits — the
  end product must work in any React app.

## Decisions (build)

- **No HTML injection.** The shell reaches into the same-origin iframe; the
  proxy never rewrites the app's HTML. The shell document is the isolation.
- **Shortcuts: ⌃R** toggles review mode (caught in the shell and the iframe
  document); **⌃P** is Pin & add, works in text fields too, and with a drawer
  open it appends a pinned top-level row instead of opening a second drawer.
- **Pin line without image.** If the screenshot render fails or times out the pin
  is still recorded: `📍 <path>` alone. `(review tool)` is the path for pins on
  the tool's own UI.
- **Attachments** are linked by the server as `📎 [<file>](<folder>/<file>)` on
  a line under their row (the point's own go in the preamble); his text is never
  rewritten. The line is preserved on rewrite and not added twice.
- **Folder in the topic read.** `GET /topics/:topic` adds `folder` to each point
  so the shell finds `<rowId>-pin.json` / `-state.json` when the pin line has no
  screenshot. Inherited-pin rows use the ancestor's files.
- **`GET /__review/api/repo-root`** lets the shell record a pin's source
  repo-relative from a source map's `file://` path.
- **Open in VS Code is kept, with known limits:** the fiber half (React
  `_debugStack`) was only simulated, never tried in a browser; a shadcn
  `Button` opens `components/ui/button.tsx` (host fiber call site); the first
  pick can add up to 1.5 s while source maps load. Maps are refetched every
  pick, keyed by full URL.
- **Refine joins its text to one line** (a multi-line row would break the md).
  Markdown file names are fixed at creation: refining a title does not rename.
- **An open drawer is never remounted** by New point / Pin & add, and leaving
  review mode keeps panel and drawer mounted (hidden) so a draft survives.
- **`npm run review` cannot run beside another `next dev` in the same
  checkout** (Next's dev lock). Stop the other one first.
- **Prettier's tailwind plugin trims leading spaces** in template-literal class
  strings inside this package; build class lists from arrays instead.
- **Claude's protocol** is `packages/design-review/AGENTS.md`; the repo's
  `CLAUDE.md` points to it. This tool gets no `version-history.md` section.
- **Self-review topic:** `docs/review/design-review-tool/` holds the tool's own
  feedback, starting from an empty `topic.json`.
- **Screenshots are rendered from the DOM** (`modern-screenshot`), not captured
  from the screen: `getDisplayMedia` made Chrome ask to share the tab and then
  pin a "Sharing this tab" bar to the window, which he ruled out. The cost is
  fidelity — the picture is a re-render, so a font, image or canvas the
  library cannot embed can differ from the screen. The app and the shell are
  rendered separately and composited; capped at 5 s.
- **Pin markers** (`shell/pick/PinMarkers.tsx`): a red teardrop whose tip is
  the click, for every pin made in the open drawer and for the hovered list
  row's pin. It sits at the click's relative spot inside the element, so it
  follows scrolling and resizing; with the element gone it falls back, faded
  and dashed, to the click's recorded viewport position. A drawer reopened on
  a saved point shows no markers for its saved pins (their records are not
  loaded there). Screenshots carry a matching dot.
- **Go to pin on a tool pin** first takes the app back to the page it was on
  (from the step's shell `url`), then outlines the tool element if it is
  open. A missing app element is no longer an error: the notice points at the
  faded pin and at Restore state.
