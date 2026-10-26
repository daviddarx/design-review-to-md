import type { PinOpener } from "../../model/types.ts"

// What the picker knows about an element: a selector that finds it again,
// the React component that rendered it, and a short label.

// Marker attributes worth anchoring on, best first: the app's own, from
// `--markers` (see setMarkers). Any other `data-*` attribute follows, except
// the ones that flip with state.
let markers: string[] = []
export function setMarkers(names: string[]) {
  markers = names
}
const VOLATILE =
  /^data-(state|open|closed|highlighted|hover|hovered|focus|focused|focus-visible|active|selected|disabled|pressed|checked|unchecked|orientation|side|align|starting-style|ending-style|popup-open|placeholder|dragging|index)$/

export function escapeIdent(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s)
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`).replace(/^(\d)/, "\\3$1 ")
}

const quoted = (v: string) => `"${v.replace(/["\\]/g, "\\$&")}"`

// Ids React (useId) and the libraries built on it mint: `_r_5_`, `:r5:`,
// `«r5»`, `base-ui-_r_5_`. They follow mount order, so the same popup trigger
// is named differently once the work panel mounted first — never anchored on,
// except a popup's own id, which Go to pin and the markers put right through
// its trigger's `aria-controls`.
const GENERATED_ID = /[:«»]|(^|-)_[rR]_[0-9a-zA-Z]*_$/

function markerOf(el: Element): string | null {
  for (const name of markers) {
    const v = el.getAttribute(name)
    if (v) return `[${name}=${quoted(v)}]`
  }
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith("data-") && attr.value && !VOLATILE.test(attr.name)) {
      return `[${attr.name}=${quoted(attr.value)}]`
    }
  }
  return null
}

function finds(doc: Document, sel: string, el: Element): boolean {
  try {
    return doc.querySelector(sel) === el
  } catch {
    return false
  }
}

function nthOfType(el: Element): string {
  const parent = el.parentElement
  if (!parent) return ""
  const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName)
  return same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : ""
}

// Prefers `#id`, then a marker attribute, then a `tag:nth-of-type` path —
// anchored on the nearest ancestor that is itself unique. Always satisfies
// `el.ownerDocument.querySelector(selector) === el`. A generated id is used
// only when it is in `popupIds`.
export function uniqueSelector(el: Element, popupIds: ReadonlySet<string> = new Set()): string {
  const doc = el.ownerDocument
  const tag = (n: Element) => n.tagName.toLowerCase()
  const idOf = (n: Element) =>
    n.id && (popupIds.has(n.id) || !GENERATED_ID.test(n.id)) ? `#${escapeIdent(n.id)}` : null

  const own = idOf(el)
  if (own && finds(doc, own, el)) return own
  const marker = markerOf(el)
  if (marker) {
    if (finds(doc, marker, el)) return marker
    if (finds(doc, tag(el) + marker, el)) return tag(el) + marker
  }

  // A bare `b` may be unique today and match something else tomorrow: the
  // path only stops once it holds an id or a marker (or reaches the root).
  const parts: string[] = []
  let anchored = false
  for (let node: Element | null = el; node; node = node.parentElement) {
    const id = node === el ? null : idOf(node)
    if (id && finds(doc, id, node)) {
      parts.unshift(id)
      anchored = true
    } else if (node === doc.documentElement) {
      parts.unshift(":root")
      anchored = true
    } else {
      const m = node === el ? marker : markerOf(node)
      if (m) anchored = true
      parts.unshift(tag(node) + (m ?? "") + nthOfType(node))
    }
    const sel = parts.join(" > ")
    if (anchored && finds(doc, sel, el)) return sel
  }
  return parts.join(" > ")
}

type Fiber = { type?: unknown; return?: Fiber | null }

function nameOf(type: unknown): string | undefined {
  if (typeof type === "function") {
    const t = type as { displayName?: string; name?: string }
    return t.displayName || t.name || undefined
  }
  if (type && typeof type === "object") {
    // forwardRef / memo wrappers
    const t = type as { displayName?: string; render?: unknown; type?: unknown }
    return t.displayName || nameOf(t.render) || nameOf(t.type)
  }
  return undefined
}

// The first function/class component above the element in React's fiber
// tree (dev builds), or undefined outside React.
export function componentName(el: Element): string | undefined {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
  if (!key) return undefined
  let fiber = (el as unknown as Record<string, Fiber | undefined>)[key]
  for (let guard = 0; fiber && guard < 500; guard++) {
    const name = nameOf(fiber.type)
    if (name) return name
    fiber = fiber.return ?? undefined
  }
  return undefined
}

// "NavItem 120×32", or "button 120×32" outside a component.
export function describe(el: Element): string {
  const { width, height } = el.getBoundingClientRect()
  const name = componentName(el) ?? el.tagName.toLowerCase()
  return `${name} ${Math.round(width)}×${Math.round(height)}`
}

// The open popups `el` sits in, found by their trigger: an element marked
// `aria-expanded="true"` whose `aria-controls` names an ancestor of `el`
// (what Base UI's popover, menu and select triggers carry while open). A
// trigger inside another popup leads on to that one. Outermost first.
export function openersOf(el: Element): PinOpener[] {
  const doc = el.ownerDocument
  const found: { trigger: Element; controls: string }[] = []
  const seen = new Set<Element>()
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (!node.id) continue
    let trigger: Element | null = null
    try {
      trigger = doc.querySelector(`[aria-expanded="true"][aria-controls~=${quoted(node.id)}]`)
    } catch {
      trigger = null
    }
    if (!trigger || seen.has(trigger)) continue
    seen.add(trigger)
    found.unshift({ trigger, controls: node.id })
    node = trigger // the loop's parentElement step continues above it
  }
  // A trigger inside an outer popup may anchor on that popup's id.
  const popupIds = new Set(found.map((f) => f.controls))
  return found.map(({ trigger, controls }) => {
    const r = trigger.getBoundingClientRect()
    return {
      selector: uniqueSelector(trigger, popupIds),
      controls,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    }
  })
}
