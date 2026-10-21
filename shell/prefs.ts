// The shell's own localStorage. Every key carries the `design-review:`
// prefix (excluded from state snapshots); every access tolerates a blocked
// or full storage.
export function readKey(key: string): string | null {
  try {
    return localStorage.getItem(`design-review:${key}`)
  } catch {
    return null
  }
}

export function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(`design-review:${key}`, value)
  } catch {
    // Not persisted; the session still works.
  }
}
