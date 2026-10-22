// A row's pins are numbered by their position on it: the first pin's files
// are `<rowId>-pin.png`, `<rowId>-pin.json` and `<rowId>-state.json`, the
// k-th's (k ≥ 2) `<rowId>-pin-k.png`, `<rowId>-pin-k.json`, `<rowId>-state-k.json`.
export type PinFile = "png" | "json" | "state"

export function pinAssetName(index: number, file: PinFile): string {
  const n = index === 0 ? "" : `-${index + 1}`
  return file === "state" ? `state${n}.json` : `pin${n}.${file}`
}

const PIN_ASSET = /^(?:pin(?:-([1-9]\d*))?\.(png|json)|state(?:-([1-9]\d*))?\.json)$/

// Which pin and which of its files `name` is, or null for any other name.
export function parsePinAssetName(name: string): { index: number; file: PinFile } | null {
  const m = PIN_ASSET.exec(name)
  if (!m) return null
  const k = m[1] ?? m[3]
  return { index: k ? Number(k) - 1 : 0, file: m[2] ? (m[2] as PinFile) : "state" }
}
