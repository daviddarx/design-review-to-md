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
  the retired ids.
- **`*-state.json` is gitignored** (localStorage snapshots, ~2 MB on 07.x/08.x).
- **Open in VS Code is a spike** (plan Task 9): React-only via `_debugStack` +
  source maps, dropped if unreliable. Next's dev endpoints are off-limits — the
  end product must work in any React app.
