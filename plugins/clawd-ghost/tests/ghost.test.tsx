import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { lineOf, rank, redactorOf, swingOf, tokenize, undoKeysOf } from '../hooks/ghost.ts'
import { BAND, BASE_CSS, BOLDER, command, DARK, DISPLAY_HISTORY, HERO_WORDS, INDEX, ROOT, SEESAW, SEMIBOLD, STEP_DOWN, withValues, worldOf } from './fixtures.ts'

const NAME = 'clawd-ghost'
const HERO_BEFORE = '  --t-display: clamp(40px, 5vw, 56px);   /* the hero */'
const HERO_AFTER = '  --t-display: clamp(40px, 5vw, 64px);   /* the hero */'
const heroEdit = { tool: 'Edit' as const, file_path: `${ROOT}/app/base.css`, old_string: HERO_BEFORE, new_string: HERO_AFTER }
const mountBand = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', isWorking = true) =>
  $.ui.mount({ plugin: NAME, surface, component: 'AbovePrompt', props: { ...BAND.props, isWorking }, viewport: BAND.viewport })

const notesOf = (ran: { context?: readonly string[] }) => (ran.context ?? []).filter(note => note.startsWith('clawd-ghost'))

describe('lookup', () => {
  test('a hit: the hero type edit raises the 12 May step-down first', () => {
    const ranked = rank(INDEX.files['app/base.css'], { before: HERO_BEFORE, after: HERO_AFTER })
    expect(ranked[0]?.ghost).toBe(STEP_DOWN)
    expect(ranked.map(r => r.ghost)).toContain(SEMIBOLD)
    expect(ranked.map(r => r.ghost), 'a colour decision needs a colour edit').not.toContain(DARK)
  })

  test('a miss: a file with no history raises nothing, and neither does an unrelated edit to a topic file', () => {
    expect(rank(INDEX.files['app/robots.ts'], { before: 'a', after: 'b' })).toEqual([])
    expect(rank(INDEX.files['app/base.css'], { before: '.x { margin: 0 }', after: '.x { margin: 4px }' })).toEqual([])
  })

  test('a colour edit raises the colour decision, not the type one', () => {
    const ranked = rank(INDEX.files['app/base.css'], { before: '--accent: #e07a5f;', after: '--accent: #1b1410;' })
    expect(ranked[0]?.ghost).toBe(DARK)
    expect(ranked.map(r => r.ghost)).not.toContain(STEP_DOWN)
  })

  test('file ghosts show for any edit of their file', () => {
    expect(rank(INDEX.files['components/Hero.tsx'], { before: 'a', after: 'b' })[0]?.ghost).toBe(HERO_WORDS)
  })

  test('the replaced sizes read as px, and tokens see custom properties and topics', () => {
    expect(undoKeysOf('64/52/26/20/17/15')).toEqual(['64px', '52px'])
    expect(tokenize(HERO_AFTER)).toEqual(expect.arrayContaining(['--t-display', '64px', 'topic:type']))
  })

  test('the plain line carries the date, the sharpest words, the commit beside it and what it undoes', () => {
    const line = lineOf(STEP_DOWN, [STEP_DOWN, BOLDER])
    expect(line).toContain('Ghost of 12 May')
    expect(line).toContain('"the hero feels too loud"')
    expect(line).toContain('64/52/26/20/17/15')
  })
})

describe('the swing and its count', () => {
  const ranked = () => rank(INDEX.files['app/base.css'], { before: HERO_BEFORE, after: HERO_AFTER })

  test('the hero edit is a swing back: hero 64px over the decided 56', () => {
    const swing = swingOf(ranked(), { before: HERO_BEFORE, after: HERO_AFTER })
    expect(swing).toMatchObject({ decision: STEP_DOWN, label: 'hero', back: '64', decided: '56', unit: 'px', n: 1 })
  })

  test('with the value history it counts reversals: 60 → 64 → 56 → 64 is #2, a seesaw is #3', () => {
    const real = swingOf(ranked(), { before: HERO_BEFORE, after: HERO_AFTER }, { '--t-display': DISPLAY_HISTORY })
    expect(real).toMatchObject({ history: ['60', '64', '56', '64'], born: '2026-05-12', n: 2 })
    const seesaw = swingOf(ranked(), { before: HERO_BEFORE, after: HERO_AFTER }, { '--t-display': SEESAW })
    expect(seesaw?.n).toBe(3)
  })

  test('not a swing when the edit moves away from both values', () => {
    expect(swingOf(ranked(), { before: HERO_BEFORE, after: HERO_BEFORE.replace('56px', '50px') })).toBeUndefined()
  })
})

describe('the edit hook', () => {
  test('the hero type case: the ghost shows with its two buttons, and Claude gets the same facts', async ($, on) => {
    worldOf(on)
    const ran = await $.tool.call(heroEdit)

    const notes = notesOf(ran)
    expect(notes.length).toBe(1)
    expect(notes[0]).toContain('app/base.css')
    expect(notes[0]).toContain('the hero feels too loud')
    expect(notes[0]).toContain('It replaced: 64/52/26/20/17/15')
    expect(notes[0]).toContain('This edit brings back hero 64px for the hero size, which the 2026-05-12 decision replaced with 56.')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await mountBand($, surface)
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      expect(texts.join('\n')).toContain('the hero feels too loud')
      expect(texts.join('\n')).toContain('hero 64px')
      expect((await ui.find({ key: 'rest' }))?.props.hotkey).toBe('1')
      expect((await ui.find({ key: 'overrule' }))?.props.hotkey).toBe('2')
      await ui.unmount()
    }
  })

  test('quiet for a file with no history: no ghost, no note', async ($, on) => {
    worldOf(on)
    const ran = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/app/robots.ts`, old_string: 'a', new_string: 'b' })
    expect(notesOf(ran)).toEqual([])
    const ui = await mountBand($)
    expect(await ui.find({ key: 'rest' })).toBeUndefined()
    await ui.unmount()
  })

  test('quiet with no index yet', async ($, on) => {
    worldOf(on, null)
    const ran = await $.tool.call(heroEdit)
    expect(notesOf(ran)).toEqual([])
  })

  test('no repeat: the same file raises its ghost once a session', async ($, on) => {
    worldOf(on)
    const first = await $.tool.call(heroEdit)
    const second = await $.tool.call({ ...heroEdit, old_string: HERO_AFTER, new_string: HERO_BEFORE })
    expect(notesOf(first).length).toBe(1)
    expect(notesOf(second)).toEqual([])
  })

  test('no deny: the edit reaches the tool exactly as asked, and a refusal beneath passes through untouched', async ($, on) => {
    const world = worldOf(on)
    const ran = await $.tool.call(heroEdit)
    expect(ran.deny).toBeUndefined()
    expect(world.toolCalls.length).toBe(1)
    expect(world.toolCalls[0]).toMatchObject({ tool: 'Edit', file_path: heroEdit.file_path, old_string: HERO_BEFORE, new_string: HERO_AFTER })

    world.denyNext = true
    const refused = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/components/Hero.tsx`, old_string: 'a', new_string: 'b' })
    expect(world.toolCalls.length).toBe(2)
    expect(refused.isError === true || refused.deny !== undefined).toBe(true)
    expect(notesOf(refused)).toEqual([])
  })

  test('Write compares against the file on disk, so only what it changes counts', async ($, on) => {
    worldOf(on)
    const ran = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/app/base.css`, content: BASE_CSS.replace('56px', '64px') })
    expect(notesOf(ran)[0]).toContain('the hero feels too loud')
  })

  test('other tools pass straight through', async ($, on) => {
    const world = worldOf(on)
    const ran = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/app/base.css` })
    expect(notesOf(ran)).toEqual([])
    expect(world.toolCalls.length).toBe(1)
  })
})

describe('escalation', () => {
  test('n=1 is faint, calm, and floats by blit', async ($, on) => {
    const world = worldOf(on)
    await $.tool.call(heroEdit)
    const ui = await mountBand($)
    const punch = (await ui.findAll({ type: 'Text' }))[0]
    expect(punch?.props.color).toBe('#D3CFF5')
    const raster = await ui.find({ type: 'Raster' })
    await world.clock.advance(1500)
    expect(world.blits, 'two float frames').toBeGreaterThan(0)
    expect((await ui.find({ type: 'Raster' }))?.props.cells).toBe(raster?.props.cells)
    await ui.unmount()
  })

  test('n=2 is more solid; the real hero history says reversal #2', async ($, on) => {
    worldOf(on, withValues(DISPLAY_HISTORY))
    const ran = await $.tool.call(heroEdit)
    expect(notesOf(ran)[0]).toContain('60 → 64 → 56 → 64 (reversal #2)')
    const ui = await mountBand($)
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts[0]?.props.color).toBe('#AFA9EC')
    expect(texts[0]?.text).toBe('Back again? Reversal #2 on the hero size.')
    await ui.unmount()
  })

  test('n=3 is solid purple and grumpy, on both surfaces', async ($, on) => {
    worldOf(on, withValues(SEESAW))
    await $.tool.call(heroEdit)
    const ui = await mountBand($)
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts[0]?.props.color).toBe('#7F77DD')
    expect(texts[0]?.text).toBe("Third time. I've been dead 5 days and you keep digging.")
    expect(texts[1]?.text).toBe('The hero size has swung 64 → 56 → 64 → 56 → 64.')
    await ui.unmount()
    const desk = await mountBand($, 'desktop')
    const svg = await desk.find({ type: 'Svg' })
    expect(String(svg?.props.source)).toContain('#7F77DD')
    expect(String(svg?.props.source)).toContain('animateTransform')
    expect(String(svg?.props.alt)).toMatch(/^Grumpy ghost Clawd: Third time/)
    await desk.unmount()
  })

  test('n=3 on the day of the decision: "I died this morning"', async ($, on) => {
    worldOf(on, withValues(SEESAW), Date.parse('2026-05-12T21:00:00'))
    await $.tool.call(heroEdit)
    const ui = await mountBand($)
    expect((await ui.findAll({ type: 'Text' }))[0]?.text).toBe("I died this morning and you're already digging.")
    await ui.unmount()
  })
})

describe('the buttons', () => {
  test('1 rests: a parting line, gone after about 4 s, and nothing for Claude', async ($, on) => {
    const world = worldOf(on)
    await $.tool.call(heroEdit)
    const ui = await mountBand($)
    await ui.press({ key: 'rest' })
    const after = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(after.length).toBe(1)
    expect(["Fine. I'll be in the attic.", 'Resting. Wake me if you reverse it again.', 'Back to the crypt. The hero size stays 56.']).toContain(after[0])
    await world.clock.advance(4100)
    expect(await ui.find({ key: 'rest' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['(engine band)'])
    const next = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/app/base.css` })
    expect(notesOf(next)).toEqual([])
    await ui.unmount()
  })

  test('2 overrules mid-turn: Claude is asked on the next tool result; the mod writes no file', async ($, on) => {
    const world = worldOf(on)
    await $.tool.call(heroEdit)
    const ui = await mountBand($, 'terminal', true)
    await ui.press({ key: 'overrule' })
    const line = (await ui.findAll({ type: 'Text' }))[0]?.text ?? ''
    expect(line).toMatch(/^(Overruled\. Telling Claude to log it|Resurrected\. Claude will note: 17 May, you chose hero 64px on purpose\.|Fine, I'm back\.)/)
    const next = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/app/base.css` })
    const asked = notesOf(next).join('\n')
    expect(asked).toContain('they want hero 64px back on purpose, overruling the 2026-05-12 decision')
    expect(asked).toContain('design/decisions.md')
    expect(asked).toContain('clawd-ghost wrote nothing itself.')
    const later = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/app/base.css` })
    expect(notesOf(later), 'asked once').toEqual([])
    expect(world.writes).toEqual([])
    expect(world.submitted).toEqual([])
    await ui.unmount()
  })

  test('2 overrules while idle: one prompt queued for Claude, still no file written', async ($, on) => {
    const world = worldOf(on)
    await $.tool.call(heroEdit)
    const ui = await mountBand($, 'terminal', false)
    await ui.press({ key: 'overrule' })
    await world.clock.advance(10)
    expect(world.submitted.length).toBe(1)
    expect(world.submitted[0]).toContain('design/decisions.md')
    expect(world.writes).toEqual([])
    await ui.unmount()
  })

  test('2 on a history-only ghost is just "Noted": no note for Claude', async ($, on) => {
    const world = worldOf(on)
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/components/Hero.tsx`, old_string: 'a', new_string: 'b' })
    const ui = await mountBand($)
    await ui.press({ key: 'overrule' })
    expect(await ui.find({ key: 'rest' })).toBeUndefined()
    const next = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/app/base.css` })
    expect(notesOf(next)).toEqual([])
    expect(world.submitted).toEqual([])
    await ui.unmount()
  })
})

describe('session and /ghost', () => {
  test('session start registers /ghost and builds the index in the background', async ($, on) => {
    const world = worldOf(on, null)
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    for (let i = 0; i < 50 && world.spawned.length === 0; i++) await Promise.resolve()
    expect(world.commands).toEqual(['ghost'])
    expect(world.spawned[0]?.some(arg => arg.endsWith('/scripts/build-index.mjs'))).toBe(true)
    expect(world.spawned[0]).toEqual(expect.arrayContaining([ROOT, expect.stringMatching(/\/\.data\/work\.json$/)]))
  })

  test('/ghost lists the ghosts for the files this session touched', async ($, on) => {
    worldOf(on)
    await $.tool.call(heroEdit)
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/components/Hero.tsx`, old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/app/robots.ts`, old_string: 'a', new_string: 'b' })
    const out = await $.command.run(command('ghost'))
    expect(out.text).toContain('app/base.css')
    expect(out.text).toContain('components/Hero.tsx')
    expect(out.text).not.toContain('robots')
    expect(out.text).toContain('too loud')
  })
})

describe('privacy', () => {
  test('no surname: removed from words, user names and paths alike', () => {
    const redact = redactorOf(['Doe'])
    const out = redact('see @"/home/janedoe/site/app/base.css" — Jane Doe said "too big"; DOE again')
    expect(out.toLowerCase()).not.toContain('doe')
    expect(out).toContain('base.css')
    expect(out).toContain('Jane')
    // A macOS home or temp path shortens to its file name the same way.
    expect(redact('saved to /private/tmp/janedoe-run/notes.md')).toBe('saved to notes.md')
  })
})
