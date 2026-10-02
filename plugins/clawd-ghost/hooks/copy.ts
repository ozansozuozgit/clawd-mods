// The ghost's voice: the copy pools, filling a template only when every
// placeholder it needs is known, rotating so no pool says the same line twice
// in a row, and composing the card the band draws. Pure: no `$`.

import { clip, dayOf, lineOf, sharpOf } from './ghost.ts'
import type { GhostCard, GhostLevel } from '../types'
import type { Ghost, Ranked, Swing } from './ghost.ts'

export type VarName =
  | 'old'
  | 'new'
  | 'date'
  | 'quote'
  | 'decision'
  | 'file'
  | 'born'
  | 'n'
  | 'thing'
  | 'days'
  | 'history'
  | 'first'
  | 'dates'
  | 'today'
export type Vars = Partial<Record<VarName, string>>

export type Template = { id: string; lines: readonly string[]; buttons?: readonly [string, string] }

export type Pool = 'swing' | 'history' | 'repeat' | 'repeatButtons' | 'rest' | 'overrule'

/** First haunting, when the edit brings back a value a decision replaced. */
export const SWING: readonly Template[] = [
  {
    id: 's1',
    lines: ["Boooo. I'm {old}. You buried me on {date}.", 'Your last words: "{quote}"', 'Bring me back and you undo: {decision}.'],
    buttons: ['Let me rest', "I'm back on purpose"],
  },
  {
    id: 's2',
    lines: ['Remember me? {old}. Died {date}.', 'Cause of death: "{quote}"', 'This edit digs me up. Your call — I just remember things.'],
    buttons: ['Leave me buried', 'Dig me up'],
  },
  { id: 's3', lines: ['Here lies {old} · {born} – {date}', '"{quote}"', 'Reviving me reverses the {date} decision.'], buttons: ['Rest in peace', 'Resurrect'] },
  {
    id: 's4',
    lines: ['This file is haunted.', 'Last time it looked like this, you said "{quote}"', 'You decided {new} on {date}. This edit says {old}.'],
    buttons: ['Banish', 'Overrule the ghost'],
  },
  {
    id: 's5',
    lines: ["Ooooh, {old} again? I've seen how this ends.", '{date}: "{quote}" → {new}.', 'If you mean it this time, say so and Claude will log it.'],
    buttons: ['Let me rest', 'Mean it this time'],
  },
  {
    id: 's6',
    lines: ['Unfinished business in {file}.', '{date} you chose {new} ("{quote}").', 'This edit brings back the {old} you retired.'],
    buttons: ['Leave it settled', 'Reopen it'],
  },
]

/** First haunting, history only (no value swing). */
export const HISTORY: readonly Template[] = [
  { id: 'h7', lines: ['Boooo. {file} has history.', '{date}: "{quote}"', 'Decided: {decision}.'], buttons: ['Let me rest', 'Noted'] },
  { id: 'h8', lines: ['I used to live in this file.', '{date} you said "{quote}"', "Check this edit doesn't undo: {decision}."], buttons: ['Let me rest', 'Noted'] },
]

/** Reversed again: one template per count (n ≥ 5 shares the last). */
export const REPEAT: readonly Template[] = [
  { id: 'n2', lines: ['Back again? Reversal #{n} on {thing}.', '{date}: "{quote}" → {new}. You\'re at {old} again.', 'Same fight, new day.'] },
  { id: 'n3', lines: ["Third time. I've been dead {days} days and you keep digging.", '{thing} has swung {history}.', "Pick one and I'll stay buried."] },
  { id: 'n3-today', lines: ["I died this morning and you're already digging.", '{thing} has swung {history}.', "Pick one and I'll stay buried."] },
  { id: 'n4', lines: ["At this point I'm paying rent here.", 'Reversal #{n} on {thing} since {first}.', 'Swings so far: {dates}.'] },
  { id: 'n5', lines: ["I'm not even mad. Impressed, honestly.", '{n} swings on {thing}. Last word, {date}: "{quote}"', "Decide once and I'll haunt somebody else."] },
]

export const REPEAT_BUTTONS: readonly Template[] = [
  { id: 'b1', lines: [], buttons: ['Keep {new}', 'Keep {old} for good'] },
  { id: 'b2', lines: [], buttons: ['Settle it', 'Swing anyway'] },
  { id: 'b3', lines: [], buttons: ['Make it final', 'One more swing'] },
]

/** After button 1: the ghost goes back to rest. */
export const REST: readonly Template[] = [
  { id: 'r1', lines: ["Fine. I'll be in the attic."] },
  { id: 'r2', lines: ['Resting. Wake me if you reverse it again.'] },
  { id: 'r3', lines: ['Back to the crypt. {thing} stays {new}.'] },
]

/** After button 2 on a swing: Claude is asked to log it; the mod logs nothing itself. */
export const OVERRULE: readonly Template[] = [
  { id: 'o1', lines: ['Overruled. Telling Claude to log it so the next ghost knows.'] },
  { id: 'o2', lines: ['Resurrected. Claude will note: {today}, you chose {old} on purpose.'] },
  { id: 'o3', lines: ["Fine, I'm back. Somebody update the tombstone."] },
]

export const POOLS: Record<Pool, readonly Template[]> = {
  swing: SWING,
  history: HISTORY,
  repeat: REPEAT,
  repeatButtons: REPEAT_BUTTONS,
  rest: REST,
  overrule: OVERRULE,
}

/** Placeholders that are the ghost's own words (not the owner's), so they take a capital at a sentence's start. */
const OWN_WORDS: readonly VarName[] = ['thing', 'old']

/** Fills `{name}` placeholders; undefined when one is unknown. Quotes stay exactly as the owner wrote them. */
export function fill(text: string, vars: Vars): string | undefined {
  let missing = false
  const out = text.replace(/\{([a-z]+)\}/g, (_, name: string, at: number) => {
    const v = vars[name as VarName]
    if (v === undefined || v === '') {
      missing = true
      return ''
    }
    const isSentenceStart = at === 0 || /[.!?]\s$/.test(text.slice(0, at))
    return isSentenceStart && OWN_WORDS.includes(name as VarName) ? v.charAt(0).toUpperCase() + v.slice(1) : v
  })
  return missing ? undefined : out
}

export type Filled = { id: string; lines: string[]; buttons?: [string, string] }

/** A template with every placeholder filled, or undefined. */
export function fillTemplate(t: Template, vars: Vars): Filled | undefined {
  const lines = t.lines.map(l => fill(l, vars))
  if (lines.some(l => l === undefined)) return undefined
  let buttons: [string, string] | undefined
  if (t.buttons !== undefined) {
    const a = fill(t.buttons[0], vars)
    const b = fill(t.buttons[1], vars)
    if (a === undefined || b === undefined) return undefined
    buttons = [a, b]
  }
  return { id: t.id, lines: lines as string[], buttons }
}

/**
 * The next template of a pool after the last one used, among those whose
 * placeholders are all known; never the last one again while another fits.
 */
export function pick(pool: readonly Template[], vars: Vars, last?: string): Filled | undefined {
  const fits = pool.map(t => fillTemplate(t, vars)).filter((f): f is Filled => f !== undefined)
  if (fits.length === 0) return undefined
  const at = pool.findIndex(t => t.id === last)
  for (let step = 1; step <= pool.length; step++) {
    const t = pool[(at + step + pool.length) % pool.length]
    const f = fits.find(one => one.id === t?.id)
    if (f !== undefined && (f.id !== last || fits.length === 1)) return f
  }
  return fits[0]
}

/** 1 faint, 2 more solid, 3 solid and grumpy. */
export type Level = GhostLevel

export const levelOf = (n: number): Level => (n >= 3 ? 3 : n === 2 ? 2 : 1)

/** The card the band draws (the state contract's GhostCard). */
export type Card = GhostCard

export type Picked = Partial<Record<Pool, string>>

const days = (from: string, nowMs: number): number => Math.max(0, Math.floor((nowMs - Date.parse(`${from}T00:00:00`)) / 86400000))

/** The decision in a few words, cut at a comma so a list never ends mid-item ("hero 56, titles 44, items 22"). */
export function decisionText(ghost: Ghost): string {
  const text = ghost.what.replace(/^\([^)]*\)\s*/, '').replace(/…$/, '')
  const parts = text.split(/,\s+/)
  let out = parts[0] ?? text
  for (const part of parts.slice(1)) {
    if (`${out}, ${part}`.split(/\s+/).length > 11) break
    out = `${out}, ${part}`
  }
  return clip(out, 14).replace(/[.…,;:\s]+$/, '')
}

/** The placeholders a ranked lookup and its swing make known. */
export function varsOf(file: string, top: Ghost, swing: Swing | undefined, nowMs: number, today: string): Vars {
  const d = swing?.decision ?? top
  const vars: Vars = { file, today, date: dayOf(d.date) }
  if (d.quote !== undefined) vars.quote = sharpOf(d.quote)
  if (d.kind === 'decision') vars.decision = decisionText(d)
  if (swing !== undefined) {
    const unit = swing.unit
    vars.old = `${swing.label} ${swing.back}${unit}`
    vars.new = swing.decided
    vars.thing = unit === 'px' ? `the ${swing.label} size` : `the ${swing.label} colour`
    vars.n = String(swing.n)
    vars.days = String(days(d.date, nowMs))
    if (swing.born !== undefined) vars.born = dayOf(swing.born)
    if (swing.history !== undefined) vars.history = swing.history.join(' → ')
    if (swing.dates !== undefined && swing.dates.length > 0) {
      vars.dates = swing.dates.map(dayOf).join(', ')
      vars.first = dayOf(swing.dates[0] ?? '')
    }
  }
  return vars
}

/** Composes the card for an edit; `last` is the last template each pool used. */
export function compose(args: {
  id: string
  file: string
  ranked: readonly Ranked[]
  all: readonly Ghost[]
  swing?: Swing
  nowMs: number
  today: string
  last: Picked
}): { card: Card; used: Picked } | undefined {
  const top = args.ranked[0]?.ghost
  if (top === undefined) return undefined
  const vars = varsOf(args.file, top, args.swing, args.nowMs, args.today)
  const n = args.swing?.n ?? 1
  const level = levelOf(n)
  const base = { id: args.id, file: args.file, n, level, mode: 'haunt' as const, more: args.ranked.length - 1, vars: vars as Record<string, string> }
  const used: Picked = {}
  if (args.swing !== undefined) {
    const overrule = { old: vars.old ?? '', new: vars.new ?? '', date: args.swing.decision.date, decision: vars.decision ?? '', thing: vars.thing ?? '' }
    if (n >= 2) {
      const want = n >= 5 ? ['n5'] : n === 4 ? ['n4'] : n === 3 ? [vars.days === '0' ? 'n3-today' : 'n3'] : ['n2']
      const t = REPEAT.find(one => one.id === want[0])
      const filled = t === undefined ? undefined : fillTemplate(t, vars)
      const buttons = pick(REPEAT_BUTTONS, vars, args.last.repeatButtons)
      if (filled !== undefined && buttons?.buttons !== undefined) {
        used.repeat = filled.id
        used.repeatButtons = buttons.id
        return { card: { ...base, kind: 'swing', lines: filled.lines, buttons: buttons.buttons, overrule }, used }
      }
    }
    const first = pick(SWING, vars, args.last.swing)
    if (first?.buttons !== undefined) {
      used.swing = first.id
      // The tombstone line gets a gravestone beside the desktop ghost; it needs {born}, as the line does.
      const tomb = first.id === 's3' && vars.old !== undefined && vars.born !== undefined && vars.date !== undefined ? { name: vars.old, born: vars.born, died: vars.date } : undefined
      return { card: { ...base, kind: 'swing', lines: first.lines, buttons: first.buttons, overrule, ...(tomb === undefined ? {} : { tomb }) }, used }
    }
  }
  const history = pick(HISTORY, vars, args.last.history)
  if (history?.buttons !== undefined) {
    used.history = history.id
    return { card: { ...base, kind: 'history', lines: history.lines, buttons: history.buttons }, used }
  }
  return { card: { ...base, kind: 'plain', lines: [lineOf(top, args.all)], buttons: ['Let me rest', 'Noted'] }, used }
}

/**
 * What Claude is asked after the owner overrules the ghost. The mod itself
 * writes nothing. `decisionsFile` is the project's decisions log (relative
 * path), or undefined when the project has none yet.
 */
export function overruleNoteOf(card: GhostCard, button: string, today: string, decisionsFile?: string): string {
  const o = card.overrule
  if (o === undefined) return ''
  const where = decisionsFile === undefined || decisionsFile === '' ? "the project's decisions log (create one if it has none)" : decisionsFile
  return [
    `clawd-ghost: the owner pressed "${button}" on the ghost for ${card.file}: they want ${o.old} back on purpose, overruling the ${o.date} decision (${o.decision}).`,
    `Please record this as a new owner decision in ${where} through the project's normal process (newest first; why: the owner chose ${o.old} on purpose on ${today}; replaces: the ${o.date} line on ${o.thing}), so the next ghost knows.`,
    'clawd-ghost wrote nothing itself.',
  ].join(' ')
}

