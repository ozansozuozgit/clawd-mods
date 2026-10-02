// clawd-ghost: the ghost of sessions past. Unofficial fan-made; not affiliated with Anthropic.
//
// Before Claude edits a file, a ghost Clawd above the prompt says what happened
// to that file before: the owner's dated words, the decision, what an edit back
// would undo. It gets more solid (and grumpier) each time the same value swings
// back. Claude gets the same facts as a note after the edit. Observe only: the
// edit is never denied or rewritten, and the mod never writes the decisions log.
//
// The hook only looks things up. scripts/build-index.mjs builds the index in
// the background at session start and after turns (at most every 10 minutes),
// from the project's decisions log (the `decisionsFile` option), git history
// and the owner's own past prompts, all local.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GhostCard } from '../types'
import { compose, OVERRULE, overruleNoteOf, pick, REST } from './copy.ts'
import type { Picked } from './copy.ts'
import { dayOf, EDIT_TOOLS, editTextOf, lineOf, noteOf, rank, relativeTo, swingOf, targetOf } from './ghost.ts'
import type { GhostIndex, Swing } from './ghost.ts'
import { altOf, COMPACT_COLUMNS, desktopArt } from './desktop.ts'
import { cellsOf, COLUMNS, DESKTOP_TEXT, ROWS, STYLE } from './sprite.ts'

const current = atom({ plugin: 'clawd-ghost', key: 'current' } as const, null)
const shown = atom({ plugin: 'clawd-ghost', key: 'shown' } as const, [])
const touched = atom({ plugin: 'clawd-ghost', key: 'touched' } as const, [])
const pendingNote = atom({ plugin: 'clawd-ghost', key: 'pendingNote' } as const, null)

const REFRESH_MS = 10 * 60 * 1000
const FRESH_AT_START_MS = 2 * 60 * 1000
const AFTER_PRESS_MS = 4000
const FLOAT_MS = 700
const NODES = ['node', '/opt/homebrew/bin/node', '/usr/local/bin/node']
/** The last template each copy pool used, so no pool repeats itself back to back (kept across sessions). */
const ROTATION_KEY = 'rotation'

type Timer = ReturnType<EngineInterface['clock']['every']>
type Float = { requestId: string; cardId: string; level: GhostCard['level']; frame: 0 | 1; timer?: Timer; isInvalidating: boolean; quietTicks: number }

// Module variables reset on a hot reload; that only costs a re-read or a frame.
let cached: { path: string; mtimeMs: number; index: GhostIndex } | undefined
let isBuilding = false
let float: Float | undefined
let isWorking = false
/** The `decisionsFile` option: the decisions log's path in the project ('' lets the index builder look in the usual spots). */
let decisionsOption = ''

const slugOf = (root: string): string => root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

function indexPathOf($: EngineInterface, root: string): string {
  return `${$.plugin.root}/.data/${slugOf(root)}.json`
}

async function loadIndex($: EngineInterface, path: string): Promise<GhostIndex | undefined> {
  let mtimeMs: number
  try {
    mtimeMs = (await $.fs.stat(path)).mtimeMs
  } catch {
    return undefined
  }
  if (cached !== undefined && cached.path === path && cached.mtimeMs === mtimeMs) return cached.index
  try {
    const index = JSON.parse(await $.fs.read(path)) as GhostIndex
    if (index.v !== 1 || typeof index.files !== 'object') return undefined
    cached = { path, mtimeMs, index }
    return index
  } catch {
    return undefined
  }
}

/** Builds the index in the background: the hook that starts it does not wait. */
function buildIndex($: EngineInterface, root: string, out: string): void {
  if (isBuilding) return
  isBuilding = true
  const script = `${$.plugin.root}/scripts/build-index.mjs`
  void (async () => {
    try {
      for (const node of NODES) {
        for (const flags of [['--experimental-strip-types', '--no-warnings'], []]) {
          let stderr = ''
          try {
            const extra = decisionsOption === '' ? [] : ['--decisions', decisionsOption]
            const run = $.process.spawn({ argv: [node, ...flags, script, root, out, ...extra], cwd: root })
            for await (const chunk of run) if (chunk.stream === 'stderr') stderr += chunk.text
            const ended = await run.result
            if (ended.code === 0) {
              $.ui.log(`clawd-ghost: index built for ${root}`, { to: 'debug' })
              return
            }
            $.ui.log(`clawd-ghost: ${node} ${flags.join(' ')} exited ${String(ended.code)}: ${stderr.slice(0, 300)}`, { to: 'debug' })
          } catch (err) {
            $.ui.log(`clawd-ghost: could not start ${node}: ${String(err).slice(0, 200)}`, { to: 'debug' })
            break
          }
        }
      }
    } finally {
      isBuilding = false
    }
  })()
}

async function refreshIfStale($: EngineInterface, staleMs: number): Promise<void> {
  const root = await $.session.root()
  const path = indexPathOf($, root)
  let age = Number.POSITIVE_INFINITY
  try {
    age = (await $.clock.now()) - (await $.fs.stat(path)).mtimeMs
  } catch {}
  if (age > staleMs) buildIndex($, root, path)
}

/** Today as the ghost says dates: `17 May`. */
function todayOf(nowMs: number): string {
  const d = new Date(nowMs)
  return dayOf(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
}

async function rotationOf($: EngineInterface): Promise<Picked> {
  try {
    const v = await $.store.get(ROTATION_KEY)
    return v !== null && typeof v === 'object' ? (v as Picked) : {}
  } catch {
    return {}
  }
}

async function remember($: EngineInterface, used: Picked): Promise<void> {
  if (Object.keys(used).length === 0) return
  try {
    await $.store.set(ROTATION_KEY, { ...(await rotationOf($)), ...used })
  } catch {}
}

/** The line Claude reads about the value swing, plainly. */
function swingNoteOf(swing: Swing, card: GhostCard): string {
  const v = card.vars
  const history = swing.history === undefined ? '' : ` Its value history in git: ${swing.history.slice(0, -1).join(' → ')}; this edit makes it ${swing.history.join(' → ')} (reversal #${swing.n}).`
  return `This edit brings back ${v.old ?? swing.back} for ${v.thing ?? swing.label}, which the ${swing.decision.date} decision replaced with ${swing.decided}.${history}`
}

/** Adds what Claude should read after a tool result: the ghost's note and any overrule note waiting. */
async function finish($: EngineInterface, ran: Awaited<ReturnType<EngineInterface['tool']['call']>>, extra: string[], isMain: boolean) {
  if (ran.deny !== undefined) return ran
  const notes = [...extra]
  if (isMain) {
    const waiting = await read($, pendingNote)
    if (waiting !== null) {
      notes.push(waiting)
      await update($, pendingNote, () => null)
    }
  }
  return notes.length === 0 ? ran : { ...ran, context: [...(ran.context ?? []), ...notes] }
}

function stopFloat(): void {
  float?.timer?.cancel()
  float = undefined
}

/** Two frames, up and down, repainted with `$.ui.blit`; a redraw instead when a blit is refused. */
function ensureFloat($: EngineInterface, requestId: string, card: GhostCard): void {
  if (float !== undefined && float.requestId === requestId && float.cardId === card.id) {
    float.quietTicks = 0
    return
  }
  stopFloat()
  const f: Float = { requestId, cardId: card.id, level: card.level, frame: 0, isInvalidating: false, quietTicks: 0 }
  float = f
  f.timer = $.clock.every(FLOAT_MS, () => {
    void (async () => {
      if (float !== f) return
      f.frame = f.frame === 0 ? 1 : 0
      if (f.isInvalidating) {
        // No redraw for a while means the band is gone: stop.
        f.quietTicks += 1
        if (f.quietTicks > 3) stopFloat()
        else $.ui.invalidate('ui.render')
        return
      }
      const r = await $.ui.blit({ requestId: f.requestId, key: 'ghost-clawd', cells: cellsOf(f.level, f.frame), columns: COLUMNS, rows: ROWS })
      if (r.deny !== undefined && float === f) {
        f.isInvalidating = true
        $.ui.invalidate('ui.render')
      }
    })()
  })
}

/** Button 1: back to rest, a parting line for a few seconds. */
async function rest($: EngineInterface, card: GhostCard): Promise<void> {
  const rotation = await rotationOf($)
  const line = pick(REST, card.vars, rotation.rest)
  await remember($, { rest: line?.id })
  await showAfter($, card, line?.lines[0])
}

/** Button 2: on a swing, Claude is asked to log the owner's choice; on history, just noted. */
async function overrule($: EngineInterface, card: GhostCard): Promise<void> {
  if (card.kind !== 'swing' || card.overrule === undefined) {
    await update($, current, c => (c?.id === card.id ? null : c))
    return
  }
  const today = todayOf(await $.clock.now())
  const index = await loadIndex($, indexPathOf($, await $.session.root()))
  const note = overruleNoteOf(card, card.buttons[1], today, index?.decisionsFile ?? (decisionsOption === '' ? undefined : decisionsOption))
  if (isWorking) {
    await update($, pendingNote, () => note)
  } else {
    void $.prompt.submit({ text: note }).catch(() => update($, pendingNote, () => note))
  }
  const rotation = await rotationOf($)
  const line = pick(OVERRULE, { ...card.vars, today }, rotation.overrule)
  await remember($, { overrule: line?.id })
  await showAfter($, card, line?.lines[0])
}

async function showAfter($: EngineInterface, card: GhostCard, line: string | undefined): Promise<void> {
  if (line === undefined) {
    await update($, current, c => (c?.id === card.id ? null : c))
    return
  }
  await update($, current, c => (c?.id === card.id ? { ...card, mode: 'after' as const, lines: [line] } : c))
  $.clock.after(AFTER_PRESS_MS, () => {
    void update($, current, c => (c?.id === card.id ? null : c))
  })
}

export const register: Register = (on, options) => {
  decisionsOption = typeof options.decisionsFile === 'string' ? options.decisionsFile.trim() : ''

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refreshIfStale($, FRESH_AT_START_MS)
    try {
      await $.command.register({
        name: 'ghost',
        description: 'clawd-ghost: list the ghosts (past decisions and your past words) for the files this session touched',
        immediate: true,
      })
    } catch (err) {
      $.ui.log(`clawd-ghost: /ghost not registered: ${String(err)}`, { to: 'debug' })
    }
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await refreshIfStale($, REFRESH_MS)
    return done
  })

  // Observe only: look the file up, show the ghost, let the edit run as asked,
  // then leave Claude a note. Never `{ deny }`, never a rewritten `e`.
  on('tool.call', async ($, e, next) => {
    const tool: string = e.tool
    const isMain = e.agentId === undefined
    if (!EDIT_TOOLS.includes(tool)) return finish($, await next(e), [], isMain)
    const input = e as unknown as Record<string, unknown>
    const target = targetOf(input)
    const root = await $.session.root()
    const index = target === undefined ? undefined : await loadIndex($, indexPathOf($, root))
    const rel = target === undefined || index === undefined ? undefined : relativeTo(index.root, target)
    if (rel === undefined) return finish($, await next(e), [], isMain)

    await update($, touched, list => (list.includes(rel) ? list : [...list, rel].slice(-200)))
    if ((await read($, shown)).includes(rel)) return finish($, await next(e), [], isMain)

    const edit = editTextOf(input)
    if (tool === 'Write' && target !== undefined) {
      try {
        edit.before = (await $.fs.read(target)).slice(0, 200000)
      } catch {}
    }
    const ghosts = index?.files[rel] ?? []
    const ranked = rank(ghosts, edit)
    if (ranked.length === 0) return finish($, await next(e), [], isMain)

    const swing = swingOf(ranked, edit, index?.values?.[rel])
    const nowMs = await $.clock.now()
    const composed = compose({ id: `${nowMs}:${rel}`, file: rel, ranked, all: ghosts, swing, nowMs, today: todayOf(nowMs), last: await rotationOf($) })
    if (composed === undefined) return finish($, await next(e), [], isMain)
    await remember($, composed.used)
    await update($, shown, list => [...list, rel].slice(-500))
    await update($, current, () => composed.card)

    const note = noteOf(rel, ranked) + (swing === undefined ? '' : `\n${swingNoteOf(swing, composed.card)}`)
    return finish($, await next(e), [note], isMain)
  })

  // A new prompt from the owner clears the last ghost.
  on('prompt.submit', async ($, e, next) => {
    if (e.turnId === undefined && (await read($, current)) !== null) await update($, current, () => null)
    return next(e)
  })

  // The band above the prompt: a glance, not a panel. It shows at any width
  // (a Pane opened unasked waits for 144 columns) and goes with one press.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    isWorking = e.props.isWorking
    if (e.props.hasSurvey) return next(e)
    const card = await read($, current)
    if (card === null) {
      stopFloat()
      return next(e)
    }
    const style = STYLE[card.level]
    const [punch = '', fact, consequence] = card.lines
    const isHaunting = card.mode === 'haunt'
    const more = card.more > 0 ? ` · +${card.more} more: /ghost` : ''
    const press1 = () => rest($, card)
    const press2 = () => overrule($, card)

    if (e.surface === 'terminal') {
      const { Box, Button, Raster, Text } = $.ui.resolve(e)
      ensureFloat($, e.requestId, card)
      const frame = float?.cardId === card.id ? float.frame : 0
      const width = Math.max(20, e.props.bodyColumns - 14)
      return (
        <Box flexDirection="row" gap={1} key="ghost">
          <Raster key="ghost-clawd" columns={COLUMNS} rows={ROWS} cells={cellsOf(card.level, frame)} />
          <Box flexDirection="column" width={width}>
            <Text color={style.color} bold={card.level === 3}>
              {punch}
            </Text>
            {fact !== undefined && <Text>{fact}</Text>}
            {consequence !== undefined && <Text dimColor>{consequence}</Text>}
            {isHaunting && (
              <Box flexDirection="row" gap={1}>
                <Button key="rest" label={card.buttons[0]} hotkey="1" onPress={press1} />
                <Button key="overrule" label={card.buttons[1]} hotkey="2" onPress={press2} />
                <Text dimColor>
                  {card.file}
                  {more}
                </Text>
              </Box>
            )}
          </Box>
        </Box>
      )
    }
    if (e.surface === 'desktop') {
      // The Desktop app's band is a light card: the ghost large and crisp on the left, the
      // three lines on the right, the buttons below; compact when the band is narrow.
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      // Desktop measures its band in its own columns; the band spans the prompt, so only a really narrow one is compact.
      const isCompact = e.props.bodyColumns < COMPACT_COLUMNS
      const art = desktopArt({ level: card.level, isEntering: isHaunting, isCompact, tomb: card.tomb })
      return (
        <Box flexDirection="column" gap={1} key="ghost">
          <Box flexDirection="row" gap={2} alignItems="center">
            <Svg source={art.source} alt={altOf(card.level, card.lines, isCompact ? undefined : card.tomb)} width={art.width} height={art.height} isInteractive />
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Text color={DESKTOP_TEXT[card.level]} bold={card.level === 3}>
                {punch}
              </Text>
              {fact !== undefined && <Text>{fact}</Text>}
              {consequence !== undefined && <Text dimColor>{consequence}</Text>}
            </Box>
          </Box>
          {isHaunting && (
            <Box flexDirection="row" gap={1} alignItems="center">
              <Button key="rest" label={card.buttons[0]} hotkey="1" onPress={press1} />
              <Button key="overrule" label={card.buttons[1]} hotkey="2" variant="primary" onPress={press2} />
              {!isCompact && (
                <Text dimColor>
                  {card.file}
                  {more}
                </Text>
              )}
            </Box>
          )}
        </Box>
      )
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" key="ghost">
        {card.lines.map(line => (
          <Text>{line}</Text>
        ))}
        {isHaunting && <Button key="rest" label={card.buttons[0]} hotkey="1" onPress={press1} />}
        {isHaunting && <Button key="overrule" label={card.buttons[1]} hotkey="2" onPress={press2} />}
      </Box>
    )
  })

  on('command.run', { command: 'ghost' }, async $ => {
    const root = await $.session.root()
    const index = await loadIndex($, indexPathOf($, root))
    const files = await read($, touched)
    if (index === undefined) return { text: 'clawd-ghost: no index yet for this project (it builds in the background at session start).' }
    if (files.length === 0) return { text: 'clawd-ghost: this session has not edited any file yet.' }
    const rows: string[] = []
    for (const file of files) {
      const ghosts = index.files[file]
      const ranked = rank(ghosts)
      if (ranked.length === 0) continue
      rows.push(`${file}`)
      for (const { ghost } of ranked.slice(0, 3)) rows.push(`  ${lineOf(ghost, ghosts ?? [])}`)
    }
    if (rows.length === 0) return { text: `clawd-ghost: no ghosts for the ${files.length} file(s) this session touched.` }
    return { text: rows.join('\n') }
  })
}

