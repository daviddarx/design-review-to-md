# design-review-to-md

Review a running web app in the browser and save the feedback as markdown
files that a coding agent (Claude Code, Codex…) works through.

You click on what's wrong, write what should change, and the tool stores it
in your app's repo with a screenshot and where the element lives in the code.
The agent fixes it and marks it for review. You validate it or refine it.

## Getting started

Requires Node ≥ 24.2. The app must run on a dev server (React 19 for the
"open in editor" source lookup).

1. Clone this repo next to the app's repo:

   ```
   Gits/
     design-review-to-md/
     my-app/
   ```

2. In the app's `package.json`, add a script that starts the tool around the
   app's own dev server. `{target}` is replaced by the port the app should
   listen on:

   ```json
   "review": "npm --prefix ../design-review-to-md install --no-audit --no-fund && node ../design-review-to-md/server/cli.ts --root docs/review -- npx next dev -p {target}"
   ```

3. In the app's `.gitignore`, add `docs/review/**/*-state.json` (the app
   state snapshots stay on your machine). With another `--root`, use that
   folder instead of `docs/review`.

4. `npm run review`, then open the URL it prints.

Each checkout gets its own pair of ports, derived from its path, so several
worktrees can run side by side. `--port` and `--target` override them.

`--markers data-testid,data-tour-id` names the attributes your app puts on
elements to identify them, best first. A pin's selector uses them before
anything else, so it still finds the element after the layout changes.
Without it, the first other stable `data-*` attribute is used.

## Core concepts

- **Shell and frame.** The tool serves a page that shows your app in a
  same-origin iframe and proxies everything else to the dev server, HMR
  included. Nothing is injected into the app.
- **Review mode** (⌃R) opens the panel beside the app. Off, the app fills the
  window as usual.
- **Review.** A folder of feedback, such as one per version or round:
  `docs/review/<review>/`.
- **Feedback.** One numbered topic, `<NN>-<slug>/briefing.md`, with rows and
  sub-rows. Its screenshots, pin records and attachments sit in the same
  folder.
- **Pin** (⌃P, or the pin button beside _New feedback_). Pick an element in
  the app. The tool saves a screenshot, the page and selector, the React
  component and its source file and line, and a snapshot of localStorage, so
  the agent can find the code and you can find the spot again later. While
  you pick, a box in the app's bottom-right corner shows the element's
  rendered size, then the width, height, margin, padding, colors, border
  color and font size its stylesheets set, as written (`var(--space-4)`, not
  `16px`). The pin's screenshot carries the same box.
  An element inside a same-origin iframe in the app can be pinned too — a
  Storybook dev server, say, where every story renders in
  `#storybook-preview-iframe` inside the manager: the pin records the chain
  of iframes down to the element (`frames` in its JSON record, with the
  story iframe's URL) beside the manager's own address, so Show pins, the
  markers, hover replay and the source lookup find it again. A cross-origin
  iframe is left alone.
  The source file is recorded repo-relative: when the app's source map names
  only a basename (Vite does for a workspace-linked package), the tool
  searches the repo for it and records its path, or keeps the name with
  every match as `candidates` when several files share it.
- **Status.** Every row is `open` (yours to hand over), `review` (the agent
  has done it) or `done` (you validated it). From the panel you can edit an
  open feedback in the drawer, validate or refine a row to review (the old
  wording is kept as `Before:`), devalidate a done row, or delete any row.
- **Handing over.** _Copy prompt_ puts a one-line instruction on the
  clipboard. Paste it into the agent, which follows [AGENTS.md](AGENTS.md):
  it first reads every `open` row and asks you, one question at a time,
  about anything unclear; then it works only on `open` rows, sets them to
  `review`, and adds a `Claude:` note only when something differs from what
  you asked.

## Developing

```
npm install
npm test          # vitest
npm run typecheck
npm run format
```

`server/` is the CLI, proxy, API and markdown storage; `shell/` is the
browser UI (bundled with esbuild on the fly, so a reload shows a change;
server changes need a restart); `model/` is the markdown format and its
operations. Decisions and their reasons are in
[docs/context.md](docs/context.md).

## Reviewing a deployed site

For a site you cannot run locally, such as a colleague's deployed branch
behind SSO. Needs macOS and Chrome, with you logged in to the site there.

```
npm run review:remote
npm run review:remote -- --url https://stage.example.com/app/page
```

Without `--url` it asks for the URL. Then open the address it prints
(`http://localhost:<port>/<the page you typed>`, port in 4900–5699, one per
site).

- **Login.** The tool reads the site's cookies from Chrome's profile and
  keeps them in memory only; nothing is written to disk. macOS asks once to
  let `node` read "Chrome Safe Storage" from the Keychain: choose _Always
  Allow_. With several Chrome profiles holding cookies for the site, it asks
  which one.
- **Session expired.** The frame shows "Session expired: log in to <host> in
  Chrome, then reload." Log in again in Chrome and reload; no restart.
- **Files.** Feedback goes to `~/Desktop/design-review-to-md/<site>-<n>/`, one
  folder per round, in the usual format. State snapshots stay outside, in
  `~/Desktop/design-review-to-md/.state/`.
- **Rounds.** Run it again after the colleague redeploys. If the latest round
  is finalized, it asks `Continue round <n> or start round <n+1>? [C/n]`.
  A new round carries the previous feedback over with every `open` row set
  to `review` (asked of the colleague, not checked by you yet): validate it
  or refine it as usual.
- **Canvas spots.** Pinning a `<canvas>` (a map, a WebGL app) also records
  where you clicked in it, as a fraction of its size. An empty layer laid
  over the whole canvas (an Avalonia app does this) counts as the canvas.
  The screenshot carries a ring there; Show pins and Go to pin place it
  again.
- **Finalize review** replaces _Copy prompt_. It writes three files into the
  round and opens the folder:
  - `index.html`: what is still to do, for the colleague to read without the
    tool. Each row's number (`1`, `1.a`, `1.a.1`) sits in a left column, with
    its text, its badge (_New_, _Refined_, _Still open from last round_), the
    `Before:` wording of a refined row, the pinned page as a full link to
    the site, the screenshots and the attached files (under _Attached data_) beside it. Done rows
    are left out. Several pins of one row on the same page show as one
    screenshot with all of them on it, numbered. Clicking a screenshot shows
    it 1:1, at the size it was on your screen; one bigger than the window
    follows the mouse.
  - `readme.md`: the instruction to paste into the colleague's agent.
  - `PROTOCOL.md`: the rules that agent follows. The review files are
    read-only to it; you see its work on the redeployed site.

  Check them, then zip the folder yourself and send it. Press it again after
  an edit: it overwrites the three files.
