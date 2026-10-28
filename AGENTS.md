# Design review — Claude's protocol

Applies when asked to work through a review: the folder the prompt names, `<root>/<review>/` (`<root>` is the `--root` the app passes, usually `docs/review`).
Be strict and terse. No chattiness in the files.

## Before you start

1. Read every `open` row of the review first — its `briefing.md`, pin screenshots and `pin.json`, attachments, and the code they point to. Change nothing yet.
2. Note what is unclear: a row that reads two ways, rows that contradict each other, a design decision he has not made, a pin you cannot find in the code, a request that would break something else.
3. Nothing unclear: go ahead. Otherwise ask in the terminal before touching any code — one question at a time, naming the row (`5.c`), multiple choice when you can, your recommendation first. Wait for his answer before the next question.
4. Ask only what changes what you build; a sensible default is not a question. Questions and answers stay in the terminal, never in the files. If he leaves it to you, decide.

## Rules

- Work only on rows tagged `open`, in the review you were given.
- After implementing a row, change its tag to `review`. Touch nothing else on that line.
- Add a `- Claude: …` line under a row **only** if the result differs from what he asked, something was not possible, or he must decide something. One line, as short as possible.
- **Never** write "done", "fixed", "implemented", or a restatement of the request. A row with nothing to report changes status silently.
- Never edit his text, never renumber, never reorder, never touch `done` rows, never delete `Before:` lines.
- Only ever set `review`. `done` is his.
- The terminal recap still happens as usual; it does not repeat what the file notes say.

## Where things are

`<root>/<review>/<NN>-<slug>/` is one feedback: its `briefing.md` and, beside it, every file below. Links in `briefing.md` are relative to that folder.

- `<rowId>` is `5`, `5.c` or `5.b.1` (feedback, row, sub-row).
- `<rowId>-pin.png` — screenshot of what he pinned. May be missing.
- `<rowId>-pin.json` — where it is: `steps[]` with `url`, `element.selector`, `element.component` and `element.source` (`file`, `line`, when known). Read this to find the code. `file` is repo-relative; when it is a bare file name with `candidates` (several repo files share that name), the code is in one of those paths. A step with `frames[]` was pinned inside nested iframes (a Storybook story): each entry's `selector` names the iframe in the document above it and `url` what it showed; `element.selector` is then relative to the innermost one.
- `<rowId>-state.json` — localStorage snapshot of what he saw. Gitignored, so it may be missing on another machine.
- A row can have several pins, one `📍` line each. The files above belong to its first; the k-th pin's are `<rowId>-pin-k.png`, `<rowId>-pin-k.json` and `<rowId>-state-k.json`.
- `<rowId>-<name>` — attachments he added.

A row with no pin of its own belongs to the pin of its nearest parent.

## Format

```md
# 5. Main navigation `open`

📍 /concept-08-4/tickets — ![](5-pin.png)

- a. Icons are too small `done`
- b. Still too faint on hover, make it the brand blue at 100% `review`
  - Before: Active state is hard to see
  - Claude: 100% fails contrast on the hover fill, kept 80%
- c. Search field next to it is misaligned `open`
  📍 /concept-08-4/tickets
  - 1. Left edge `open`
- d. Compare with the reference `open`
  📎 [5.d-reference.png](5.d-reference.png)
```

- Row line: ``- <label>. <text> `open|review|done` ``. Sub-rows nest two spaces deeper.
- The title line carries a tag too (``# 6. Font weights `open` ``): it is the feedback as a whole. With no rows, treat it as a row. With rows, set it to `review` once none of them is left `open`. An older title without a tag has nothing to set.
- Pin line: `📍 <path> — ![](<rowId>-pin.png)`, or just `📍 <path>` when there is no screenshot. A pin on the review tool itself has the path `(review tool)`.
- `📎 [<file>](<file>)` lines are attachments.
- `Before:` is his earlier wording, `Claude:` is yours. Oldest first, under the row.
- A `- Claude:` (or `- Before:`) line goes **exactly two spaces deeper than the row it belongs to** — its indent is what assigns it to that row. Under a sub-row that is four spaces:

  ```md
  - c. Search field next to it is misaligned `open`
    - Claude: note on c
    - 1. Left edge `review`
      - Claude: note on c.1
  ```

- Keep every line you do not change byte-for-byte.
