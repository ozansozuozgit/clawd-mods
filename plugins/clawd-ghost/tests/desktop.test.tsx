import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { altOf, COMPACT_SCALE, desktopArt, SCALE, SVG_LIMIT } from '../hooks/desktop.ts'
import { DESKTOP_TEXT, STYLE } from '../hooks/sprite.ts'
import type { Tomb } from '../hooks/desktop.ts'
import { BAND, FIRST_SWING, ROOT, SEESAW, withValues, worldOf } from './fixtures.ts'

const NAME = 'clawd-ghost'
const HERO_BEFORE = '  --t-display: clamp(40px, 5vw, 56px);   /* the hero */'
const HERO_AFTER = '  --t-display: clamp(40px, 5vw, 64px);   /* the hero */'
const heroEdit = { tool: 'Edit' as const, file_path: `${ROOT}/app/base.css`, old_string: HERO_BEFORE, new_string: HERO_AFTER }
const TOMB: Tomb = { name: 'hero 64px', born: '10 May', died: '12 May' }
const ENTRANCE = /values="0 14;0 0"/g

const desk = ($: Engine, bodyColumns = 120) =>
  $.ui.mount({ plugin: NAME, surface: 'desktop', component: 'AbovePrompt', props: { ...BAND.props, bodyColumns }, viewport: { columns: 160, rows: 48 } })

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length

describe('the desktop art', () => {
  test('big: 11 px a sprite pixel, the ghost 132 px wide, crisp, in a 17×14 canvas', () => {
    for (const level of [1, 2, 3] as const) {
      const art = desktopArt({ level, isEntering: true, isCompact: false })
      expect(art.scale).toBe(SCALE)
      expect(12 * art.scale).toBe(132)
      expect(art.width).toBe(187)
      expect(art.height).toBe(154)
      expect(art.source).toContain('viewBox="0 0 17 14"')
      expect(art.source).toContain('shape-rendering="crispEdges"')
      expect(art.source).toContain(`fill="${STYLE[level].color}"`)
      expect(art.source.length).toBeLessThan(SVG_LIMIT)
    }
  })

  test('the levels: faint, more solid, solid and grumpy with a rattling chain and one shake', () => {
    const [l1, l2, l3] = ([1, 2, 3] as const).map(level => desktopArt({ level, isEntering: false, isCompact: false }).source)
    const bodyOpacity = (s: string, color: string) => Number(s.match(new RegExp(`fill="${color}" fill-opacity="([\\d.]+)"`))?.[1])
    expect(bodyOpacity(l1 ?? '', STYLE[1].color)).toBeLessThan(bodyOpacity(l2 ?? '', STYLE[2].color))
    expect(bodyOpacity(l3 ?? '', STYLE[3].color)).toBe(1)
    for (const s of [l1, l2]) {
      expect(s).not.toContain('type="rotate"')
      expect(s).not.toContain('values="0 0;-0.5 0')
    }
    expect(l3).toContain('type="rotate"')
    expect(count(l3 ?? '', /values="0 0;-0.5 0;0.5 0;-0.35 0;0.35 0;0 0"[^>]*fill="freeze"/g), 'shakes once').toBe(1)
  })

  test('a ghost on a light card: a lavender halo, an outline, a dark face, a wavy hem in two frames', () => {
    const s = desktopArt({ level: 1, isEntering: false, isCompact: false }).source
    expect(s).toContain('radialGradient id="halo"')
    expect(s).toContain('fill="#7F77DD" fill-opacity="0.5"')
    expect(s).toContain('fill="#3C3489"')
    expect(count(s, /calcMode="discrete" repeatCount="indefinite"/g)).toBe(2)
  })

  test('the entrance is there once while haunting, and never after a press; the float bob always', () => {
    const entering = desktopArt({ level: 2, isEntering: true, isCompact: false }).source
    const after = desktopArt({ level: 2, isEntering: false, isCompact: false }).source
    expect(count(entering, ENTRANCE)).toBe(1)
    expect(count(after, ENTRANCE)).toBe(0)
    expect(entering).toContain('values="0 0;0 -0.75;0 0" dur="2.4s" begin="0.6s" repeatCount="indefinite"')
    expect(after).toContain('values="0 0;0 -0.75;0 0" dur="2.4s" begin="0s" repeatCount="indefinite"')
  })

  test('compact when really narrow: 6 px a pixel, and no stone', () => {
    const art = desktopArt({ level: 3, isEntering: true, isCompact: true, tomb: TOMB })
    expect(art.scale).toBe(COMPACT_SCALE)
    expect(art.width).toBe(102)
    expect(art.source).not.toContain('R.I.P.')
  })

  test('the gravestone: dates in text of 11 px or more, and the alt says it too', () => {
    const art = desktopArt({ level: 1, isEntering: true, isCompact: false, tomb: TOMB })
    expect(art.width).toBe((17 + 13) * SCALE)
    for (const word of ['R.I.P.', 'hero 64px', '10 May', '– 12 May']) expect(art.source).toContain(`>${word}</text>`)
    const sizes = [...art.source.matchAll(/font-size="([\d.]+)"/g)].map(m => Number(m[1]) * art.scale)
    expect(sizes.length).toBe(4)
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(11)
    expect(altOf(1, ['Here lies hero 64px · 10 May – 12 May', '"the hero feels too loud"'], TOMB)).toBe(
      'Faint ghost Clawd: Here lies hero 64px · 10 May – 12 May "the hero feels too loud" Beside it a gravestone: R.I.P. hero 64px, 10 May – 12 May.',
    )
  })
})

/** WCAG contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe('legibility on the light card', () => {
  test('every punchline colour is 4.5:1 or better on #EFEFEF, darker with each level', () => {
    const ratios = ([1, 2, 3] as const).map(level => contrast(DESKTOP_TEXT[level], '#EFEFEF'))
    for (const r of ratios) expect(r).toBeGreaterThanOrEqual(4.5)
    expect(ratios[0]).toBeLessThan(ratios[1] ?? 0)
    expect(ratios[1]).toBeLessThan(ratios[2] ?? 0)
  })

  test('the faint ghost does not vanish: level 1 body at 0.7 opacity or more', () => {
    const s = desktopArt({ level: 1, isEntering: false, isCompact: false }).source
    const opacity = Number(s.match(new RegExp(`fill="${STYLE[1].color}" fill-opacity="([\\d.]+)"`))?.[1])
    expect(opacity).toBeGreaterThanOrEqual(0.7)
  })

  test('the band draws the level-1 punchline in the legible colour', async ($, on) => {
    worldOf(on)
    await $.tool.call(heroEdit)
    const ui = await desk($)
    expect((await ui.findAll({ type: 'Text' }))[0]?.props.color).toBe('#5B52C4')
    await ui.unmount()
  })
})

describe('the desktop band', () => {
  test('ghost left, three lines right, buttons below; alt is the punchline and the fact', async ($, on) => {
    worldOf(on)
    await $.tool.call(heroEdit)
    const ui = await desk($)
    const tree = await ui.drawn()
    expect(tree.type).toBe('Box')
    expect((tree as { props?: Record<string, unknown> }).props?.flexDirection).toBe('column')
    const svg = await ui.find({ type: 'Svg' })
    expect(svg?.props.width).toBe(187)
    expect(svg?.props.isInteractive).toBe(true)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(String(svg?.props.alt)).toBe(`Faint ghost Clawd: ${texts[0]} ${texts[1]}`)
    expect(count(String(svg?.props.source), ENTRANCE)).toBe(1)
    expect((await ui.find({ key: 'rest' }))?.props.hotkey).toBe('1')
    expect(texts.some(t => t.includes('app/base.css')), 'the file under the buttons').toBe(true)
    await ui.unmount()
  })

  test('after a press the ghost stays without replaying the entrance', async ($, on) => {
    worldOf(on)
    await $.tool.call(heroEdit)
    const ui = await desk($)
    await ui.press({ key: 'rest' })
    const svg = await ui.find({ type: 'Svg' })
    expect(count(String(svg?.props.source), ENTRANCE)).toBe(0)
    await ui.unmount()
  })

  test('full size on the Desktop band at any ordinary width (60, 80, 120 columns)', async ($, on) => {
    worldOf(on)
    await $.tool.call(heroEdit)
    for (const columns of [60, 80, 120]) {
      const ui = await desk($, columns)
      expect((await ui.find({ type: 'Svg' }))?.props.width, `${columns} columns`).toBe(187)
      await ui.unmount()
    }
  })

  test('compact only on a really narrow band (under 50 columns): a smaller ghost and no file line', async ($, on) => {
    worldOf(on)
    await $.tool.call(heroEdit)
    const ui = await desk($, 40)
    expect((await ui.find({ type: 'Svg' }))?.props.width).toBe(102)
    expect((await ui.findAll({ type: 'Text' })).some(t => t.text.includes('app/base.css'))).toBe(false)
    await ui.unmount()
  })

  test('the gravestone comes with the tombstone line, which needs {born}', async ($, on) => {
    // 64 (10 May) → 56 (12 May), the edit back is reversal #1; the swing pool last said s2, so s3 is next.
    worldOf(on, withValues(FIRST_SWING), undefined, { rotation: { swing: 's2' } })
    await $.tool.call(heroEdit)
    const ui = await desk($)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts[0]).toBe('Here lies hero 64px · 10 May – 12 May')
    const svg = await ui.find({ type: 'Svg' })
    expect(String(svg?.props.source)).toContain('>R.I.P.</text>')
    expect(String(svg?.props.alt)).toContain('gravestone: R.I.P. hero 64px, 10 May – 12 May')
    await ui.unmount()
  })

  test('no {born}, no tombstone and no stone, whatever the rotation says', async ($, on) => {
    worldOf(on, undefined, undefined, { rotation: { swing: 's2' } })
    await $.tool.call(heroEdit)
    const ui = await desk($)
    expect((await ui.findAll({ type: 'Text' }))[0]?.text).not.toMatch(/^Here lies/)
    expect(String((await ui.find({ type: 'Svg' }))?.props.source)).not.toContain('R.I.P.')
    await ui.unmount()
  })

  test('level 3 on desktop: grumpy alt, chain, deep punchline colour', async ($, on) => {
    worldOf(on, withValues(SEESAW))
    await $.tool.call(heroEdit)
    const ui = await desk($)
    const svg = await ui.find({ type: 'Svg' })
    expect(String(svg?.props.alt)).toMatch(/^Grumpy ghost Clawd: /)
    expect(String(svg?.props.source)).toContain('type="rotate"')
    expect((await ui.findAll({ type: 'Text' }))[0]?.props.color).toBe('#3B3392')
    await ui.unmount()
  })
})
