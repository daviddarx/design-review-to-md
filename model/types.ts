export type Status = "open" | "review" | "done"
export type HistoryEntry = { kind: "before" | "claude"; text: string }
// As written on the 📍 line. No screenshot when the render failed:
// the line is then `📍 <path>` alone.
export type PinRef = { path: string; screenshot?: string }
export type Row = {
  label: string // "a" | "1" — the row's own segment
  text: string
  status: Status
  pins: PinRef[] // one 📍 line each, in order
  history: HistoryEntry[]
  extra: string[] // unrecognised lines under this row, verbatim
  children: Row[]
}
export type Feedback = {
  number: number
  title: string
  status?: Status // tag on the title line, if any
  pins: PinRef[]
  history: HistoryEntry[]
  preamble: string[] // unrecognised lines between title/pin and the first row
  rows: Row[]
  folder?: string // the feedback's asset folder; set by the API, never in the markdown
}
export type ReviewMeta = { nextFeedback: number } // derived from the feedback files, never stored
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
  // The triggers of the popups the element was in, outermost first: Go to
  // pin clicks them open again. `controls` is the popup's id when picked.
  openers?: PinOpener[]
  // The same-origin iframes between the app's document and the element's,
  // outermost first (a Storybook story sits in `#storybook-preview-iframe`
  // inside the manager). `url`, `path` and `viewport` above are the app's
  // own document's; `mouse` and `element.rect` are in the element's
  // document's viewport. Absent on a pin in the app's own document — every
  // pin made before this field existed reads as one.
  frames?: PinFrame[]
}
// `selector` finds the iframe in the document above it; `url` is what it
// showed when picked (the story's `iframe.html?id=…`).
export type PinFrame = { selector: string; url?: string }
// `rect`: the trigger's box when picked, so a pin whose popup is closed sits
// by its trigger, wherever that moved (absent on pins made before it).
export type PinOpener = {
  selector: string
  controls: string
  rect?: { x: number; y: number; width: number; height: number }
}
export type PinRecord = { version: 1; at: string; steps: PinStep[] } // list-shaped for future sequences
