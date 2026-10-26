// The picker's style overview: the size, spacing, colors and font size the app's
// own stylesheets set on an element, as written (`var(--space-4)`), not as
// computed (`16px`) — to see at a glance whether the right tokens were used.
// Only what the element itself is given: nothing inherited, no browser
// defaults. A light cascade picks the winner: importance, layers,
// specificity, then source order.

export type StyleLine = { prop: string; value: string; swatch?: string }

type Spec = [number, number, number]

// A declaration's property and the box sides (or single slot) it sets.
type Group = {
  props: [string, string[]][] // broadest first: a rule's shorthand claims its slots before its longhands
  swatch?: Record<string, string> // slot → the computed property its color shows
  shown?: (cs: CSSStyleDeclaration) => boolean
}

const T = "top"
const R = "right"
const B = "bottom"
const L = "left"

const sides = (base: string, suffix = ""): [string, string[]][] => [
  [`${base}${suffix}`, [T, R, B, L]],
  [`${base}-block${suffix}`, [T, B]],
  [`${base}-inline${suffix}`, [L, R]],
  [`${base}-top${suffix}`, [T]],
  [`${base}-right${suffix}`, [R]],
  [`${base}-bottom${suffix}`, [B]],
  [`${base}-left${suffix}`, [L]],
  [`${base}-block-start${suffix}`, [T]],
  [`${base}-block-end${suffix}`, [B]],
  [`${base}-inline-start${suffix}`, [L]],
  [`${base}-inline-end${suffix}`, [R]],
]

const GROUPS: Group[] = [
  {
    props: [
      ["width", ["w"]],
      ["inline-size", ["w"]],
    ],
  },
  {
    props: [
      ["height", ["h"]],
      ["block-size", ["h"]],
    ],
  },
  { props: sides("margin") },
  { props: sides("padding") },
  {
    props: [
      ["background", ["bg"]],
      ["background-color", ["bg"]],
    ],
    swatch: { bg: "background-color" },
  },
  { props: [["color", ["fg"]]], swatch: { fg: "color" } },
  {
    // `border: 1px solid var(--line)` and `border-color` alike; a border
    // nobody can see (no width) is left out.
    props: [["border", [T, R, B, L]], ...sides("border", "-color"), ...sides("border").slice(1)],
    swatch: {
      [T]: "border-top-color",
      [R]: "border-right-color",
      [B]: "border-bottom-color",
      [L]: "border-left-color",
    },
    shown: (cs) =>
      [T, R, B, L].some((s) => parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0),
  },
  {
    props: [
      ["font", ["size"]],
      ["font-size", ["size"]],
    ],
  },
]

// --- Selectors -------------------------------------------------------------

// Splits at top-level commas, past escapes, strings, brackets and parens.
export function splitList(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  let quote = ""
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c === "\\") i++
    else if (quote) quote = c === quote ? "" : quote
    else if (c === '"' || c === "'") quote = c
    else if (c === "(" || c === "[") depth++
    else if (c === ")" || c === "]") depth--
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(list.slice(start).trim())
  return out.filter(Boolean)
}

const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"])
const IDENT = /^(?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-]|[^\x00-\x7f])+/

const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const compareSpec = (a: Spec, b: Spec) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
const maxSpec = (list: string): Spec =>
  splitList(list)
    .map(specificity)
    .reduce<Spec>((m, s) => (compareSpec(s, m) > 0 ? s : m), [0, 0, 0])

// The closing paren matching the one just before `from`.
function closing(sel: string, from: number): number {
  let depth = 1
  for (let i = from; i < sel.length; i++) {
    const c = sel[i]
    if (c === "\\") i++
    else if (c === "(") depth++
    else if (c === ")" && --depth === 0) return i
  }
  return sel.length
}

// [ids, classes/attributes/pseudo-classes, types/pseudo-elements] of one
// complex selector.
export function specificity(sel: string): Spec {
  let spec: Spec = [0, 0, 0]
  let i = 0
  while (i < sel.length) {
    const c = sel[i]
    const ident = (at: number) => IDENT.exec(sel.slice(at))?.[0] ?? ""
    if (c === "#") {
      spec = add(spec, [1, 0, 0])
      i += 1 + ident(i + 1).length
    } else if (c === ".") {
      spec = add(spec, [0, 1, 0])
      i += 1 + ident(i + 1).length
    } else if (c === "[") {
      spec = add(spec, [0, 1, 0])
      let quote = ""
      i++
      while (i < sel.length && (quote || sel[i] !== "]")) {
        if (sel[i] === "\\") i++
        else if (quote) quote = sel[i] === quote ? "" : quote
        else if (sel[i] === '"' || sel[i] === "'") quote = sel[i]
        i++
      }
      i++
    } else if (c === ":") {
      const element = sel[i + 1] === ":"
      const at = i + (element ? 2 : 1)
      const name = ident(at).toLowerCase()
      i = at + name.length
      let args = ""
      if (sel[i] === "(") {
        const end = closing(sel, i + 1)
        args = sel.slice(i + 1, end)
        i = end + 1
      }
      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) spec = add(spec, [0, 0, 1])
      else if (name === "where") continue
      else if (name === "is" || name === "not" || name === "has" || name === "matches")
        spec = add(spec, maxSpec(args))
      else if (/^nth-(last-)?child$/.test(name) && /\sof\s/.test(args))
        spec = add(add(spec, [0, 1, 0]), maxSpec(args.split(/\sof\s/)[1]))
      else spec = add(spec, [0, 1, 0])
    } else {
      const name = ident(i)
      if (name) {
        spec = add(spec, [0, 0, 1])
        i += name.length
      } else {
        i++ // a combinator, whitespace, `*` or `|`
      }
    }
  }
  return spec
}

// A nested rule's selector, made absolute: `&` is its parent.
export function resolveNested(parent: string, child: string): string {
  const is = `:is(${parent})`
  return splitList(child)
    .map((s) => (s.includes("&") ? s.replaceAll("&", is) : `${is} ${s}`))
    .join(", ")
}

// --- Rules -----------------------------------------------------------------

type Matched = {
  style: CSSStyleDeclaration
  spec: Spec
  layer: number // first-seen order; unlayered is Infinity
  inline: boolean
  order: number
}

type Walk = { el: Element; win: Window; layers: Map<string, number>; out: Matched[] }

const kind = (rule: CSSRule) => rule.constructor.name

function layerRank(walk: Walk, name: string): number {
  if (!walk.layers.has(name)) walk.layers.set(name, walk.layers.size)
  return walk.layers.get(name)!
}

function mediaMatches(win: Window, media: MediaList | undefined): boolean {
  const text = media?.mediaText
  if (!text) return true
  try {
    return win.matchMedia(text).matches
  } catch {
    return true
  }
}

function matchSpec(el: Element, list: string): Spec | null {
  let best: Spec | null = null
  for (const sel of splitList(list)) {
    let hit = false
    try {
      hit = el.matches(sel)
    } catch {
      // A selector this browser cannot match (or a pseudo-element).
    }
    if (hit) {
      const s = specificity(sel)
      if (!best || compareSpec(s, best) > 0) best = s
    }
  }
  return best
}

let anonymous = 0

function walkRules(
  walk: Walk,
  rules: CSSRuleList | undefined,
  layer: string | null,
  parent: string | null
) {
  for (const rule of Array.from(rules ?? [])) {
    const k = kind(rule)
    if (k === "CSSStyleRule") {
      const r = rule as CSSStyleRule
      const sel = parent ? resolveNested(parent, r.selectorText) : r.selectorText
      push(walk, r.style, sel, layer)
      walkRules(walk, r.cssRules, layer, sel)
    } else if (k === "CSSNestedDeclarations") {
      if (parent) push(walk, (rule as CSSStyleRule).style, parent, layer)
    } else if (k === "CSSMediaRule") {
      const r = rule as CSSMediaRule
      if (mediaMatches(walk.win, r.media)) walkRules(walk, r.cssRules, layer, parent)
    } else if (k === "CSSSupportsRule") {
      const r = rule as CSSSupportsRule
      let ok = true
      try {
        ok = (walk.win as Window & { CSS: typeof CSS }).CSS.supports(r.conditionText)
      } catch {
        // Kept: better shown than lost.
      }
      if (ok) walkRules(walk, r.cssRules, layer, parent)
    } else if (k === "CSSLayerStatementRule") {
      for (const name of (rule as CSSLayerStatementRule).nameList)
        layerRank(walk, layer ? `${layer}.${name}` : name)
    } else if (k === "CSSLayerBlockRule") {
      const r = rule as CSSLayerBlockRule
      const name = r.name || `\0${++anonymous}`
      const full = layer ? `${layer}.${name}` : name
      layerRank(walk, full)
      walkRules(walk, r.cssRules, full, parent)
    } else if (k === "CSSImportRule") {
      const r = rule as CSSImportRule
      if (!mediaMatches(walk.win, r.media)) continue
      const named = r.layerName
      const inner = named == null ? layer : named ? named : `\0${++anonymous}`
      if (inner !== layer && inner) layerRank(walk, inner)
      walkRules(walk, cssRulesOf(r.styleSheet), inner, parent)
    } else if (k === "CSSContainerRule" || k === "CSSScopeRule") {
      // Not evaluated: their rules count as if they applied.
      walkRules(walk, (rule as CSSGroupingRule).cssRules, layer, parent)
    }
  }
}

function push(walk: Walk, style: CSSStyleDeclaration, sel: string, layer: string | null) {
  const spec = matchSpec(walk.el, sel)
  if (!spec) return
  walk.out.push({
    style,
    spec,
    layer: layer === null ? Infinity : layerRank(walk, layer),
    inline: false,
    order: walk.out.length,
  })
}

function cssRulesOf(sheet: CSSStyleSheet | null | undefined): CSSRuleList | undefined {
  try {
    return sheet?.cssRules
  } catch {
    return undefined // a cross-origin sheet cannot be read
  }
}

// Every rule of the element's document that matches it, in source order,
// then its style attribute.
function matchedRules(el: Element): Matched[] {
  const doc = el.ownerDocument
  const win = doc.defaultView ?? window
  const walk: Walk = { el, win, layers: new Map(), out: [] }
  const sheets = [...Array.from(doc.styleSheets), ...(doc.adoptedStyleSheets ?? [])]
  for (const sheet of sheets) {
    if (sheet.disabled || !mediaMatches(win, sheet.media)) continue
    walkRules(walk, cssRulesOf(sheet), null, null)
  }
  const inline = (el as HTMLElement).style
  if (inline?.length) {
    walk.out.push({ style: inline, spec: [0, 0, 0], layer: Infinity, inline: true, order: 0 })
  }
  return walk.out
}

// --- Cascade ---------------------------------------------------------------

type Candidate = { prop: string; value: string; important: boolean; rule: Matched }

// Bigger wins. Important declarations reverse the layer order and put the
// style attribute first; normal ones put it last, over every rule.
function weight(c: Candidate): number[] {
  const { rule } = c
  const inline = rule.inline ? 1 : 0
  if (c.important) return [1, inline, -rule.layer, ...rule.spec, rule.order]
  return [0, 0, rule.layer, inline, ...rule.spec, rule.order]
}

function beats(a: Candidate, b: Candidate): boolean {
  const wa = weight(a)
  const wb = weight(b)
  for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return wa[i] > wb[i]
  return false
}

// One group's winning declarations, broadest first, each once.
function resolveGroup(group: Group, rules: Matched[]): Candidate[] {
  const winners = new Map<string, Candidate>()
  for (const rule of rules) {
    const claimed = new Set<string>()
    for (const [prop, slots] of group.props) {
      const value = rule.style.getPropertyValue(prop).trim()
      if (!value) continue
      const open = slots.filter((s) => !claimed.has(s))
      if (!open.length) continue
      const important = rule.style.getPropertyPriority(prop) === "important"
      const candidate: Candidate = { prop, value, important, rule }
      for (const slot of open) {
        claimed.add(slot)
        const current = winners.get(slot)
        if (!current || beats(candidate, current)) winners.set(slot, candidate)
      }
    }
  }
  const kept = [...new Set(winners.values())].filter(isSet)
  return group.props.flatMap(([prop]) => kept.filter((c) => c.prop === prop))
}

// Resets are not "set": a zero-specificity rule (`*`, `:where(…)`, the
// preflight's) or a CSS-wide keyword (`color: inherit`).
const KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"])
const isSet = (c: Candidate) =>
  !KEYWORDS.has(c.value.toLowerCase()) && (c.rule.inline || compareSpec(c.rule.spec, [0, 0, 0]) > 0)

function swatchOf(group: Group, c: Candidate, cs: CSSStyleDeclaration): string | undefined {
  if (!group.swatch) return undefined
  const slots = group.props.find(([p]) => p === c.prop)?.[1] ?? []
  const prop = slots.map((s) => group.swatch![s]).find(Boolean)
  return prop ? cs.getPropertyValue(prop) || undefined : undefined
}

// The overview the picker shows next to the hovered element.
export function styleOverview(el: Element): StyleLine[] {
  const rules = matchedRules(el)
  if (!rules.length) return []
  const win = el.ownerDocument.defaultView ?? window
  const cs = win.getComputedStyle(el)
  return GROUPS.flatMap((group) => {
    if (group.shown && !group.shown(cs)) return []
    return resolveGroup(group, rules).map((c) => {
      const swatch = swatchOf(group, c, cs)
      const value = c.important ? `${c.value} !important` : c.value
      return swatch ? { prop: c.prop, value, swatch } : { prop: c.prop, value }
    })
  })
}

const px = (n: number) => `${Math.round(n * 10) / 10}`

// The overview's first line: the element's rendered size.
export const sizeLine = (box: { width: number; height: number }): StyleLine => ({
  prop: "size",
  value: `${px(box.width)} × ${px(box.height)}`,
})
