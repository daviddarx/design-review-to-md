// A row's pins are numbered by their position on it: the first pin's files
// are `<rowId>-pin.png`, `<rowId>-pin.json` and `<rowId>-state.json`, the
// k-th's (k ≥ 2) `<rowId>-pin-k.png`, `<rowId>-pin-k.json`, `<rowId>-state-k.json`.
// A remote round also keeps `<rowId>-plain.png` (`-plain-k.png`): the same
// picture without its marks, for index.html to draw a row's pins on together.
export type PinFile = "png" | "json" | "state" | "plain"

export function pinAssetName(index: number, file: PinFile): string {
  const n = index === 0 ? "" : `-${index + 1}`
  if (file === "state") return `state${n}.json`
  if (file === "plain") return `plain${n}.png`
  return `pin${n}.${file}`
}

const PIN_ASSET =
  /^(?:pin(?:-([1-9]\d*))?\.(png|json)|state(?:-([1-9]\d*))?\.json|plain(?:-([1-9]\d*))?\.png)$/

// Which pin and which of its files `name` is, or null for any other name.
export function parsePinAssetName(name: string): { index: number; file: PinFile } | null {
  const m = PIN_ASSET.exec(name)
  if (!m) return null
  const k = m[1] ?? m[3] ?? m[4]
  const file = m[2] ? (m[2] as PinFile) : name.startsWith("state") ? "state" : "plain"
  return { index: k ? Number(k) - 1 : 0, file }
}
