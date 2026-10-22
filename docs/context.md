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
- **No `topic.json`** (his call, after seeing the counter as working-copy
  noise). The point files are the only record: the next point is the highest
  file number + 1, a new row label is past its highest sibling. So deleting
  the LAST point or row frees its number for reuse; a gap in the middle stays
  a gap. `model/ops.ts` still computes `retired` ids, which storage no longer
  persists (it passes `[]`).
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
- **Wording: Review › Feedback** (his pick). Everything he reads says
  "review" for a `docs/review/<name>/` folder and "feedback" for one numbered
  item (＋ New feedback, Feedback 3, Delete feedback). Earlier bullets of
  this record still say `topic` / `point`; the code no longer does (below).
- **No floating toolbar** (his call: "not useful"). Review mode shows the
  panel only; ⌃R enters and leaves it, ⌃P is Pin & add (no button for it
  outside the drawer's 📍). ＋ New feedback sits at the right end of the
  status filter bar; the shortcut reminder is at the panel's bottom right and
  opens upward. The panel's open-count callback went with the toolbar.
- **A title-only feedback is tagged `open` on its title line** at creation,
  so it counts, filters and reaches Claude like a row (AGENTS.md says so).
- **List rows** (his layout): every row has a separator below it and no
  hover fill. The full row id sits in its own grid column
  (`minmax(5ch, max-content)`); beside it, line 1 holds the status tag, pin
  badges and always-visible icon actions at the right (`shell/panel/icons.tsx`,
  tooltip from `data-tip`), and the text, history and files below start at
  the tag's edge. Validate and Refine show only on a `review` row, History
  only on a row with history; no V/R/H keys (↑/↓ stays). The filter bar is
  tabs left (wrapping, never shrinking) and ＋ New feedback right, aligned on
  the first baseline. The shortcut icon is a bordered button the size of the
  header's buttons, bottom right. Drawer rows keep the old look.
- **Never commit `docs/review/`** — his feedback files are his to commit,
  unlike the briefs CLAUDE.md asks to be committed with their fixes.
- **Drawer motion copies the app's sheets** (`src/components/ui/sheet.tsx` +
  08.4's `c084-overlay`): it slides in from the right over 300ms ease-in-out,
  no fade, over a slate-500/45% backdrop with a 2px blur that fades in 150ms;
  on close both run backwards. The panel keeps the closed drawer rendered
  (inert, same tree position) until the slide-out's `animationend`.
- **Drawer row actions** are the list's icon buttons (`ActionButton` in
  `shell/panel/icons.tsx`) at the right of the field. Every icon action, list
  and drawer, is a bordered 28px square, the height of `.dr-button`.
- **Names follow the UI** (briefing-feedback-1): `Feedback` / `ReviewMeta`
  types, `FeedbackList`, `FeedbackDrawer`, `ReviewSelect`; API routes
  `/reviews/:review/feedbacks/:n`. The selected review is stored as
  `design-review:review`; the old `design-review:topic` is still read. The
  review-mode flag in `App` is `reviewMode`, since `review` is the name.
- **Several pins per row.** A row or title holds any number of `📍` lines,
  in order. Pin k's files are `<rowId>-pin.png|json` + `<rowId>-state.json`
  for k = 1 and `<rowId>-pin-k.*` / `<rowId>-state-k.json` after
  (`model/pins.ts`); removing one moves the later files down, so the number
  is always the line's position. Ops `addPin` (the client names the files as
  a first pin's; the server renames them to the slot it took), `removePin`
  (by index; the drawer removes last first), `attach` (no-op carrying files).
  `setPin` is gone. The drawer's pin button adds a pin each time; its count is
  a red pill on the button.
- **Every new title is tagged `open`**, rows or not: the feedback as a whole
  is a thing to do. AGENTS.md: Claude sets it to `review` once none of its
  rows is left `open`. Older untagged titles have nothing to set.
- **List rows**: no 📍 badges. _Show pins_ (the pin icon) shows the row's
  pins while hovered and keeps them on when clicked (and goes to the first
  pin's page); one row's at a time, pressed on every row sharing that owner.
  Screenshot and _Restore corresponding app state_ open in a `Flyout`
  (`shell/panel/Flyout.tsx`: fixed, right-aligned under its button, flips
  above, as wide as the text column); the screenshot one closes when the
  pointer leaves its button. Icon actions are one joined group
  (`ActionGroup`, the app's ButtonGroup look). Feedback number bold, its
  text regular; a sub-row's number stays in the column and only the content
  indents. ＋ New feedback is primary. No ↑/↓ row keys any more.
- **Drawer**: numbers as they will be saved (`displayIds` — new rows take
  the label after their siblings, a new feedback the next free number) in a
  fixed column; only the field indents, files at its left edge; fields are
  regular weight. Every pin of the feedback, saved (records fetched on load)
  or new, is drawn on the page; hovering one shows ×, a click removes it.
  Discard and delete answer through the header's two buttons. Files dropped
  on the attach button are attached. The keys sit in a footer bar as tall as
  the list's.
- **The slide's jump** was focus, not easing: focusing a field while the
  drawer was still translated scrolled the `overflow: hidden` layer sideways.
  The layer is `overflow: clip` and focus passes `preventScroll`.
- **Maps in screenshots**: WebGL canvases drop their pixels once composited,
  so modern-screenshot's `toDataURL` saw the Swiss map blank. The shell
  patches each frame document's `getContext` (`keepCanvasPixels`, polled per
  animation frame so it lands before the app asks) to pass
  `preserveDrawingBuffer: true` to WebGL contexts. A map created before the
  patch stays blank until a reload.
- **Hover replay**: hovering a pin (and switching Show pins on) dispatches the
  pointer/mouse over+enter events a real hover sends to the pinned element,
  or its nearest ancestor on the page (`replayHover`), and out+leave after —
  enough for React `onPointerEnter` state (the 08.4 nav bar), never CSS
  `:hover`. The hovered pin holds its place meanwhile, or the app moving
  under it would end the hover and restart it in a loop.
