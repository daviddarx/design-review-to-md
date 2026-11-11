# Design review — your agent's protocol

Applies to this folder: one round of a design review of a deployed site, sent to you to fix in your own repo.
Be strict and terse.

## Before you start

1. Read every `open` and `review` row first — its `briefing.md`, pin screenshots and `pin.json`, attachments, and the code they point to. Change nothing yet.
   - Open every `briefing.md` and scan every row. A row to do can sit in any feedback, whatever its title's tag. Never pick feedbacks by their title.
2. Note what is unclear: a row that reads two ways, rows that contradict each other, a design decision not made, a pin you cannot find in the code, a request that would break something else.
3. Nothing unclear: go ahead. Otherwise ask the colleague in the terminal before touching any code — one question at a time, naming the row (`5.c`), multiple choice when you can, your recommendation first. Wait for the answer before the next question.
4. Ask only what changes what you build; a sensible default is not a question. If it is left to you, decide.

## The files are read-only

- Fix in your own repo. Never edit, add or delete anything in this folder.
- Never change a tag, never write `Claude:` lines, never touch `Before:` lines.
- The reviewer sees the result on the redeployed site, not in these files.
- `index.html` shows the same rows with their screenshots, for a human; it is not the source.

## Statuses

- `open`: new, or refined. A refined row has `- Before:` lines under it: its text is the request now, the newest `Before:` what was asked last round. Rework what was built for it; do not start from scratch or build it twice.
- `review`: asked last round and not checked yet. Fix it if it isn't already.
- `done`: checked. Leave it.

## Finding the code

- `pin.json` → `steps[]`: `url` and `path` are the page; `element.selector` (built on `data-testid` first), `element.text` and `element.rect` find the element on it.
- `element.component` is the minified name from the deployed build: a hint, not a name to search for. There is no `source`.
- A step with `frames[]` was pinned inside nested iframes: each entry's `selector` names the iframe in the document above it and `url` what it showed; `element.selector` is then relative to the innermost one.
- Canvas pins: when `element.tag` is `canvas`, the pin marks a spot in a drawn surface. `mouse` relative to `rect` is the spot, and the screenshot's red dot shows it.

## Where things are

`<NN>-<slug>/` is one feedback: its `briefing.md` and, beside it, every file below. Links in `briefing.md` are relative to that folder.

- `<rowId>` is `5`, `5.c` or `5.b.1` (feedback, row, sub-row).
- `<rowId>-pin.png` — screenshot of what was pinned. May be missing.
- `<rowId>-pin.json` — where it is (see above).
- A row can have several pins, one `📍` line each. The files above belong to its first; the k-th pin's are `<rowId>-pin-k.png` and `<rowId>-pin-k.json`.
- `<rowId>-<name>` — attachments.

A row with no pin of its own belongs to the pin of its nearest parent.

## Format

```md
# 5. Main navigation `open`

📍 /tickets — ![](5-pin.png)

- a. Icons are too small `done`
- b. Still too faint on hover, make it the brand blue at 100% `open`
  - Before: Active state is hard to see
- c. Search field next to it is misaligned `review`
  📍 /tickets
  - 1. Left edge `open`
- d. Compare with the reference `open`
  📎 [5.d-reference.png](5.d-reference.png)
```

- Row line: ``- <label>. <text> `open|review|done` ``. Sub-rows nest two spaces deeper.
- The title line carries a tag too: the feedback as a whole. With no rows, treat it as a row. A title tagged `done` can still hold rows to do.
- Pin line: `📍 <path> — ![](<rowId>-pin.png)`, or just `📍 <path>` when there is no screenshot.
- `📎 [<file>](<file>)` lines are attachments.
- `Before:` lines are earlier wordings, oldest first; `Claude:` lines are notes from the reviewer's own agent.
