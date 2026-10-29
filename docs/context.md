# Design Review Tool — decision record

> **Moved.** This record was written while the tool lived in the icfm-hooping
> repo at `packages/design-review/` (the paths below say so). It is now this
> repository: `packages/design-review/` is the repo root, the briefings are
> `docs/briefing/`, the spec and plan are `docs/design.md` and `docs/plan.md`.
> New decisions are appended at the end, under their own headings.

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
  on `:3000` and `next dev` on `:3001` (since briefing-feedback-9: on the
  checkout's own pair, see there). A top-level document request gets the
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
  Feedback folder names are fixed at creation: refining a title does not rename.
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
- **Look** (briefing-feedback-2): Tailwind slate for every grey (shadows
  too); a 20px gutter (`--dr-gutter`); panel and drawer headers on the panel's
  grey, no white.
- **List**: the status pill sits right, before the actions, 28px tall like
  them at the same type size; Edit is always the last action. Separators are
  drawn above each row (`::before`): a feedback's across the panel, a
  sub-row's from where its parent's text starts (`gutter + 5ch + 6px`, plus
  16px per level). Attached files are an icon (`files`) whose hover opens a
  flyout of links; a 200ms grace keeps it open across the gap. The
  screenshot flyout sizes to the picture (`Flyout` takes `maxWidth`), image
  only with a shadow. `Copied` gets a check icon.
- **Which pins show**: one set at a time — the open drawer's; else the row
  being hovered or switched on with Show pins; else, idle, every pin of the
  review (the panel fetches every record with each load and hands them up
  through `onAllPins`). "Display out the existing pins of the other points"
  was read as _hide_ them while the drawer is open.
- **Drawer**: the whole row is the drop target for files (highlighted);
  sub-rows indent 24 / 48px; file chips are grey like the status tags.
- **List rows, third take** (briefing-feedback-3): a three-column grid —
  number | body | actions. The body opens with the status tag (floated, 28px
  like the buttons; the text's first line, `line-height: 20px` after a 4px
  top pad, is centred on it), then history, then the files as grey chips (no
  files button any more). The actions keep their places from row to row: Edit
  is last, and a row without it (every sub-row) leaves an empty 28px slot.
  Every sub-row's separator starts at the feedback's text.
- **Screenshot flyout**: click toggles it (Esc / a press outside close it,
  the pointer leaving does not); each picture opens in a new tab. `Flyout`
  stays hidden until its pictures have loaded — a picture arriving late
  widened the right-aligned box and it slid in from the right.
- **Moving saved rows** (`moveRow`): Tab / Shift+Tab work on saved rows in
  the edit drawer (a saved row only goes under a saved one). The row goes
  last under its new parent with the next label; its files are renamed with
  it, and its pin and 📎 lines follow, re-indented by the depth change.
  `buildOps` now applies every planned op to a copy of the feedback with the
  model's own `applyOp` (`simulate`), so a later op addresses a moved row by
  its new id; rows coming up to the top level move before rows going down
  (a row may not take along a sub-row that is leaving it); the drawer's
  numbers come from the same simulation, so they are what the save writes.
  Files added to saved rows go in one `attach` op before the moves, never
  riding on the first op (it might move the row the file belongs to).
- **The drawer shows a row's saved files** (from its 📎 lines) as link chips.
- **List rows, fourth take** (briefing-feedback-4): number | text | actions
  stays; under the text a line of the attached files as underlined grey links
  and the small status tag at its end; History opens below that. Edit is a
  primary button. A sub-row's separator starts at its own text (`gutter + 5ch
  - 6px + 16px` per level), per his "should" screenshot.
- **The flyout's slide from the right, actually**: `Flyout` was placed by
  `left = anchor.right − width`, and a fixed box sized to its content shrinks
  to the room left of the viewport's edge — so each frame's new `left` made
  it narrower, and the next frame moved it again until it settled. It is
  anchored by `right` now. (Round 3's wait-for-images guess was wrong; it
  stays, as a picture loading late would widen the box too.)
- **Saved files can be removed in the drawer**: × on the pill, `removeFile`
  on save (drops the 📎 line, deletes the file — only a file named for that
  row).
- **List rows, fifth take** (briefing-feedback-5): the files sit on a line of
  their own (`dr-row-files`), the status tag on the line below
  (`dr-row-meta`). Show pins appears only on the row that owns the pins — no
  longer on the rows inheriting them (Screenshot / Restore / source still
  follow the inherited pin). Spacing: no top padding on `dr-panel-body`, 8px
  top and bottom on list rows, 8px above the actions.
- **Drawer saved-file pills, again reported missing**: rendered the drawer in
  happy-dom against the live server's own JSON for his review — 1.a.2's pill
  and its × are there. The brief's line is carried over from rounds 3–4;
  nothing changed.
- **Briefing-feedback-6**: the status tag line sits 8px under what is above
  it (4px more). Show pins switches off on a press anywhere else in the panel,
  like the screenshot flyout (`data-pins-toggle` marks the buttons that
  handle it themselves; presses in the app frame do not count — "the
  module" read as the panel). Drawer in/out 25% faster (slide 300 → 225ms,
  backdrop fade 150 → 112ms). Copy prompt now also asks to commit
  `docs/review/<review>/` as it is before making the changes. From this round
  on, a round's briefing files are committed first, in their own commit.
- **Briefing-feedback-7**:
  - **Pins inside a click-opened popup** (his favourites popover): the
    element only exists while the popup is open, and its selector was
    anchored on the popup's React id (`#_r_2_ > …`). The pick now records
    `openers` on the step — each open popup's trigger (`aria-expanded="true"`
    whose `aria-controls` names an ancestor), outermost first, with the
    popup's id at the time. Go to pin, when the element is absent but the
    first trigger is there, `.click()`s each closed trigger (Base UI's
    `useClick` opens on a click with no pointer type), reads its
    `aria-controls` and rewrites `#old` to `#new` in the selectors still to
    use. Pins made before this carry no `openers` and must be re-pinned.
    Hover-opened menus (the main navigation) keep using `replayHover`.
  - Drawer slide and backdrop fade use the tested app's Sheet curve,
    `cubic-bezier(0.4, 0, 0.2, 1)` (`--dr-ease`), keeping round 6's 225 /
    112ms.
  - The status tag line has 8px below it too.
  - Copy prompt: "Commit review folder (docs/review/<review>) and work
    through its open feedbacks — follow packages/design-review/AGENTS.md."
- **No more pins on the tool itself** (his call: "we'll finish the review of
  it the older way"). The picker only takes elements of the frame's document;
  a hover over the tool clears the outline and a click on it is swallowed and
  pins nothing (the pick goes on; Esc ends it). New steps always carry
  `inTool: false`. Reading old `(review tool)` pins (Go to pin, markers,
  hover replay) is left in place, so existing ones still work. Tests stand the
  frame in for the test document and mock `modern-screenshot` — a real render
  walks back into the document through that frame and runs out of memory.
- **Show pins finds the pin by itself** (his "globally, so that I don't have
  to figure out each edge case"; Restore "should always do it as soon as the
  pin can't be displayed"). `goToPin` now:
  1. goes to the pin's full address — path, query **and hash** (the app
     mirrors its surfaces in the URL; the work panel is `#wp/<id>`). The
     hash was dropped before, which is why a work-panel pin never opened the
     panel. A change of hash alone is followed by a reload, as the app may
     not react to a same-page hash change it did not make;
  2. reopens the popups the element was picked in (`openers`);
  3. still missing: puts back the localStorage snapshot saved with the pin
     (`restoreState`, required parameter) and reloads at the address, then
     tries 2 again — the panel says the app data was replaced.
     The Restore button, its confirm flyout and the `restore` icon are gone.
     What this does not cover: state that lives only in memory (not in the URL,
     not in localStorage) and opens on something other than an
     `aria-expanded`/`aria-controls` trigger. State files are gitignored, so on
     another machine step 3 is skipped. Old tool pins keep their path-only
     behaviour.
- **Pins no longer anchor on React's generated ids** (his item 4: the pin
  marker kept its x when the work panel was open). On client-mounted
  components `useId` follows mount order, so `base-ui-_r_5_` names another
  trigger once the work panel mounted first; the marker found nothing and fell
  back to the recorded click, which does not move. `uniqueSelector` now skips
  `_r_…_` / `:r…:` / `«r…»` ids (with any `base-ui-` prefix) unless they are a
  popup id in `popupIds`, which `openersOf` and `stepOf` pass so the element's
  path still anchors on its popup. The markers resolve those popup ids through
  the open triggers (`followOpeners`, shared with `goToPin`'s renaming), and a
  pin whose popup is closed sits by its trigger, at the offset recorded in the
  new optional `PinOpener.rect`. Pins made before this keep the old ids and
  must be re-pinned.
- **A pick hands its pin back at once** (his "the pinning take some time …
  no indicator"). The screenshot (modern-screenshot renders the whole app
  DOM) and the source-map lookup (up to `LOOKUP_MS`, maps refetched every
  pick) were awaited before the drawer opened. Now `capture` returns the pin
  straight away and both finish in the background, writing `png` and
  `element.source` into the same objects; `CapturedPin.finishing` settles
  when they are in, and the drawer's save awaits every capture's
  `finishing` first, so a quick save still carries its picture. The two
  frames spent hiding the picker layer are gone: only the frame's document
  is rendered, so the shell's layers were never in the picture. A spinner
  (`.dr-pin-loader`) sits at the click until `finishing` settles.
- **Go to pin's outline is under the pin.** It moved out of `.dr-picker`
  into its own `.dr-flash-layer` (z 2147483400, below `.dr-markers`); the
  pick's hover outline, label and hint stay above everything.
- **Copied lines up with Copy prompt.** `.dr-swap` was baseline-aligned, and
  "Copied" leads with its icon, whose bottom edge became the baseline and
  lifted the label. It is now top-aligned and centred, and the icon overhangs
  the text line (`margin: -4px 0`) instead of growing it.
- **The panel sits below the app**: a 12px slate fade along its left edge
  (`.dr-panel::before`, z 2, no pointer events). It is an overlay rather than
  an inset `box-shadow`, which the header and drawer backgrounds would cover.
  The resize edge moved to z 3 to stay above it.

### briefing-feedback-8

- **Refine is one line with a joined Save button.** The textarea became an
  `<input type="text">` (Enter still sends, Esc still cancels) followed by an
  icon-only `ActionButton` (`save` icon, Lucide's floppy disk; tooltip
  "Save"), the two joined like the row's action group (`.dr-refine-group`:
  the field loses its right radius, the button its left radius and border).
- **The page shows the filter's pins.** On All, every pin but the done ones;
  on a status tab, that status's. Only Done was specified; Open and To review
  following their own status is my reading. A pin counts as matching when
  its own row or any row inheriting it (`inheritedPinFrom`) does, so a done
  row's pin still shows on All while a row under it is open. `Panel`
  recomputes on filter change (`filter` in the effect's deps).

### briefing-feedback-9

- **Tabs are underlined, not pills** (`.dr-tab`, was `.dr-chip`). The bar
  lost its vertical padding so the tabs run its full height; the active
  line is a 3px `::after` from the text's left to its right (the padding
  excluded) at `bottom: -1px`, over the bar's own border. No gap between
  tabs, 8px side padding instead, the first tab's left padding 0.
- **The bold switch no longer moves the tabs.** Each label carries
  `data-reserve` with its own text; `.dr-tab-label::after` lays that text
  out in bold, invisible and 0px tall, under the real label, so the label
  is always as wide as its bold self. `content: attr() / ""` keeps the copy
  out of the accessible name (the plain `content` before it is the
  fallback). The count stays regular weight and outside the reserve.
- **Edit stands apart**, after the group in `.dr-row-side` with an 8px
  gap; a sub-row's empty slot follows the same gap. The primary style is
  now keyed on `.dr-row-side > .dr-action-primary`.
- **Rows: 4px top and bottom** instead of 8px.
- **Refine sits on the actions' line.** While refining, `.dr-row-body`
  (`.dr-row-refining`) spans columns 2 to the end, and the field group
  takes the actions' 8px top margin; a sub-row's group ends with an empty
  Edit slot, so Save lands where the last group button was.
- **Status pills**: fully round (999px; "100%" would make elliptical
  corners on a wide box), 1px border `color-mix(currentColor 25%)`, line
  16px so they stay 18px tall. Open is blue (`#dbeafe` / `#1e40af`).
- **Separators follow should-2.png**: a sub-row's line starts at the text
  of the SHALLOWER of it and the row above (adjacent-sibling rules on the
  depth classes); a feedback's line crosses the panel.
- **Narrow layout (< 540px)** (replaced in briefing-feedback-10): a
  container query on `.dr-panel-body` (`dr-list`). The row grid drops its actions column, `.dr-row-body`
  becomes `display: contents`, and `order` stacks text, files, actions,
  status tag, history in column 2; the depth indent moves onto each child.
  The flyout width now measures `.dr-row-text`, since a `contents` box has
  no width.
- **On All, a done row's pins never show**, even when an open row under it
  uses them (feedback-8 still showed them then). Status tabs keep the
  covering rule: on Open, a done row's pin shows for its open sub-row.
- **`npm run review` ports per checkout.** Without `--port`/`--target`,
  `cli.ts` hashes the checkout path (FNV-1a) to an even port in 4100–4898
  for the review server, the next one for `next dev` (the script passes
  `-p {target}`); a taken pair steps to the next. Clear of 3000/3001 and
  worktrunk's `hash_port` range. Consequence: the review origin is no longer
  `:3000`, so its localStorage is its own, not plain `npm run dev`'s.
  `next dev`'s per-checkout lock still applies: worktrunk's server for the
  same worktree must be stopped first.

### briefing-feedback-10

- **Tab counts** are bold 10px in an 18px white circle (a pill past one
  digit), 6px from the label (+4). A 1px `--dr-line` border outlines the
  circle: the bar's `#f8fafc` alone barely shows a white disc. The active
  tab's count takes the text colour. Tabs are 10px side padding (+4 between
  them); the active line's insets moved with it.
- **Narrow layout, second take.** The `display: contents` stacking is gone:
  under 540px the row's grid drops its actions column, the text column keeps
  the full width (text, files, status tag together), and `.dr-row-side`
  lands on its own grid row in column 2, `justify-self: end`, so the actions
  stay right-aligned. The status tag's 8px bottom margin spaces them. While
  refining, the field keeps the text's place (no 8px top margin) and drops
  the Edit slot. The flyout width measures `.dr-row-body` again.
- **Claude's latest note is visible on a row to review.** When a row's
  status is `review` and its last history entry is a `Claude:` line, that
  line renders under the text (`.dr-row-note`, muted); History lists only
  the entries before it, and is not offered when nothing is left. Any other
  status leaves every note in History: a refined row goes back to `open`,
  so its old note drops into History until the next round answers it.

### briefing-feedback-11

- **The active tab's line is a 1px underline of its label**
  (`text-decoration`, offset 3px, skip-ink off), the count left out. The
  3px bar on the tab bar's bottom edge is gone, so the tabs no longer
  stretch: each is 28px tall and the bar is back to 8px vertical padding.
- **The bar wraps top-aligned, New feedback first.** `.dr-filters` wraps
  with `align-items: flex-start`; the tabs' container is `flex: 0 1 auto`,
  so its basis is its one-line width and the button breaks onto its own
  line before the tabs give anything up. They shrink and wrap (`min-width:
0`) only once alone on the line. The button keeps `margin-left: auto`, so
  it stays at the right when it wraps.
- **Validate is offered on every row not done**, `open` included: a refined
  row goes back to `open`, and he wanted to be able to close one without
  another round. Refine stays on `review` rows only. This supersedes the
  "Validate and Refine show only on a `review` row" line above.

### One folder per feedback

- **`<NN>-<slug>/briefing.md`** replaces `<NN>-<slug>.md` beside its asset
  folder (his request: one entry per feedback in VS Code's tree, no name
  twice). A feedback is a numbered folder holding a `briefing.md`; a
  numbered folder without one, or a loose `.md`, is ignored. Delete removes
  the folder.
- **Links in the file are relative to the folder** (`![](5-pin.png)`), so
  they open from the briefing itself. In memory and for the shell they stay
  review-relative (`05-nav/5-pin.png`): `fromBriefing`/`toBriefing` in
  `server/storage.ts` move pin screenshots and `📎` links across on read and
  write (`path.posix` normalize/relative; URLs and absolute paths left as
  they are). The model, ops, API and shell are unchanged.
- No migration code: no review was ever committed. His working copy was
  moved by hand (links rewritten by text, every other byte kept).

### Devalidate

- **A done row offers Devalidate** (Lucide's undo arrow, in the group where
  Validate sits on other rows). It sets the status the row had before this
  session validated it — `Panel` remembers it per `review:rowId` in a ref
  when a `setStatus done` succeeds — and `review` for a row validated
  before the session (or before a reload). The tooltip names the target
  ("Devalidate: back to open").
- **Refine's icon is now Lucide's message-square-text**: its old reply arrow
  read too close to Devalidate's undo arrow.
- **Every listed row's pin records load with the list**, not on hover. Open
  in VS Code is drawn only once a record names a source, and the hover
  prefetch left it to appear under the pointer — on every row whose pins
  the page was not already showing (done rows on All, for one). `Panel`
  loads the owner pins of the rows in the current filter on each load.

### briefing-feedback-12

- **No Edit in the list.** A feedback is changed by Refine from now on; the
  drawer is reached only through New feedback (and Pin & add). Its edit mode
  (`feedbackNumber`) stays in `FeedbackDrawer`, unreached, with its tests.
  Adding a sub-row to a saved feedback is gone with it, as he accepted.
- **Delete on every row**, after the group with the 8px gap Edit had, so
  every row now ends on the same button (the empty Edit slot is gone). It
  asks for a second click on the same button: the first arms it (red,
  tooltip "Click again to delete"), leaving or blurring the button disarms
  it. A feedback row deletes the feedback and its folder
  (`deleteFeedback`), a sub-row goes by `deleteRow` (its files with it).
- **Refine adds pins and files.** The field's group is now field · Pin ·
  Attach · Save (primary, `.dr-action.dr-action-primary`), so Save sits
  where Delete is. Pins come from the same picker (`startPick`, threaded
  App → Panel → FeedbackList → RowItem), counted on the Pin button; files
  list under the field with ×, pin file names refused as in the drawer.
  Save sends the new text (`refine`, only if it changed), then one
  `addPin` per pin (assets named as a first pin's — the server renumbers),
  then one `attach`; each pin that went through leaves the draft, so a
  retry after a failure sends nothing twice. Esc drops all of it.
- **Show pins' markers come off on hover/click**, like the drawer's:
  `App` builds them with `onRemove` → `removePin` at the pin's index, then
  redraws the remaining ones (the later pins moved down one place) and
  reloads the list. No automated test: it needs a real frame layout.
- **History reads request, then answer.** The file stays in time order,
  where a `Claude:` note precedes the `Before:` of the text it answered (the
  text only becomes a Before when refined, after the note). `historyByRound`
  (`listModel.ts`) regroups it for the History list: each Before, then the
  notes written while it was current; notes on the current text stay last.
  Moving the Before ahead of the notes on disk was tried and reverted: after
  two rounds the notes on the old and the current text both trail the last
  Before and cannot be told apart.
- **Several screenshots open as a list.** One pin's screenshot still floats
  as the picture itself; with two or more, the Screenshot flyout
  (`.dr-shot-list`) is a white card as wide as the text column (the width
  a single picture may take), one line per pin: a 56×36 thumbnail (top-left
  crop) and the file name, truncated in the middle (the head ellipsises, the
  last 10 characters — pin number and extension — always show). Each line
  opens its picture in a new tab. Attachments are not in it; they keep
  their links under the text.

## Own repository (2026-10-26)

- **Moved out of icfm-hooping** so other projects can use it. History came
  along with `git filter-repo` (the package, this record, the briefings, the
  spec and the plan; their paths rewritten as noted at the top). The app
  repo keeps none of it.
- **Not published.** An app reaches it as a sibling checkout:
  `node ../design-review-to-md/server/cli.ts` in its `review` script, with
  `npm --prefix ../design-review-to-md install` first. It is deliberately not
  in the app's `package.json`: a `file:` dependency would break the app's CI
  install (Netlify has no sibling folder), and a git dependency would need a
  push and a reinstall for every adjustment.
- **Own dependencies.** React, esbuild, vitest, TypeScript and Prettier used
  to come from the app's `node_modules`; they are now this package's.
  `@types/node` ^24 and Node ≥ 24.2, for `import.meta.main`.
- **The copied prompt asks the server where things are.** `GET repo-root`
  also returns `reviews` (the `--root`) and `agents` (this `AGENTS.md`), both
  relative to the app's repo, so the prompt reads e.g.
  `follow ../design-review-to-md/AGENTS.md`. Copy prompt stays disabled until
  that answer arrives.
- **Ready line** is matched case-insensitively, so a Vite app's
  `ready in` also triggers the printed review URL.

## App-specific settings (2026-10-26)

- **`--markers <a,b>`** replaces the hard-coded `data-slot`,
  `data-product-tour-id`, `data-testid` priority list in `inspect.ts`, which
  named icfm-hooping's own attributes. Default: none, so any non-volatile
  `data-*` attribute is taken in DOM order, as before for the unlisted ones.
  icfm-hooping passes its three in its `review` script.
- **Settings reach the shell inside its document**: the server writes a
  `<script id="dr-config" type="application/json">` into the shell HTML and
  `shell/main.tsx` applies it before the first render. No fetch, so there is
  no window where a pick could run on the defaults. `<` is escaped.
- `createReviewServer`'s `markers` is required, not defaulted, so a future
  caller cannot silently drop it.
- **"New review…" suggests the first path segment as is**, made a valid
  folder name (`/concept-08-4/x` → `concept-08-4`). The `concept-NN-N` →
  `NN.N` rule was icfm-hooping's and is gone, on his "do not add logic here".

## Nested iframes — Storybook (2026-10-27)

- **Why.** A Storybook 10 dev server renders every story in a nested
  same-origin iframe (`iframe.html?id=…`, `#storybook-preview-iframe`)
  inside its manager. The shell only reached into `frame.contentDocument`,
  so a pin landed on the manager chrome, never on the component.
- **How.** `shell/pick/frames.ts` treats the app as a tree of same-origin
  documents, walked top-down over `iframe.contentDocument` (null for a
  cross-origin frame, which is skipped; no `frameElement`, which happy-dom
  lacks and a browser does not need). A pick records `PinStep.frames` — the
  iframes between the app's document and the element's, outermost first,
  each as its selector in the document above and the URL it showed (the
  story's). `url`, `path` and `viewport` stay the app's own (the manager's
  `?path=/story/…`, what URL mirroring and the 📍 line use), `mouse` and
  `element.rect` are in the element's document, so they match each other.
  Go to pin, the markers (offsets of the nested frames added) and hover
  replay resolve the chain with `resolveFrames` each time they look; the
  picker, ⌃R/⌃P and the canvas patch listen on every document of the tree
  as it appears (`watchDocuments`, polled per animation frame: a nested
  frame loads after its parent and a navigation brings a new document with
  no event the shell could hear; while the tab is hidden, where animation
  frames stop, a 500ms timer looks instead — guarded on `document.hidden`,
  since the look is slow enough in happy-dom to time App's tests out).
  **Screenshots**: `renderViewport` renders every same-origin iframe's
  document on its own and draws it over the frame's content box, as the
  shell does with the app. Left to modern-screenshot, the frame's document
  is inlined as a block where the iframe element was, and an inline iframe
  sits on a baseline, so the story landed ~20px below the outline. The cost
  is the iframe's own border, which goes with the skipped element. Any
  depth works; one level is what Storybook needs.
- **Compatibility.** A record without `frames` is the app's own document,
  so every earlier pin reads as before; the markdown 📍 line is untouched.
  A chain that cannot be followed (frame gone, cross-origin) reads as the
  element missing, like a page not showing; the marker then falls back to
  the recorded click.
- **Not done.** The source lookup runs on the story's element as on any
  other (fibers and script URLs are per document); whether Vite's inline
  source maps resolve to a repo path was not verified in a browser. The
  `url` of a frame is recorded, not used to navigate: the manager's address
  already selects the story.

## Bare source names — Vite workspaces (2026-10-27)

- **Why.** Storybook 10 (Vite) with components from a pnpm workspace
  package: the module's inline source map lists only `Button.tsx`, so a pin
  recorded `source: { file: "Button.tsx", line: 91 }`, which an agent cannot
  open.
- **How.** A mapped source with no `/` keeps the script URL it came from;
  the shell asks `GET /__review/api/resolve-source?name=&from=`. The server
  (`server/findFiles.ts`) lists the repo's files with `git ls-files
--cached --others --exclude-standard` (so `.gitignore` holds), or walks it
  outside git, always skipping `node_modules`, `dist`, `storybook-static`
  and `.git`; the matches for a name are cached for the server's life. One
  match → its repo-relative path. Several → the one the script URL ends in
  (Vite serves the module at `/@fs/<absolute path>` or under its root), else
  the basename plus `source.candidates` (every match). None → the basename.
  The repo searched is the server's `repoRoot` (cwd), as for open-editor.
- **Awaited, not patched.** The pick already hands its pin back at once and
  finishes the source in the background (`finishing`, which a save awaits),
  so the resolution runs there, right after the map lookup, with its own
  3 s bound: the drawer never waits, and the saved record has the final
  path without a second write. A search that fails or is late leaves the
  basename.
- **The script URL matters.** icfm-ds-naked has six `Button.tsx` (five
  under `scripts/fixtures`); a unique-match rule alone would leave its pins
  on `candidates`. Checked against a live Vite 6 + React 19 dev server
  through the CLI (its map does list the bare `Button.tsx`): the lookup,
  run in Node with a stack built from the served module, recorded
  `src/components/actions/Button/Button.tsx`. Not driven in a browser.

## Edit is back, for open feedbacks (2026-10-29)

- **Why.** A feedback just created could not be corrected: Refine only
  shows on a row to review, and the drawer was reached only through New
  feedback.
- **Edit feedback** sits on an open feedback's own row (an untagged older
  title counts as open), before the group, with the 8px gap; never on its
  rows, nor on a feedback to review or done. It opens the same drawer as
  New feedback, in its edit mode (`feedbackNumber`), with every row.
- **Validate only on a row to review**, beside Refine: an open row has
  nothing of Claude's to validate. Devalidate therefore always has a
  `review` row behind it in practice; its memory of the earlier status
  stays.
