export function rowIdOf(pointNumber: number, path: string[]): string {
  return [String(pointNumber), ...path].join(".")
}

function lettersToNumber(s: string): number {
  let n = 0
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 96)
  return n
}

function numberToLetters(n: number): string {
  let out = ""
  while (n > 0) {
    n -= 1
    out = String.fromCharCode(97 + (n % 26)) + out
    n = Math.floor(n / 26)
  }
  return out
}

// One past the highest of `taken` (retired labels included), so a label is
// never reused. Depth 1 is letters a…z, aa, ab…; depth 2 is 1, 2, …
export function nextLabel(depth: 1 | 2, taken: string[]): string {
  const pattern = depth === 1 ? /^[a-z]+$/ : /^\d+$/
  let highest = 0
  for (const label of taken) {
    if (!pattern.test(label)) continue
    const n = depth === 1 ? lettersToNumber(label) : Number(label)
    if (n > highest) highest = n
  }
  const next = highest + 1
  return depth === 1 ? numberToLetters(next) : String(next)
}

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
  return slug || "point"
}

export function pointFileBase(n: number, title: string): string {
  return `${String(n).padStart(2, "0")}-${slugify(title)}`
}
