import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { decisionsCandidates, rank } from '../hooks/ghost.ts'
import type { Ghost, GhostIndex } from '../hooks/ghost.ts'
import { BAND, HERO_WORDS, INDEX, ROOT, worldOf } from './fixtures.ts'

const NAME = 'clawd-ghost'
const heroEdit = {
  tool: 'Edit' as const,
  file_path: `${ROOT}/app/base.css`,
  old_string: '  --t-display: clamp(40px, 5vw, 56px);   /* the hero */',
  new_string: '  --t-display: clamp(40px, 5vw, 64px);   /* the hero */',
}
const notesOf = (ran: { context?: readonly string[] }) => (ran.context ?? []).filter(note => note.startsWith('clawd-ghost'))

async function spawnedArgv($: Engine, world: ReturnType<typeof worldOf>): Promise<string[]> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 50 && world.spawned.length === 0; i++) await Promise.resolve()
  return world.spawned[0] ?? []
}

describe('the decisionsFile option', () => {
  test('left at its default, the index builder is told design/decisions.md', async ($, on) => {
    const world = worldOf(on, null)
    const argv = await spawnedArgv($, world)
    expect(argv.slice(-2)).toEqual(['--decisions', 'design/decisions.md'])
  })

  test('set by the user, the index builder is told that path', { options: { decisionsFile: 'docs/DECISIONS.md' } }, async ($, on) => {
    const world = worldOf(on, null)
    const argv = await spawnedArgv($, world)
    expect(argv.slice(-2)).toEqual(['--decisions', 'docs/DECISIONS.md'])
  })

  test('the overrule note names the decisions log the index actually read', async ($, on) => {
    const index: GhostIndex = { ...INDEX, decisionsFile: 'DECISIONS.md' }
    worldOf(on, index)
    await $.tool.call(heroEdit)
    const ui = await $.ui.mount({ plugin: NAME, surface: 'terminal', component: 'AbovePrompt', props: BAND.props, viewport: BAND.viewport })
    await ui.press({ key: 'overrule' })
    const next = await $.tool.call({ tool: 'Read', file_path: `${ROOT}/app/base.css` })
    const asked = notesOf(next).join('\n')
    expect(asked).toContain("record this as a new owner decision in DECISIONS.md through the project's normal process")
    await ui.unmount()
  })

  test('the candidates: the configured path first, then the usual spots, no repeats', () => {
    expect(decisionsCandidates()).toEqual(['design/decisions.md', 'DECISIONS.md', 'docs/decisions.md', 'decisions.md'])
    expect(decisionsCandidates('./notes/choices.md')).toEqual(['notes/choices.md', 'design/decisions.md', 'DECISIONS.md', 'docs/decisions.md', 'decisions.md'])
    expect(decisionsCandidates('DECISIONS.md')).toEqual(['DECISIONS.md', 'design/decisions.md', 'docs/decisions.md', 'decisions.md'])
  })
})

describe('without a decisions log', () => {
  /** An index built from git history and the user's own past prompts alone. */
  const SWUNG: Ghost = {
    kind: 'commit',
    date: '2026-05-14',
    what: 'Revert the menu back to the side drawer',
    scope: 'file',
    keys: ['revert', 'menu', 'side', 'drawer'],
    weight: 3,
    source: 'git c0ffee1',
  }
  const NO_LOG: GhostIndex = {
    v: 1,
    root: ROOT,
    builtAt: 1,
    sources: { decisions: null, commits: 1, transcripts: 1, ownerMessages: 1 },
    decisionsFile: null,
    files: { 'components/Menu.tsx': [SWUNG], 'components/Hero.tsx': [HERO_WORDS] },
  }

  test('git history alone still raises a ghost and a note', async ($, on) => {
    worldOf(on, NO_LOG)
    const ran = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/components/Menu.tsx`, old_string: 'a', new_string: 'b' })
    expect(notesOf(ran)[0]).toContain('Revert the menu back to the side drawer')
    expect(rank(NO_LOG.files['components/Menu.tsx'])[0]?.ghost).toBe(SWUNG)
  })

  test("the user's own past words alone still raise a ghost", async ($, on) => {
    worldOf(on, NO_LOG)
    const ran = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/components/Hero.tsx`, old_string: 'a', new_string: 'b' })
    expect(notesOf(ran)[0]).toContain('too crowded by the cake photo')
  })
})
