import { describe, expect, test } from 'claude-code/testing'

import { compose, decisionText, fill, fillTemplate, HISTORY, levelOf, OVERRULE, overruleNoteOf, pick, POOLS, REPEAT, REPEAT_BUTTONS, REST, SWING } from '../hooks/copy.ts'
import type { Template, VarName, Vars } from '../hooks/copy.ts'
import { rank, swingOf } from '../hooks/ghost.ts'
import type { Ghost } from '../hooks/ghost.ts'
import { CALM, cellsOf, GRUMPY, pixelsOf, STYLE } from '../hooks/sprite.ts'
import { HERO_WORDS, INDEX, NOW, SEESAW } from './fixtures.ts'

const ALL: Vars = {
  old: 'hero 64px',
  new: '56',
  date: '12 May',
  quote: 'the hero feels too loud',
  decision: 'a quieter hero: hero 56, titles 44',
  file: 'app/base.css',
  born: '12 May',
  n: '3',
  thing: 'the hero size',
  days: '5',
  history: '60 → 64 → 56 → 64',
  first: '10 May',
  dates: '10 May, 12 May, 13 May',
  today: '17 May',
}

const needs = (t: Template): VarName[] =>
  [...new Set([...t.lines, ...(t.buttons ?? [])].flatMap(l => [...l.matchAll(/\{([a-z]+)\}/g)].map(m => m[1] as VarName)))]

const heroEdit = { before: '--t-display: clamp(40px, 5vw, 56px);', after: '--t-display: clamp(40px, 5vw, 64px);' }

describe('templates', () => {
  test('every template fills when all its placeholders are known, and never when one is missing', () => {
    for (const pool of Object.values(POOLS)) {
      for (const t of pool) {
        const filled = fillTemplate(t, ALL)
        expect(filled, t.id).toBeDefined()
        expect([...(filled?.lines ?? []), ...(filled?.buttons ?? [])].join(' '), t.id).not.toMatch(/\{[a-z]+\}/)
        for (const name of needs(t)) {
          const rest: Vars = { ...ALL }
          delete rest[name]
          expect(fillTemplate(t, rest), `${t.id} without {${name}}`).toBeUndefined()
        }
      }
    }
  })

  test('the pools: six swings, two histories, the repeats, three rests, three overrules', () => {
    expect(SWING.map(t => t.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6'])
    expect(HISTORY.length).toBe(2)
    expect(REPEAT.map(t => t.id)).toEqual(['n2', 'n3', 'n3-today', 'n4', 'n5'])
    expect(REPEAT_BUTTONS.length).toBe(3)
    expect(REST.length).toBe(3)
    expect(OVERRULE.length).toBe(3)
    expect(fillTemplate(SWING[0] as Template, ALL)?.lines).toEqual([
      "Boooo. I'm hero 64px. You buried me on 12 May.",
      'Your last words: "the hero feels too loud"',
      'Bring me back and you undo: a quieter hero: hero 56, titles 44.',
    ])
  })

  test("the owner's words stay verbatim; only the ghost's own words take a capital", () => {
    expect(fill('{quote}', { quote: 'not sure yet. the hero feels too loud' })).toBe('not sure yet. the hero feels too loud')
    expect(fill('Fine. {thing} stays {new}.', { thing: 'the hero size', new: '56' })).toBe('Fine. The hero size stays 56.')
    expect(fill('Keep {old} for good', { old: 'hero 64px' })).toBe('Keep hero 64px for good')
  })

  test('the decision is cut at a comma, never mid-item', () => {
    const d = INDEX.files['app/base.css']?.[0] as Ghost
    expect(decisionText(d)).toBe('a quieter hero: hero 56, titles 44, items 22, lead 20')
  })

  test('the tombstone needs {born}: without it, s3 is never picked', () => {
    const noBorn: Vars = { ...ALL }
    delete noBorn.born
    let last: string | undefined
    for (let i = 0; i < 20; i++) {
      const got = pick(SWING, noBorn, last)
      expect(got?.id).not.toBe('s3')
      last = got?.id
    }
  })

  test('rotation never repeats back to back, and goes round every fitting line', () => {
    for (const pool of Object.values(POOLS)) {
      let last: string | undefined
      const seen = new Set<string>()
      for (let i = 0; i < 30; i++) {
        const got = pick(pool, ALL, last)
        expect(got).toBeDefined()
        if (pool.length > 1) expect(got?.id).not.toBe(last)
        seen.add(got?.id ?? '')
        last = got?.id
      }
      expect(seen.size).toBe(pool.length)
    }
  })

  test('a line is only as specific as the facts: no swing means history lines; no quote means the plain line', () => {
    const hero = rank(INDEX.files['components/Hero.tsx'], { before: 'a', after: 'b' })
    const owner = compose({ id: 'x', file: 'components/Hero.tsx', ranked: hero, all: [HERO_WORDS], nowMs: NOW, today: '17 May', last: {} })
    expect(owner?.card.kind, 'an owner quote has no decision: neither history template fits').toBe('plain')
    const noQuote: Ghost = { ...(INDEX.files['app/base.css']?.[0] as Ghost), quote: undefined }
    const plain = compose({ id: 'y', file: 'app/base.css', ranked: [{ ghost: noQuote, score: 1 }], all: [noQuote], nowMs: NOW, today: '17 May', last: {} })
    expect(plain?.card.kind).toBe('plain')
  })
})

describe('escalation', () => {
  test('level by reversal count: 1 faint, 2 more solid, 3 and up grumpy purple', () => {
    expect([1, 2, 3, 4, 9].map(levelOf)).toEqual([1, 2, 3, 3, 3])
    expect(STYLE[1].opacity).toBeLessThan(STYLE[2].opacity)
    expect(STYLE[3]).toEqual({ color: '#7F77DD', rgb: 0x7f77dd, opacity: 1, isGrumpy: true })
    expect(STYLE[1].isGrumpy || STYLE[2].isGrumpy).toBe(false)
  })

  test('the grumpy face: slanted brows and a flat mouth; the calm one is Clawd', () => {
    expect(pixelsOf(3, 0).slice(0, 7)).toEqual([...GRUMPY])
    expect(pixelsOf(1, 0).slice(0, 7)).toEqual([...CALM])
    expect(GRUMPY).toContain('.XXX....XXX.')
    expect(pixelsOf(1, 1)[0], 'frame 2 floats down a pixel').toBe('............')
    expect(cellsOf(1, 0)).not.toBe(cellsOf(1, 1))
    expect(cellsOf(1, 0)).not.toBe(cellsOf(3, 0))
  })

  test('the composed card escalates with the count: #3 is the grumpy "third time" line', () => {
    const ranked = rank(INDEX.files['app/base.css'], heroEdit)
    const swing = swingOf(ranked, heroEdit, { '--t-display': SEESAW })
    const got = compose({ id: 'z', file: 'app/base.css', ranked, all: [], swing, nowMs: NOW, today: '17 May', last: {} })
    expect(got?.card).toMatchObject({ kind: 'swing', n: 3, level: 3 })
    expect(got?.card.lines[0]).toBe("Third time. I've been dead 5 days and you keep digging.")
  })

  test('days = 0 says it died this morning', () => {
    const ranked = rank(INDEX.files['app/base.css'], heroEdit)
    const swing = swingOf(ranked, heroEdit, { '--t-display': SEESAW })
    const got = compose({ id: 'z', file: 'app/base.css', ranked, all: [], swing, nowMs: Date.parse('2026-05-12T09:00:00'), today: '12 May', last: {} })
    expect(got?.card.lines[0]).toBe("I died this morning and you're already digging.")
  })
})

describe('overrule', () => {
  test('the note asks Claude to log it through the normal process and says the mod wrote nothing', () => {
    const ranked = rank(INDEX.files['app/base.css'], heroEdit)
    const swing = swingOf(ranked, heroEdit)
    const got = compose({ id: 'o', file: 'app/base.css', ranked, all: [], swing, nowMs: NOW, today: '17 May', last: {} })
    const card = got?.card
    expect(card).toBeDefined()
    if (card === undefined) return
    const note = overruleNoteOf(card, card.buttons[1], '17 May', 'docs/decisions.md')
    expect(note).toContain('they want hero 64px back on purpose, overruling the 2026-05-12 decision')
    expect(note).toContain("docs/decisions.md through the project's normal process")
    expect(note).toContain('clawd-ghost wrote nothing itself.')
    expect(overruleNoteOf(card, card.buttons[1], '17 May'), 'no decisions log yet').toContain("the project's decisions log (create one if it has none)")
    for (const t of OVERRULE) expect(t.lines.join(' '), 'no line claims the ghost logged it').not.toMatch(/\b(I|I've|I have) (logged|wrote|recorded|updated)\b/)
  })
})
