import type { On, RenderInput } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import type { Ghost, GhostIndex, ValuePoint } from '../hooks/ghost.ts'

export const ROOT = '/work'

// A fictional project throughout: the "Acme Bakery" site. Every quote, value,
// date and hash below is made up for the tests.

/** Acme Bakery's type step-down, as its decisions log has it. */
export const STEP_DOWN: Ghost = {
  kind: 'decision',
  date: '2026-05-12',
  quote: 'not sure about the sizes yet. the hero feels too loud. can we calm it down?',
  what: '(type) a quieter hero: hero 56, titles 44, items 22, lead 20, body 17',
  undo: '64/52/26/20/17/15',
  undoKeys: ['64px', '52px'],
  scope: 'topic',
  keys: ['type', 'hero', 'titles', 'topic:type', 'topic:layout'],
  weight: 4,
  source: 'decisions.md (origin/main)',
}

export const SEMIBOLD: Ghost = {
  kind: 'decision',
  date: '2026-05-12',
  quote: 'bolder headings are fine but the hero title is shouting',
  what: '(type) headings (display, section titles, item names) are semibold (600)',
  undo: '400 for all text and the 1,280 cap (10 May)',
  undoKeys: ['400px', '1280px'],
  scope: 'topic',
  keys: ['type', 'headings', 'semibold', 'topic:type', '64px'],
  weight: 4,
  source: 'decisions.md (origin/main)',
}

export const DARK: Ghost = {
  kind: 'decision',
  date: '2026-05-13',
  quote: 'dark mode is nice but the photo behind it is too busy',
  what: '(dark theme) dark is a flat cocoa colour: no photo behind it',
  scope: 'topic',
  keys: ['dark', 'theme', 'topic:colour', '#1b1410'],
  weight: 4,
  source: 'decisions.md (origin/main)',
}

export const BOLDER: Ghost = {
  kind: 'commit',
  date: '2026-05-12',
  what: 'Bigger and bolder: 1,200px, grown type, semibold headings, no cards',
  scope: 'topic',
  keys: ['bigger', 'bolder', 'grown', 'type', 'semibold', 'headings', 'cards', 'topic:type'],
  weight: 2,
  source: 'git a1b2c3d',
}

export const HERO_WORDS: Ghost = {
  kind: 'owner',
  date: '2026-05-07',
  quote: 'the hero section is too crowded by the cake photo',
  what: 'the hero section is too crowded by the cake photo',
  scope: 'file',
  keys: ['hero', 'section', 'crowded', 'cake', 'photo'],
  weight: 3,
  source: 'transcript 0000aaaa',
}

/** --t-display in the fictional git history: 60 (10 May) → 64 (12 May) → 56 (13 May). */
export const DISPLAY_HISTORY: ValuePoint[] = [
  { date: '2026-05-10', value: 'clamp(40px, 4.8vw, 60px)', hash: 'f00d001' },
  { date: '2026-05-12', value: 'clamp(40px, 5.5vw, 64px)', hash: 'f00d002' },
  { date: '2026-05-13', value: 'clamp(40px, 5vw, 56px)', hash: 'f00d003' },
]

/** A history that has already swung back and forth: 64 → 56 → 64 → 56 (the edit to 64 is reversal #3). */
export const SEESAW: ValuePoint[] = [
  { date: '2026-05-10', value: 'clamp(40px, 5.5vw, 64px)', hash: 'aaaa001' },
  { date: '2026-05-11', value: 'clamp(40px, 5vw, 56px)', hash: 'aaaa002' },
  { date: '2026-05-12', value: 'clamp(40px, 5.5vw, 64px)', hash: 'aaaa003' },
  { date: '2026-05-12', value: 'clamp(40px, 5vw, 56px)', hash: 'aaaa004' },
]

export const INDEX: GhostIndex = {
  v: 1,
  root: ROOT,
  builtAt: 1,
  sources: { decisions: 'decisions.md (origin/main)', commits: 1, transcripts: 1, ownerMessages: 1 },
  decisionsFile: 'design/decisions.md',
  files: {
    'app/base.css': [STEP_DOWN, SEMIBOLD, DARK, BOLDER],
    'components/Hero.tsx': [HERO_WORDS],
  },
}

export const BASE_CSS = `:root {
  --t-display: clamp(40px, 5vw, 56px);   /* the hero */
  --accent: #e07a5f;
}
`

/** "Now" in the tests: five days after the 12 May decision. */
export const NOW = Date.parse('2026-05-17T12:00:00')

/** What the plugin asked beneath it, and the edits that reached "the tool". */
export type World = {
  clock: MockClock
  writes: string[]
  submitted: string[]
  blits: number
  invalidations: number
  files: Map<string, string>
  toolCalls: Record<string, unknown>[]
  commands: string[]
  spawned: string[][]
  denyNext: boolean
}

/** Seats an in-memory world beneath the plugin: its index, the project's files, the tool. */
export function worldOf(on: On, index: GhostIndex | null = INDEX, nowMs = NOW, store: Record<string, unknown> = {}): World {
  const world: World = {
    clock: mock.clock(on, { now: nowMs }),
    writes: [],
    submitted: [],
    blits: 0,
    invalidations: 0,
    files: new Map([[`${ROOT}/app/base.css`, BASE_CSS]]),
    toolCalls: [],
    commands: [],
    spawned: [],
    denyNext: false,
  }
  mock.store(on, store)
  on('fs.write', ($, e) => {
    world.writes.push(e.path)
    return { value: undefined }
  })
  on('ui.blit', () => {
    world.blits += 1
    return { value: {} }
  })
  on('ui.invalidate', () => {
    world.invalidations += 1
    return { value: undefined }
  })
  const isIndex = (path: string) => path.endsWith('/.data/work.json')

  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.stat', ($, e) => {
    if (isIndex(e.path)) return index === null ? { deny: `ENOENT: ${e.path}` } : { value: { kind: 'file' as const, size: 1, mtimeMs: 1000, isLink: false } }
    const text = world.files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: { kind: 'file' as const, size: text.length, mtimeMs: 1000, isLink: false } }
  })
  on('fs.read', ($, e) => {
    if (isIndex(e.path)) return index === null ? { deny: `ENOENT: ${e.path}` } : { value: JSON.stringify(index) }
    const text = world.files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('ui.log', () => ({ value: undefined }))
  // The engine's own band beneath the plugin: drawn when the ghost passes.
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['(engine band)'] }) as never)
  on('command.register', ($, e) => {
    world.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.spawn', async function* ($, e) {
    world.spawned.push([...e.argv])
    return { value: { code: 0, signal: null } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => {
    world.submitted.push(e.text)
    return { text: e.text }
  })
  on('tool.call', ($, e) => {
    world.toolCalls.push({ ...(e as unknown as Record<string, unknown>) })
    if (world.denyNext) return { deny: 'The user said no.' }
    return { result: 'ok', text: 'ok' } as never
  })
  return world
}

/** A first reversal with a known birth: 64 (10 May) → 56 (12 May); the edit back to 64 is #1, and 64 was born 10 May. */
export const FIRST_SWING: ValuePoint[] = [
  { date: '2026-05-10', value: 'clamp(40px, 5.5vw, 64px)', hash: 'bbbb001' },
  { date: '2026-05-12', value: 'clamp(40px, 5vw, 56px)', hash: 'bbbb002' },
]

/** The same index with the property's value history: a real swing back. */
export const withValues = (values: ValuePoint[]): GhostIndex => ({ ...INDEX, values: { 'app/base.css': { '--t-display': values } } })

export const BAND: RenderInput<'AbovePrompt'> = {
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'band',
  viewport: { columns: 160, rows: 48, isFullscreen: true },
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
}

export const command = (name: string, args = '') => ({
  command: name,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})
