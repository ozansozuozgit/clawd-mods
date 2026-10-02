// The ghost's pure logic: the index's shape, the tokens both the index script
// and the hook speak, ranking a file's ghosts against an edit, and the words.
// No `$`, no Node: scripts/build-index.mjs imports this file too (node strips
// the types), and so do the tests.

export type GhostKind = 'decision' | 'commit' | 'owner'

export type Ghost = {
  kind: GhostKind
  /** YYYY-MM-DD, local time. */
  date: string
  /** The owner's own words, under 20 words. */
  quote?: string
  /** The decision, or the commit subject, short. */
  what: string
  /** What the decision replaced: what an edit back would undo. */
  undo?: string
  /** `undo` as keys: an edit that writes one of these back swings the decision back. */
  undoKeys?: string[]
  /** `file`: the history names this file. `topic`: it names a system (type, colour…) the file defines, so it needs the edit to touch it. */
  scope: 'file' | 'topic'
  /** Lower-case tokens (and `topic:*`) an edit is matched against. */
  keys: string[]
  weight: number
  /** Where it came from: `decisions.md (origin/main)`, `git a1b2c3d`, `transcript 1a2b3c4d`. */
  source: string
}

/** One value a custom property held, from `git log -L` (oldest first in the index). */
export type ValuePoint = { date: string; value: string; hash: string }

export type GhostIndex = {
  v: 1
  /** The repository root the `files` keys are relative to. */
  root: string
  builtAt: number
  sources: { decisions: string | null; commits: number; transcripts: number; ownerMessages: number }
  /** The decisions log the index read, relative to `root` (undefined or null: none found). */
  decisionsFile?: string | null
  files: Record<string, Ghost[]>
  /** Per file, per custom property it defines: the values it held over time, oldest first. */
  values?: Record<string, Record<string, ValuePoint[]>>
}

export type Ranked = { ghost: Ghost; score: number }

export const EDIT_TOOLS: readonly string[] = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

const STOP = new Set(
  'that this with from have they them then than what when where which while your yours will would there their about into over under after before just like also only some more most very such each every other these those been being were does done doing make made keep kept same still back need want should could shall here first last next once much many good look looks feel feels thing things page site section sections file files line lines text none true false null return const export import default function props style class value values width height auto none'.split(
    ' ',
  ),
)

/** Tokens of a piece of code or prose: custom properties, hex colours, px values, and plain words of four letters or more. */
export function tokenize(text: string): string[] {
  const out = new Set<string>()
  const lower = text.toLowerCase()
  for (const m of lower.matchAll(/--[a-z][a-z0-9-]*/g)) out.add(m[0])
  for (const m of lower.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/g)) out.add(m[0])
  for (const m of lower.matchAll(/\b(\d{1,4})px\b/g)) out.add(`${m[1]}px`)
  for (const m of lower.matchAll(/[a-z][a-z-]{3,}/g)) {
    const word = m[0].replace(/^-+|-+$/g, '')
    if (word.length >= 4 && !STOP.has(word)) out.add(word)
  }
  for (const topic of topicsOf(lower)) out.add(`topic:${topic}`)
  return [...out]
}

/** The systems a design file defines, by the custom-property names and words common to most stylesheets. */
const TOPICS: Record<string, RegExp> = {
  type: /--(t|f|ls|fs|font|type)-[a-z]|font-size|font-weight|\bfont\b|\bfonts\b|typograph|\btype (size|system|scale)|\bsizings?\b|\bheadings?\b|\bletter-spacing\b|\bline-height\b/,
  colour: /--(accent|ink|page|paper|surface|bg|fg|brand|primary|secondary|colou?r)[a-z0-9-]*|\bcolou?rs?\b|\bcontrast\b|\bpalette\b|data-theme|#[0-9a-f]{6}\b/,
  layout: /--(maxw|max-width|measure|gutter|container)\b|max-width|\blayout\b/,
}

/** The systems a piece of text speaks about. */
export function topicsOf(text: string): string[] {
  const lower = text.toLowerCase()
  return Object.keys(TOPICS).filter(t => TOPICS[t]?.test(lower))
}

/** Where a project's decisions log may live, in the order the index builder tries them: the configured path first, then the common spots. */
export const DECISIONS_CANDIDATES: readonly string[] = ['design/decisions.md', 'DECISIONS.md', 'docs/decisions.md', 'decisions.md']

/** The paths to try for the decisions log: `configured` (when set) first, then the common spots, no repeats. */
export function decisionsCandidates(configured?: string): string[] {
  const own = (configured ?? '').trim().replace(/^\.\//, '')
  return [...new Set([...(own === '' ? [] : [own]), ...DECISIONS_CANDIDATES])]
}

/** What an edit removes and what it writes. */
export type EditText = { before: string; after: string }

/** The text an edit tool call carries: what it removes (`before`) and what it writes (`after`). */
export function editTextOf(e: Record<string, unknown>): EditText {
  const before: string[] = []
  const after: string[] = []
  if (typeof e.old_string === 'string') before.push(e.old_string)
  for (const key of ['new_string', 'content', 'new_source']) {
    const v = e[key]
    if (typeof v === 'string') after.push(v)
  }
  const edits = e.edits
  if (Array.isArray(edits)) {
    for (const one of edits) {
      if (one !== null && typeof one === 'object') {
        const o = one as Record<string, unknown>
        if (typeof o.old_string === 'string') before.push(o.old_string)
        if (typeof o.new_string === 'string') after.push(o.new_string)
      }
    }
  }
  return { before: before.join('\n').slice(0, 200000), after: after.join('\n').slice(0, 200000) }
}

/** Keys that name a system or a value, not a plain word: what a topic ghost needs an edit to touch. */
export const isStrongKey = (k: string): boolean => k.startsWith('topic:') || k.startsWith('--') || k.startsWith('#') || /^\d+px$/.test(k)

/** The values a decision replaced, as keys: bare sizes of 40 and up read as px (`64/52` → `64px`, `52px`). */
export function undoKeysOf(replaced: string): string[] {
  const out = new Set(tokenize(replaced).filter(isStrongKey).filter(k => !k.startsWith('topic:')))
  for (const m of replaced.matchAll(/(?<![#\w])(\d{1,2},?\d{3}|\d{2,3})(?![\w%])/g)) {
    const n = Number((m[1] ?? '').replace(',', ''))
    if (n >= 40 && n <= 4000) out.add(`${n}px`)
  }
  return [...out]
}

/** The path an edit tool call targets. */
export function targetOf(e: Record<string, unknown>): string | undefined {
  const p = e.file_path ?? e.notebook_path
  return typeof p === 'string' && p.length > 0 ? p : undefined
}

/** A path relative to `root`, or undefined when it lies outside. */
export function relativeTo(root: string, path: string): string | undefined {
  const base = root.endsWith('/') ? root : `${root}/`
  if (path.startsWith(base)) return path.slice(base.length)
  if (!path.startsWith('/')) return path.replace(/^\.\//, '')
  return undefined
}

/**
 * A file's ghosts that matter for this edit, best first. With `edit`
 * undefined (listing, not editing) every ghost counts as it is.
 *
 * Topic ghosts (a decision about the type system, against the file that
 * defines it) need the edit to touch that system or one of its values, so a
 * colour edit in the global stylesheet does not raise the type-size ghost.
 * An edit that writes back a value a decision replaced ranks that decision
 * first: that is the swing the ghost is for.
 */
export function rank(ghosts: readonly Ghost[] | undefined, edit?: EditText): Ranked[] {
  if (ghosts === undefined || ghosts.length === 0) return []
  const before = edit === undefined ? undefined : new Set(tokenize(edit.before))
  const after = edit === undefined ? undefined : new Set(tokenize(edit.after))
  const touched = edit === undefined ? undefined : new Set([...(before ?? []), ...(after ?? [])])
  const added = edit === undefined ? undefined : new Set([...(after ?? [])].filter(k => !(before ?? new Set()).has(k)))
  const out: Ranked[] = []
  for (const ghost of ghosts) {
    let strong = 0
    let words = 0
    let undoes = 0
    if (touched !== undefined) {
      for (const k of ghost.keys) {
        if (!touched.has(k)) continue
        if (isStrongKey(k)) strong += 1
        else words += 1
      }
      for (const k of ghost.undoKeys ?? []) if (added?.has(k)) undoes += 1
    }
    if (ghost.scope === 'topic' && touched !== undefined && strong === 0 && undoes === 0) continue
    const recency = Number(ghost.date.replaceAll('-', '')) / 1e9
    const score = ghost.weight + 2 * Math.min(strong, 3) + 0.5 * Math.min(words, 4) + (undoes > 0 ? 8 : 0) + recency
    out.push({ ghost, score })
  }
  return out.sort((a, b) => b.score - a.score)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-05-12` → `12 May`. */
export function dayOf(date: string): string {
  const [, m, d] = date.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`.trim()
}

const bare = (text: string): string => text.replace(/[.…,;:\s]+$/, '')

const STRONG = /\b(loud|louder|shouting|way|hate|horrible|hurts?|weird|bland|empty|busy|cluttered|ugly|cheap|boring|plain|overwhelming|big|bigger|huge|small|smaller|tiny|tall|love|don'?t|dont)\b/gi

/** The sharpest sentence of a quote, for the band: "the hero feels too loud". */
export function sharpOf(quote: string): string {
  const sentences = quote.split(/(?<=[.!?])\s+/).filter(Boolean)
  if (sentences.length < 2) return bare(quote)
  let best = sentences[0] ?? quote
  let most = -1
  for (const one of sentences) {
    const n = (one.match(STRONG) ?? []).length
    if (n > most) {
      most = n
      best = one
    }
  }
  return bare(best)
}

const daysBetween = (a: string, b: string): number => (Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86400000

/**
 * A commit swing on the same file and topic landing up to a day before a
 * decision: "the day after 'Bigger and bolder…' landed here".
 */
function companionOf(ghost: Ghost, all: readonly Ghost[]): Ghost | undefined {
  if (ghost.kind === 'commit') return undefined
  const topics = new Set(ghost.keys.filter(k => k.startsWith('topic:')))
  return all.find(other => {
    if (other.kind !== 'commit') return false
    const gap = daysBetween(other.date, ghost.date)
    return gap >= 0 && gap <= 1 && other.keys.some(k => topics.has(k))
  })
}

/** The ghost's one line, as the band shows it: the dated words, the decision, what an edit back undoes. */
export function lineOf(ghost: Ghost, all: readonly Ghost[] = []): string {
  const day = dayOf(ghost.date)
  const with_ = companionOf(ghost, all)
  const when =
    with_ === undefined
      ? ''
      : ` ${daysBetween(with_.date, ghost.date) === 0 ? 'the same day' : 'the day after'} "${bare(clip(with_.what, 4))}" landed here,`
  if (ghost.kind === 'decision') {
    const said = ghost.quote === undefined ? '' : ` you said "${sharpOf(ghost.quote)}"${when} and`
    const undo = ghost.undo === undefined ? '' : ` An edit back undoes it (it replaced ${bare(clip(ghost.undo, 8))}).`
    return `Ghost of ${day}:${said} decided ${bare(clip(ghost.what, 12))}.${undo}`
  }
  if (ghost.kind === 'commit') {
    return `Ghost of ${day}: this file swung before: "${bare(clip(ghost.what, 10))}" (${ghost.source.replace(/^git /, '')}).`
  }
  return `Ghost of ${day}: you said "${sharpOf(ghost.quote ?? ghost.what)}"${when === '' ? ' about this' : when.replace(/,$/, '')}.`
}

/** The note Claude reads after the edit's result: the same facts, plainly. */
export function noteOf(file: string, ranked: readonly Ranked[]): string {
  const rows = ranked.slice(0, 3).map(({ ghost }) => {
    const said = ghost.quote === undefined || ghost.kind === 'owner' ? '' : ` Owner's words: "${bare(ghost.quote)}".`
    const undo = ghost.undo === undefined ? '' : ` It replaced: ${bare(ghost.undo)}.`
    const what = ghost.kind === 'owner' ? `the owner said "${bare(ghost.what)}"` : bare(ghost.what)
    return `- ${ghost.date}, ${ghost.kind} (${ghost.source}): ${what}.${said}${undo}`
  })
  return [
    `clawd-ghost (observe only): ${file} has history the owner settled before. Check this edit does not swing it back; if it does, tell the owner which decision it reverses rather than quietly undoing it.`,
    ...rows,
  ].join('\n')
}

/** Cuts text to fewer than `max` words, marking the cut. */
export function clip(text: string, max = 19): string {
  const words = text.trim().split(/\s+/)
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ')}…`
}

// ---- value swings: what an edit brings back, and how often it has swung ----

/** A custom property's value as a comparable token: its largest px size (`64`), or its hex colour. */
export function measureOf(value: string): { token: string; unit: 'px' | '' } | undefined {
  const px = [...value.matchAll(/(\d+(?:\.\d+)?)px\b/g)].map(m => Number(m[1]))
  if (px.length > 0) return { token: String(Math.max(...px)), unit: 'px' }
  const hex = value.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/)
  return hex === null ? undefined : { token: hex[0].toLowerCase(), unit: '' }
}

/** Custom property definitions in a piece of CSS: `--t-display` → `clamp(40px, 5vw, 56px)`. */
export function propsOf(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of text.matchAll(/(--[a-zA-Z][\w-]*)\s*:\s*([^;}\n]+)/g)) out.set((m[1] ?? '').toLowerCase(), (m[2] ?? '').trim())
  return out
}

export type Swing = {
  /** The decision this edit would undo. */
  decision: Ghost
  /** The custom property, when the edit names one. */
  prop?: string
  /** What the value is (`hero`), from the decision's words or the property's name. */
  label: string
  /** The value the edit brings back (`64`, `#fdf6ec`) and the decided one it replaces (`56`). */
  back: string
  decided: string
  unit: 'px' | ''
  /** The values over time, the edit's last: `60 → 64 → 56 → 64`. */
  history?: string[]
  /** When each past value landed (YYYY-MM-DD). */
  dates?: string[]
  /** When the value the edit brings back first landed. */
  born?: string
  /** Which reversal this is on this system: 1 for the first time. */
  n: number
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** How many times a run of values changed direction (sizes) or went back to an earlier value (colours). */
export function reversalsOf(seq: readonly string[], unit: 'px' | ''): number {
  const run = seq.filter((v, i) => i === 0 || v !== seq[i - 1])
  let n = 0
  if (unit === 'px') {
    let last = 0
    for (let i = 1; i < run.length; i++) {
      const dir = Math.sign(Number(run[i]) - Number(run[i - 1]))
      if (dir !== 0 && last !== 0 && dir !== last) n += 1
      if (dir !== 0) last = dir
    }
    return n
  }
  for (let i = 2; i < run.length; i++) if (run.slice(0, i - 1).includes(run[i] ?? '')) n += 1
  return n
}

/**
 * The value swing an edit makes, when it brings back a value a decision
 * replaced: which decision, which value, its history and the reversal count.
 * Undefined when the edit is not a swing back (or nothing says what it undoes).
 */
export function swingOf(ranked: readonly Ranked[], edit: EditText, values?: Record<string, ValuePoint[]>): Swing | undefined {
  const decisions = ranked.map(r => r.ghost).filter(g => g.kind === 'decision')
  if (decisions.length === 0) return undefined
  const before = propsOf(edit.before)
  const after = propsOf(edit.after)
  const changes: { prop?: string; from: string; to: string; unit: 'px' | '' }[] = []
  for (const [prop, value] of after) {
    const was = before.get(prop)
    const to = measureOf(value)
    const from = was === undefined ? undefined : measureOf(was)
    if (to !== undefined && from !== undefined && to.token !== from.token && to.unit === from.unit) changes.push({ prop, from: from.token, to: to.token, unit: to.unit })
  }
  if (changes.length === 0) {
    // A fragment without the property's name: the sizes it removes and adds.
    const removed = tokenize(edit.before).filter(k => /^\d+px$/.test(k))
    const added = tokenize(edit.after).filter(k => /^\d+px$/.test(k) && !removed.includes(k))
    for (const to of added) for (const from of removed.filter(k => !tokenize(edit.after).includes(k))) changes.push({ from: from.replace('px', ''), to: to.replace('px', ''), unit: 'px' })
  }
  for (const change of changes) {
    const backKey = change.unit === 'px' ? `${change.to}px` : change.to
    const decidedRe = new RegExp(`(?<![\\w#.])${escape(change.from)}(?:px)?(?![\\w])`, 'i')
    const earlier = change.prop === undefined ? undefined : values?.[change.prop]
    const wasBefore = earlier?.some(p => measureOf(p.value)?.token === change.to) === true
    // A swing back: the value a decision replaced, or one the property held before.
    const decision =
      decisions.find(d => (d.undoKeys ?? []).includes(backKey) && decidedRe.test(d.what)) ??
      decisions.find(d => (d.undoKeys ?? []).includes(backKey)) ??
      (wasBefore ? decisions.find(d => decidedRe.test(d.what) && d.keys.some(k => k.startsWith('topic:'))) : undefined)
    if (decision === undefined) continue
    const labelRe = new RegExp(`([A-Za-z][A-Za-z-]+)\\s+(?:stops at\\s+|is\\s+|at\\s+)?${escape(change.from)}(?:px)?(?![\\w])`, 'i')
    const word = decision.what.match(labelRe)?.[1]?.toLowerCase()
    const fromProp = change.prop?.replace(/^--(t|f|ls|c)-/, '').replace(/^--/, '')
    const label = word !== undefined && !['to', 'and', 'from', 'of', 'the', 'is', 'at'].includes(word) ? word : (fromProp ?? 'value')
    const points = change.prop === undefined ? undefined : values?.[change.prop]
    const tokens = points?.map(p => measureOf(p.value)?.token).filter((t): t is string => t !== undefined)
    let history: string[] | undefined
    let dates: string[] | undefined
    let born: string | undefined
    let n = 1
    if (points !== undefined && tokens !== undefined && tokens.length >= 2 && tokens[tokens.length - 1] === change.from) {
      history = [...tokens.filter((t, i) => i === 0 || t !== tokens[i - 1]), change.to]
      dates = [...new Set(points.map(p => p.date))]
      born = points.find(p => measureOf(p.value)?.token === change.to)?.date
      n = Math.max(1, reversalsOf(history, change.unit))
    }
    return { decision, prop: change.prop, label, back: change.to, decided: change.from, unit: change.unit, history, dates, born, n }
  }
  return undefined
}

// ---- privacy ----

/** Drops the owner's surname everywhere (inside paths and user names too) and shortens absolute paths to their file name. */
export function redactorOf(surnames: readonly string[]): (text: string) => string {
  const names = surnames.filter(t => t.length >= 3)
  const re = names.length === 0 ? undefined : new RegExp(`(${names.map(escape).join('|')})`, 'gi')
  return text => {
    let out = text.replace(/@?"?(\/(?:Users|home|private|tmp|var)\/[^\s"'`)]+)"?/g, (_, path: string) => path.split('/').filter(Boolean).pop() ?? '')
    if (re !== undefined) out = out.replace(re, '')
    return out.replace(/\s{2,}/g, ' ').trim()
  }
}
