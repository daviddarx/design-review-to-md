# Design review — Claude's protocol

Applies when asked to work through a review topic (`docs/review/<topic>/`).
Be strict and terse. No chattiness in the files.

## Rules

- Work only on rows tagged `open`, in the topic you were given.
- After implementing a row, change its tag to `review`. Touch nothing else on that line.
- Add a `- Claude: …` line under a row **only** if the result differs from what he asked, something was not possible, or he must decide something. One line, as short as possible.
- **Never** write "done", "fixed", "implemented", or a restatement of the request. A row with nothing to report changes status silently.
- Never edit his text, never renumber, never reorder, never touch `done` rows, never delete `Before:` lines.
- Only ever set `review`. `done` is his.
- Never edit `topic.json`.
- The terminal recap still happens as usual; it does not repeat what the file notes say.

## Where things are

`docs/review/<topic>/<NN>-<slug>.md` is one point; its files are in the folder `<NN>-<slug>/` beside it.

- `<rowId>` is `5`, `5.c` or `5.b.1` (point, row, sub-row).
- `<rowId>-pin.png` — screenshot of what he pinned. May be missing.
- `<rowId>-pin.json` — where it is: `steps[]` with `url`, `element.selector`, `element.component` and `element.source` (`file`, `line`, when known). Read this to find the code.
- `<rowId>-state.json` — localStorage snapshot of what he saw. Gitignored, so it may be missing on another machine.
- `<rowId>-<name>` — attachments he added.
- `topic.json` — counters for the tool. Never edit.

A row with no pin of its own belongs to the pin of its nearest parent.

## Format

```md
# 5. Main navigation

📍 /concept-08-4/tickets — ![](05-main-navigation/5-pin.png)

- a. Icons are too small `done`
- b. Still too faint on hover, make it the brand blue at 100% `review`
  - Before: Active state is hard to see
  - Claude: 100% fails contrast on the hover fill, kept 80%
- c. Search field next to it is misaligned `open`
  📍 /concept-08-4/tickets
  - 1. Left edge `open`
- d. Compare with the reference `open`
  📎 [5.d-reference.png](05-main-navigation/5.d-reference.png)
```

- Row line: ``- <label>. <text> `open|review|done` ``. Sub-rows nest two spaces deeper.
- Pin line: `📍 <path> — ![](<folder>/<rowId>-pin.png)`, or just `📍 <path>` when there is no screenshot. A pin on the review tool itself has the path `(review tool)`.
- `📎 [<file>](<folder>/<file>)` lines are attachments.
- `Before:` is his earlier wording, `Claude:` is yours. Oldest first, under the row.
- Keep every line you do not change byte-for-byte.
