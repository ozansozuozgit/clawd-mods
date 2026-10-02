// The desktop ghost: one inline SVG, pixel-crisp, sized for the Desktop app's
// light band card. One SVG unit is one sprite pixel; the scale sets the size
// (11 px a pixel: the ghost is 132 px wide; 6 when the band is really narrow).
//
// Animation is SMIL only (the Svg is drawn with isInteractive): a "boo"
// entrance rising from below the band's edge while the ghost haunts, a slow
// float, a wavy hem, and on level 3 one shake and a rattling chain.

// The character (pixels, palette, names) comes from sprite.ts; this file only
// lays it out as SVG, with the ghost's props (halo, chain, gravestone).
import { bodyOf, FACE_INK, HEMS, LOOK, NAMES, STYLE } from './sprite.ts'
import type { Level } from './sprite.ts'

/** A gravestone beside the ghost, for the tombstone line. */
export type Tomb = { name: string; born: string; died: string }

export type DesktopArt = { source: string; width: number; height: number; scale: number }

/**
 * Below this many columns the band is narrow and the art draws compact. The Desktop band
 * spans the prompt's width (900 px and more), so only a really narrow band goes compact.
 */
export const COMPACT_COLUMNS = 50
/** 11 px a sprite pixel: the ghost is 132 px wide. */
export const SCALE = 11
export const COMPACT_SCALE = 6
/** The Svg element's own limit on `source`. */
export const SVG_LIMIT = 131072

const GHOST_W = 17
const GHOST_H = 14
const TOMB_W = 12
/** Where the sprite's top-left pixel sits in the canvas. */
const AT_X = 2
const AT_Y = 2

/** The face rows (eyes, brows, mouth) of each look, without the legs. */
const HEAD = (level: Level): readonly string[] => bodyOf(level).slice(0, 5)

const isOn = (rows: readonly string[], x: number, y: number): boolean => rows[y]?.[x] === 'X'

/** Body pixels, the face (holes inside a row's span), and the outline (empty pixels touching the body). */
function layers(rows: readonly string[]): { body: [number, number][]; face: [number, number][]; outline: [number, number][] } {
  const body: [number, number][] = []
  const face: [number, number][] = []
  const outline: [number, number][] = []
  for (let y = -1; y <= rows.length; y++) {
    const row = rows[y] ?? ''
    const first = row.indexOf('X')
    const last = row.lastIndexOf('X')
    for (let x = -1; x <= 12; x++) {
      if (isOn(rows, x, y)) body.push([x, y])
      else if (y >= 0 && y < 5 && first >= 0 && x > first && x < last) face.push([x, y])
      else if (isOn(rows, x - 1, y) || isOn(rows, x + 1, y) || isOn(rows, x, y - 1) || isOn(rows, x, y + 1)) outline.push([x, y])
    }
  }
  return { body, face, outline }
}

/** Pixels as rects, one per horizontal run, so no seams show between neighbours. */
function rects(pixels: readonly [number, number][]): string {
  const rows = new Map<number, number[]>()
  for (const [x, y] of pixels) rows.set(y, [...(rows.get(y) ?? []), x])
  let out = ''
  for (const [y, xs] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...new Set(xs)].sort((a, b) => a - b)
    let start = sorted[0] ?? 0
    let prev = start
    for (const x of [...sorted.slice(1), Number.NaN]) {
      if (x === prev + 1) {
        prev = x
        continue
      }
      out += `<rect x="${start}" y="${y}" width="${prev - start + 1}" height="1"/>`
      start = x
      prev = x
    }
  }
  return out
}

/** The rattling chain on level 3: links hanging from the right arm, swinging fast. */
const CHAIN =
  '<g fill="#6E6A86" shape-rendering="crispEdges"><rect x="12" y="3.5" width="0.9" height="0.9"/><rect x="12.2" y="4.5" width="0.9" height="0.9" fill-opacity="0.6"/><rect x="12.4" y="5.5" width="0.9" height="0.9"/><rect x="12.6" y="6.5" width="0.9" height="0.9" fill-opacity="0.6"/><rect x="12.6" y="7.4" width="1.3" height="1.3"/>' +
  '<animateTransform attributeName="transform" type="rotate" values="-14 12 3.5;12 12 3.5;-8 12 3.5;10 12 3.5;-14 12 3.5" dur="0.5s" repeatCount="indefinite"/></g>'

function tombOf(tomb: Tomb, x0: number): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // 1.5 units at 11 px a unit is 16.5 px; at the compact 6 px it is 9 px, so the compact card drops the stone.
  const text = (y: number, s: string, size = 1.5) =>
    `<text x="${x0 + TOMB_W / 2}" y="${y}" font-size="${size}" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" fill="#4A4658">${esc(s)}</text>`
  return (
    `<g><path d="M${x0 + 0.5} ${GHOST_H} V5 Q${x0 + 0.5} 1.5 ${x0 + TOMB_W / 2} 1.5 Q${x0 + TOMB_W - 0.5} 1.5 ${x0 + TOMB_W - 0.5} 5 V${GHOST_H} Z" fill="#E4E2EA" stroke="#9C98AC" stroke-width="0.25"/>` +
    `<rect x="${x0 - 0.5}" y="${GHOST_H - 0.75}" width="${TOMB_W + 1}" height="0.75" fill="#B9C9A4"/>` +
    text(4.6, 'R.I.P.', 1.6) +
    text(7.2, tomb.name) +
    text(9.5, tomb.born) +
    text(11.6, `– ${tomb.died}`) +
    '</g>'
  )
}

/**
 * The desktop ghost for a level. `isEntering` adds the one-time "boo"
 * entrance (the haunting card has it; the after-press card does not).
 */
export function desktopArt(args: { level: Level; isEntering: boolean; isCompact: boolean; tomb?: Tomb }): DesktopArt {
  const { level, isEntering, isCompact } = args
  const tomb = isCompact ? undefined : args.tomb
  const look = LOOK[level]
  const color = STYLE[level].color
  const scale = isCompact ? COMPACT_SCALE : SCALE
  const units = GHOST_W + (tomb === undefined ? 0 : TOMB_W + 1)
  const head = HEAD(level)
  const frames = HEMS.map(hem => layers([...head, ...hem]))
  const still = layers([...head, ...(HEMS[0] ?? [])])
  const swap = (i: number) =>
    `<animate attributeName="opacity" values="${i === 0 ? '1;0;1' : '0;1;0'}" keyTimes="0;0.5;1" dur="1.2s" calcMode="discrete" repeatCount="indefinite"/>`
  // The head is the same in both frames; only the hem rows (5 and down) swap.
  const hemOnly = (px: readonly [number, number][]) => px.filter(([, y]) => y >= 5)
  const headOnly = (px: readonly [number, number][]) => px.filter(([, y]) => y < 5)
  const sprite =
    `<g shape-rendering="crispEdges">` +
    `<g fill="${look.outlineColor}" fill-opacity="${look.outline}">${rects(headOnly(still.outline))}</g>` +
    `<g fill="${color}" fill-opacity="${look.body}">${rects(headOnly(still.body))}</g>` +
    `<g fill="${FACE_INK}" fill-opacity="${look.face}">${rects(still.face)}</g>` +
    frames
      .map(
        (f, i) =>
          `<g opacity="${i === 0 ? 1 : 0}">${swap(i)}<g fill="${look.outlineColor}" fill-opacity="${look.outline}">${rects(hemOnly(f.outline))}</g><g fill="${color}" fill-opacity="${look.body}">${rects(hemOnly(f.body))}</g></g>`,
      )
      .join('') +
    (level === 3 ? CHAIN : '') +
    `</g>`
  const settle = isEntering ? '0.6s' : '0s'
  const bob = `<animateTransform attributeName="transform" type="translate" values="0 0;0 -0.75;0 0" dur="2.4s" begin="${settle}" repeatCount="indefinite"/>`
  const shake =
    level === 3
      ? `<animateTransform attributeName="transform" type="translate" values="0 0;-0.5 0;0.5 0;-0.35 0;0.35 0;0 0" dur="0.45s" begin="${settle}" fill="freeze"/>`
      : ''
  const entrance = isEntering
    ? `<animateTransform attributeName="transform" type="translate" values="0 ${GHOST_H};0 0" keySplines="0.2 0.8 0.3 1" calcMode="spline" dur="0.6s" fill="freeze"/><animate attributeName="opacity" values="0;1" dur="0.6s" fill="freeze"/>`
    : ''
  const halo =
    `<defs><radialGradient id="halo"><stop offset="0" stop-color="${look.haloColor}" stop-opacity="${look.halo}"/><stop offset="0.62" stop-color="${look.haloColor}" stop-opacity="${look.halo}"/><stop offset="1" stop-color="${look.haloColor}" stop-opacity="0"/></radialGradient></defs>` +
    `<ellipse cx="${AT_X + 6}" cy="${AT_Y + 4.5}" rx="${GHOST_W / 2}" ry="${GHOST_H / 2}" fill="url(#halo)"/>`
  const ghost = `<g>${entrance}<g>${shake}<g>${bob}<g transform="translate(${AT_X} ${AT_Y})">${sprite}</g></g></g></g>`
  const width = units * scale
  const height = GHOST_H * scale
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${units} ${GHOST_H}" width="${width}" height="${height}">` +
    halo +
    ghost +
    (tomb === undefined ? '' : tombOf(tomb, GHOST_W + 0.5)) +
    `</svg>`
  return { source, width, height, scale }
}

/** What the art says to a reader who cannot see it: the punchline and the fact, and the stone's words. */
export function altOf(level: Level, lines: readonly string[], tomb?: Tomb): string {
  const who = NAMES[level]
  const said = lines.slice(0, 2).filter(Boolean).join(' ')
  const stone = tomb === undefined ? '' : ` Beside it a gravestone: R.I.P. ${tomb.name}, ${tomb.born} – ${tomb.died}.`
  return `${who}: ${said}${stone}`
}
