// The character, all in one place: the ghost Clawd's pixels, its colours per
// level, the Desktop palette, its sheet hem, and the names the alt text uses.
// A character swap edits this file (and, if the new sprite is not 12 pixels
// wide, the canvas numbers at the top of desktop.ts). Nothing else draws it.
//
// Terminal: 12×8 pixels drawn as 12×4 half-block cells, two float frames (the
// body one pixel up or down). Level 3 is grumpy: slanted brows, a flat mouth.

import type { GhostLevel } from '../types'

/** 1 faint, 2 more solid, 3 solid and grumpy. */
export type Level = GhostLevel

export const COLUMNS = 12
export const ROWS = 4

/** Who the alt text says is there, per level. */
export const NAMES: Record<Level, string> = { 1: 'Faint ghost Clawd', 2: 'Ghost Clawd', 3: 'Grumpy ghost Clawd' }

/** Clawd, as the buddy draws him. */
export const CALM: readonly string[] = [
  '.XXXXXXXXXX.',
  '.XX.XXXX.XX.',
  'XXXXXXXXXXXX',
  '.XXXXXXXXXX.',
  '.XXXXXXXXXX.',
  '..X.X..X.X..',
  '..X.X..X.X..',
]

/** Grumpy: the eyes run into brows slanting down to the middle, and the mouth is a flat line. */
export const GRUMPY: readonly string[] = [
  '.XXXXXXXXXX.',
  '.X.XXXXXX.X.',
  '.XX.XXXX.XX.',
  'XXXXXXXXXXXX',
  '.XXX....XXX.',
  '..X.X..X.X..',
  '..X.X..X.X..',
]

/** The terminal look per level: the ghost's colour (also the punchline's), and whether it is grumpy. */
export const STYLE: Record<Level, { color: string; rgb: number; opacity: number; isGrumpy: boolean }> = {
  1: { color: '#D3CFF5', rgb: 0xd3cff5, opacity: 0.45, isGrumpy: false },
  2: { color: '#AFA9EC', rgb: 0xafa9ec, opacity: 0.75, isGrumpy: false },
  3: { color: '#7F77DD', rgb: 0x7f77dd, opacity: 1, isGrumpy: true },
}

// ---- the Desktop palette (desktop.ts draws with these) ----

/** The sheet's hem, two frames that swap so it waves (Desktop). */
export const HEMS: readonly (readonly string[])[] = [
  ['.XXXXXXXXXX.', '.X.XX.XX.XX.', '....X....X..'],
  ['.XXXXXXXXXX.', '.XX.XX.XX.X.', '..X....X....'],
]

/** The face's ink on Desktop (eyes, brows, mouth). */
export const FACE_INK = '#3C3489'

/** The punchline's colour on the Desktop card: the ghost's hue, deep enough to read on the light card (5.3, 6.8 and 8.8 to 1 on #EFEFEF). */
export const DESKTOP_TEXT: Record<Level, string> = { 1: '#5B52C4', 2: '#4A41B0', 3: '#3B3392' }

/** Desktop opacities and outline/halo colours per level. */
export const LOOK: Record<Level, { body: number; outline: number; outlineColor: string; face: number; halo: number; haloColor: string }> = {
  1: { body: 0.7, outline: 0.5, outlineColor: '#7F77DD', face: 0.6, halo: 0.55, haloColor: '#DCD7FB' },
  2: { body: 0.85, outline: 0.6, outlineColor: '#7F77DD', face: 0.75, halo: 0.7, haloColor: '#CFC8FA' },
  3: { body: 1, outline: 0.95, outlineColor: '#4B4398', face: 1, halo: 0.85, haloColor: '#B7AFF2' },
}

/** The body rows for a level (7 rows, legs included). */
export const bodyOf = (level: Level): readonly string[] => (STYLE[level].isGrumpy ? GRUMPY : CALM)

// ---- terminal cells ----

const DEFAULT = 0x01000000
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 (the es2023 lib has no Uint8Array#toBase64). */
export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += (B64[(n >> 18) & 63] ?? '') + (B64[(n >> 12) & 63] ?? '')
    out += b === undefined ? '=' : (B64[(n >> 6) & 63] ?? '')
    out += c === undefined ? '=' : (B64[n & 63] ?? '')
  }
  return out
}

/** The sprite's pixels for a level and a float frame (0: up, 1: down), 8 rows. */
export function pixelsOf(level: Level, frame: 0 | 1): string[] {
  const body = bodyOf(level)
  const blank = '.'.repeat(COLUMNS)
  const rows = frame === 0 ? [...body, blank] : [blank, ...body]
  return rows.slice(0, ROWS * 2)
}

/** Half-block cells, `COLUMNS * ROWS` u32 triplets, base64 (RasterProps). */
export function cellsOf(level: Level, frame: 0 | 1): string {
  const px = pixelsOf(level, frame)
  const color = STYLE[level].rgb
  const words: number[] = []
  for (let r = 0; r < px.length; r += 2) {
    const top = px[r] ?? ''
    const bottom = px[r + 1] ?? ''
    for (let c = 0; c < COLUMNS; c++) {
      const isTop = top[c] === 'X'
      const isBottom = bottom[c] === 'X'
      const glyph = isTop && isBottom ? 0x2588 : isTop ? 0x2580 : isBottom ? 0x2584 : 0x20
      words.push(glyph, isTop || isBottom ? color : DEFAULT, DEFAULT)
    }
  }
  return base64(new Uint8Array(Uint32Array.from(words).buffer))
}
