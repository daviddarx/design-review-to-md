export type Status = "open" | "review" | "done"
export type HistoryEntry = { kind: "before" | "claude"; text: string }
// As written on the 📍 line. No screenshot when the render failed:
// the line is then `📍 <path>` alone.
export type PinRef = { path: string; screenshot?: string }
export type Row = {
  label: string // "a" | "1" — the row's own segment
  text: string
  status: Status
  pin?: PinRef
  history: HistoryEntry[]
  extra: string[] // unrecognised lines under this row, verbatim
  children: Row[]
}
export type Point = {
  number: number
  title: string
  status?: Status // tag on the title line, if any
  pin?: PinRef
  history: HistoryEntry[]
  preamble: string[] // unrecognised lines between title/pin and the first row
  rows: Row[]
  folder?: string // the point's asset folder; set by the API, never in the markdown
}
export type TopicMeta = { nextPoint: number; retired: string[] }
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
}
export type PinRecord = { version: 1; at: string; steps: PinStep[] } // list-shaped for future sequences
