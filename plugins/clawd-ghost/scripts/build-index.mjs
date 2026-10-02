#!/usr/bin/env node
// clawd-ghost index builder. Runs outside the hook (spawned at session start,
// refreshed after turns at most every 10 minutes) and writes one JSON file the
// hook only reads.
//
//   node --experimental-strip-types build-index.mjs <projectDir> <outFile> [--decisions <path>]
//   node --experimental-strip-types build-index.mjs <projectDir> --lookup <file> [--before <text>] [--after <text>] [--decisions <path>]
//
// Sources, per tracked file: the project's decisions log (the configured path,
// else DECISIONS.md, docs/decisions.md or decisions.md; read from the remote's
// default branch when there is one, else the working copy; skipped when there
// is none), `git log --follow -n 10` subjects that read as swings, and the
// owner's own messages in past Claude Code transcripts of this project.
// Everything stays on this machine: no network calls.

import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { createInterface } from 'node:readline'

import { clip, decisionsCandidates, lineOf, noteOf, rank, redactorOf, tokenize, topicsOf, undoKeysOf } from '../hooks/ghost.ts'

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.sass', '.less', '.astro', '.vue', '.svelte', '.html', '.liquid', '.md', '.mdx', '.json', '.py', '.rb', '.go', '.swift', '.kt', '.rs'])
const SWING = /\b(revert(s|ed)?|back to|undo(es|ne)?|restor(e|es|ed)|smaller|bigger|again|step down|tone(d)? down|roll(ed)? ?back)\b/i
const GENERIC = new Set('page pages layout index base main module modules component components app apps site sites src lib libs util utils styles style global globals types type hooks scripts test tests spec public assets demo demos clear one dev lab'.split(' '))
const UNIT_WORDS = '(page|pages|section|card|cards|form|hero|band|demo|panel|intro|pane|menu|footer|header|button|chat|window|component|screen)'
const JUDGE = /\b(too|loud|louder|shouting|way|not|don'?t|dont|hate|love|like|feels?|looks?|horrible|weird|bland|empty|busy|cluttered|ugly|cheap|boring|plain|overwhelming|hurts?|big|bigger|small|smaller|tone|tiny|huge|tall|wide)\b/i
const OWNER_TOPICS = {
  type: /\b(fonts?|font sizes?|type ?sizes?|typography|sizings?|headings?|text (is|feels|looks) (too )?(big|small)|too big|too small|too loud)\b/i,
  colour: /\b(colou?rs?|contrast|dark mode|light mode|dark theme|light theme|palette)\b/i,
  layout: /\b(wider|narrower|spacing|layout|max width|too wide|too narrow)\b/i,
}

const sh = (cmd, args, cwd, timeout = 20000) =>
  new Promise(resolve => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout))
  })

const localDate = ms => {
  const d = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Splits `CaseStudy` / `case-study` / `case_study` into words. */
const wordsOf = name =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map(w => w.toLowerCase())
    .filter(Boolean)

const singular = w => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('oes') ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

/** What a file is called: its component name, its page, its folders. */
function namesOf(rel) {
  const ext = extname(rel)
  const stem = basename(rel, ext).replace(/\.(module|dev|test|spec|stories)$/, '')
  const dirs = dirname(rel)
    .split('/')
    .filter(d => d !== '.' && !d.startsWith('('))
  const words = new Set()
  for (const w of [...wordsOf(stem), ...dirs.flatMap(wordsOf)]) {
    if (w.length >= 4 && !GENERIC.has(w)) {
      words.add(w)
      words.add(singular(w))
    }
  }
  // Next/Astro routes: app/(site)/contact/page.tsx is the contact page; app/(site)/page.tsx is home.
  const isRoute = /^(page|index|\+page)$/.test(stem)
  if (isRoute) {
    const routeDir = dirs.filter(d => !d.startsWith('[') && !['app', 'pages', 'src', 'routes'].includes(d)).pop()
    words.add(routeDir === undefined ? 'home' : routeDir.toLowerCase())
  }
  const component = /^[A-Z][A-Za-z0-9]{3,}$/.test(stem) ? stem : undefined
  return { words: [...words], component, base: basename(rel) }
}

/** The systems a file defines (not merely uses). */
function definesOf(text) {
  const out = new Set()
  if (/^\s*--(t|f|ls|fs|font|type)-[\w-]+\s*:/m.test(text)) out.add('type')
  if (/^\s*--(accent|ink|page|paper|surface|bg|fg|brand|primary|secondary|colou?r)[\w-]*\s*:/m.test(text) || /\[data-theme/.test(text)) out.add('colour')
  if (/^\s*--(maxw|max-width|measure|gutter|container)\s*:/m.test(text)) out.add('layout')
  return out
}

/** Distinctive literals: hex colours, custom properties, px sizes of 40 and up. */
function literalsOf(text) {
  const out = new Set()
  const lower = text.toLowerCase()
  for (const m of lower.matchAll(/#[0-9a-f]{6}\b/g)) out.add(m[0])
  for (const m of lower.matchAll(/--[a-z][a-z0-9-]{2,}/g)) out.add(m[0])
  for (const m of lower.matchAll(/\b(\d{2,4})px\b/g)) if (Number(m[1]) >= 40) out.add(`${m[1]}px`)
  return out
}

const hasWord = (text, word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(text)

/** The first quoted owner words in a decision's "why". */
function quoteOf(why) {
  const quotes = [...why.matchAll(/[“"]([^”"]{6,})[”"]/g)].map(m => m[1].trim())
  const pick = quotes.find(q => JUDGE.test(q)) ?? quotes[0]
  return pick === undefined ? undefined : clip(pick)
}

/**
 * One decision per list line: `- YYYY-MM-DD · area · decision · why · replaces <old value>`
 * (fields split by ` · ` or ` | `; why and replaces are optional).
 */
function parseDecisions(md) {
  const out = []
  for (const raw of md.split('\n')) {
    const m = raw.match(/^\s*[-*]\s*(\d{4}-\d{2}-\d{2})\s*[·|]\s*(.+)$/)
    if (!m) continue
    const fields = m[2].split(/\s+[·|]\s+/)
    const area = (fields[0] ?? '').trim()
    const decision = (fields[1] ?? '').trim()
    const why = (fields[2] ?? '').trim()
    const replaces = fields.slice(3).join(' · ').trim()
    out.push({ date: m[1], area, decision, why, replaces: replaces.replace(/^replaces\s+/i, ''), order: out.length })
  }
  return out
}

async function listTranscripts(root) {
  const common = await sh('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root)
  const mainRoot = common ? dirname(common.trim()) : root
  const slug = mainRoot.replace(/[^A-Za-z0-9]/g, '-')
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')
  let dirs = []
  try {
    dirs = (await readdir(projects)).filter(d => d === slug || d.startsWith(`${slug}-`))
  } catch {
    return []
  }
  const files = []
  for (const d of dirs) {
    try {
      for (const f of await readdir(join(projects, d))) if (f.endsWith('.jsonl')) files.push(join(projects, d, f))
    } catch {}
  }
  return files
}

/** Bump when what a cached owner message holds changes (redaction rules included). */
const CACHE_V = 2

const TAGGED = /<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|task-notification|agent-message|ide_[a-z_]+)[^>]*>[\s\S]*?<\/\1>/g

/** The owner's own typed messages: user rows a person sent, text only, no tool results. */
async function ownerMessages(files, cache, redact) {
  const out = []
  const next = {}
  for (const file of files) {
    let st
    try {
      st = await stat(file)
    } catch {
      continue
    }
    const hit = cache[file]
    if (hit && hit.v === CACHE_V && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      next[file] = hit
      out.push(...hit.messages)
      continue
    }
    const messages = []
    const session = basename(file, '.jsonl').slice(0, 8)
    const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line.includes('"type":"user"') || line.includes('"tool_result"') || line.includes('"isMeta":true') || line.includes('"isSidechain":true')) continue
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      if (row.type !== 'user' || row.isMeta || row.isSidechain) continue
      if (row.origin !== undefined && row.origin?.kind !== 'human') continue
      const content = row.message?.content
      const text = (typeof content === 'string' ? content : Array.isArray(content) ? content.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '')
        .replace(TAGGED, '')
        .trim()
      if (text.length < 8 || text.length > 700 || text.startsWith('/') || text.startsWith('<') || text.startsWith('[Request interrupted') || text.startsWith('This session is being continued') || text.startsWith('Caveat:')) continue
      if (/https?:\/\/\S{60,}/.test(text)) continue
      const ms = Date.parse(row.timestamp ?? '')
      if (Number.isNaN(ms)) continue
      messages.push({ text: redact(text), date: localDate(ms), session })
    }
    next[file] = { v: CACHE_V, mtimeMs: st.mtimeMs, size: st.size, messages }
    out.push(...messages)
  }
  return { messages: out, cache: next }
}

/** The best sentence of a message for a link term, under 20 words. */
function sentenceFor(text, term) {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.split(' ').length < 20) return flat
  const sentences = flat.split(/(?<=[.!?])\s+/)
  const withTerm = sentences.filter(s => term === undefined || (term instanceof RegExp ? term.test(s) : hasWord(s, term)))
  const pool = withTerm.length > 0 ? withTerm : sentences
  const best = pool.find(s => JUDGE.test(s)) ?? pool[0] ?? flat
  return clip(best)
}

/** Two quotes that share most of their words (a typo apart). */
const similar = (a, b) => {
  const A = new Set(a.split(' '))
  const B = new Set(b.split(' '))
  const both = [...A].filter(w => B.has(w)).length
  return both / Math.max(1, Math.min(A.size, B.size)) >= 0.7
}

const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

async function surnameTokens(root) {
  const name = (await sh('git', ['config', 'user.name'], root))?.trim() ?? ''
  return name.split(/\s+/).slice(1).filter(t => t.length >= 3)
}

function redactor(tokens) {
  const redact = redactorOf(tokens)
  return text => (typeof text === 'string' ? redact(text) : text)
}

/** The values each custom property a file defines held over time, oldest first, from `git log -L`. */
async function valueHistory(root, rel, text) {
  const props = [...new Set([...text.matchAll(/^\s*(--[a-zA-Z][\w-]*)\s*:/gm)].map(m => m[1]))].slice(0, 120)
  const out = {}
  await pool(props, 6, async prop => {
    const log = await sh('git', ['log', '--format=%x1e%h%x09%ad', '--date=short', '-L', `/^[[:space:]]*${prop}[[:space:]]*:/,+1:${rel}`], root, 20000)
    if (!log) return
    const points = []
    for (const chunk of log.split('\x1e').filter(Boolean)) {
      const [head, ...lines] = chunk.split('\n')
      const [hash, date] = (head ?? '').split('\t')
      const line = lines.find(l => l.startsWith('+') && new RegExp(`^\\+\\s*${prop.replace(/[-]/g, '\\-')}\\s*:`).test(l))
      if (line === undefined) continue
      const value = line.replace(/^\+\s*[^:]+:\s*/, '').replace(/;.*$/, '').trim()
      points.push({ date, value, hash })
    }
    points.reverse()
    const distinct = points.filter((p, i) => i === 0 || p.value !== points[i - 1].value)
    if (distinct.length >= 2) out[prop] = distinct
  })
  return out
}

async function pool(items, size, fn) {
  const results = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        results[k] = await fn(items[k])
      }
    }),
  )
  return results
}

/** The remote branch to read the decisions log from: origin's default branch, else origin/main, else origin/master. */
async function remoteRefs(root) {
  const head = (await sh('git', ['rev-parse', '--abbrev-ref', 'origin/HEAD'], root))?.trim()
  return [...new Set([head && head !== 'origin/HEAD' ? head : undefined, 'origin/main', 'origin/master'].filter(Boolean))]
}

/**
 * The project's decisions log: the configured path, then the common spots;
 * each read from the remote's default branch first, then the working copy.
 * `{ text: '', file: null, source: null }` when the project has none.
 */
async function readDecisions(root, configured) {
  const refs = await remoteRefs(root)
  for (const file of decisionsCandidates(configured)) {
    for (const ref of refs) {
      const text = await sh('git', ['show', `${ref}:${file}`], root)
      if (text) return { text, file, source: `${basename(file)} (${ref})` }
    }
    try {
      const text = await readFile(join(root, file), 'utf8')
      return { text, file, source: `${basename(file)} (working copy)` }
    } catch {}
  }
  return { text: '', file: null, source: null }
}

export async function build(projectDir, { cacheFile, decisions: configured } = {}) {
  const top = (await sh('git', ['rev-parse', '--show-toplevel'], projectDir))?.trim()
  const root = top || projectDir
  const redact = redactor(await surnameTokens(root))
  const log = await readDecisions(root, configured)

  // Files: tracked source files (or, without git, nothing to index by history).
  const listed = (await sh('git', ['ls-files'], root)) ?? ''
  const rels = listed
    .split('\n')
    .filter(Boolean)
    .filter(f => SOURCE_EXT.has(extname(f)) && f !== log.file && !/(^|\/)(node_modules|dist|build|\.next)\//.test(f) && !f.endsWith('package-lock.json'))
  const files = {}
  for (const rel of rels) {
    let text = ''
    try {
      const st = await stat(join(root, rel))
      if (st.size < 512 * 1024) text = await readFile(join(root, rel), 'utf8')
    } catch {
      continue
    }
    files[rel] = { ...namesOf(rel), defines: definesOf(text), literals: literalsOf(text), ghosts: [], text: definesOf(text).size > 0 ? text : undefined }
  }

  // (1) the decisions log, when the project has one.
  const decisionsSource = log.source
  const decisions = parseDecisions(log.text)
  for (const d of decisions) {
    const areaWords = new Set(wordsOf(d.area).flatMap(w => [w, singular(w)]))
    const text = `${d.decision} ${d.replaces}`
    const isKeep = d.area.toLowerCase() === 'keep'
    const topics = new Set(topicsOf(isKeep ? text : `${d.area} ${d.area === 'type' ? 'type size' : ''}`))
    if (/\btype\b/i.test(d.area)) topics.add('type')
    if (/\b(theme|colou?r|dark|light)\b/i.test(d.area)) topics.add('colour')
    if (/\blayout\b/i.test(d.area)) topics.add('layout')
    const lits = literalsOf(`${d.decision} ${d.replaces} ${d.why}`)
    const keys = new Set([...tokenize(`${d.area} ${text}`), ...[...topics].map(t => `topic:${t}`), ...lits])
    for (const [rel, f] of Object.entries(files)) {
      let scope
      const named = (f.component && new RegExp(`\\b${f.component}\\b`).test(`${d.area} ${d.decision} ${d.why}`)) || text.includes(f.base) || text.includes(rel)
      const areaHit = f.words.some(w => areaWords.has(w))
      const textHits = new Set(f.words.filter(w => hasWord(d.decision, w)).map(singular)).size
      if (named || areaHit || textHits >= 2) scope = 'file'
      else if ([...topics].some(t => f.defines.has(t))) scope = 'topic'
      else if ([...lits].some(l => f.literals.has(l) && !/^--(t|f|ls)-/.test(l))) scope = 'topic'
      if (scope === undefined) continue
      const weight = (scope === 'file' ? 4 : 3) + (d.replaces ? 1 : 0) + (isKeep ? 1 : 0) - d.order * 0.001
      f.ghosts.push({
        kind: 'decision',
        date: d.date,
        quote: redact(quoteOf(d.why)),
        what: redact(clip(`(${d.area}) ${d.decision}`, 16)),
        undo: d.replaces ? redact(clip(d.replaces, 12)) : undefined,
        undoKeys: d.replaces ? undoKeysOf(d.replaces) : undefined,
        scope,
        keys: [...keys],
        weight,
        source: decisionsSource,
      })
    }
  }

  // (2) git log --follow subjects that read as swings.
  const counts = new Map()
  const all = (await sh('git', ['log', '--format=%x1e%h', '--name-only'], root, 60000)) ?? ''
  for (const chunk of all.split('\x1e').filter(Boolean)) {
    const [hash, ...names] = chunk.trim().split('\n')
    counts.set(hash, names.filter(Boolean).length)
  }
  let commitGhosts = 0
  await pool(Object.keys(files), 8, async rel => {
    const log = await sh('git', ['log', '--follow', '-n', '10', '--format=%h%x09%ad%x09%s', '--date=short', '--', rel], root)
    if (!log) return
    for (const line of log.split('\n').filter(Boolean)) {
      const [hash, date, ...rest] = line.split('\t')
      const subject = rest.join('\t').replace(/\s*\(#\d+\)\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '')
      if (!SWING.test(subject)) continue
      const isWide = (counts.get(hash) ?? 0) > 8
      files[rel].ghosts.push({
        kind: 'commit',
        date,
        what: redact(clip(subject, 14)),
        scope: isWide ? 'topic' : 'file',
        keys: tokenize(subject),
        weight: isWide ? 2 : 3,
        source: `git ${hash}`,
      })
      commitGhosts += 1
    }
  })

  // (3) the owner's own words in past transcripts.
  let cache = {}
  if (cacheFile) {
    try {
      cache = JSON.parse(await readFile(cacheFile, 'utf8'))
    } catch {}
  }
  const transcriptFiles = await listTranscripts(root)
  const owner = await ownerMessages(transcriptFiles, cache, redact)
  if (cacheFile) {
    await mkdir(dirname(cacheFile), { recursive: true })
    await writeFile(cacheFile, JSON.stringify(owner.cache))
  }
  const decisionQuotes = Object.values(files)
    .flatMap(f => f.ghosts)
    .filter(g => g.kind === 'decision' && g.quote)
    .map(g => norm(g.quote.replace(/…$/, '')))
  const seenOwner = new Set()
  const messages = owner.messages.filter(m => {
    const k = norm(m.text)
    if (seenOwner.has(k)) return false
    seenOwner.add(k)
    return true
  })
  for (const m of messages) {
    const lower = m.text.toLowerCase()
    const topics = Object.keys(OWNER_TOPICS).filter(t => OWNER_TOPICS[t].test(m.text))
    const judged = JUDGE.test(m.text)
    for (const [rel, f] of Object.entries(files)) {
      let scope
      let term
      if (f.component && new RegExp(`\\b${f.component}\\b`).test(m.text)) {
        scope = 'file'
        term = f.component
      } else if (m.text.includes(f.base)) {
        scope = 'file'
        term = f.base
      } else {
        const w = f.words.find(word => new RegExp(`\\b${word}s?\\s+${UNIT_WORDS}\\b`, 'i').test(lower) || new RegExp(`\\b${UNIT_WORDS}\\s+(on|of|in)\\s+(the\\s+)?${word}\\b`, 'i').test(lower))
        if (w !== undefined && judged) {
          scope = 'file'
          term = w
        } else if (judged) {
          const t = topics.find(one => f.defines.has(one))
          if (t !== undefined) {
            scope = 'topic'
            term = OWNER_TOPICS[t]
          }
        }
      }
      if (scope === undefined) continue
      const quote = redact(sentenceFor(m.text, term))
      const nq = norm(quote.replace(/…$/, ''))
      if (decisionQuotes.some(dq => dq.length > 8 && (dq.includes(nq) || nq.includes(dq) || similar(dq, nq)))) continue
      f.ghosts.push({
        kind: 'owner',
        date: m.date,
        quote,
        what: quote,
        scope,
        keys: [...new Set([...tokenize(redact(m.text)), ...topics.map(t => `topic:${t}`)])],
        weight: scope === 'file' ? 3 : 1,
        source: `transcript ${m.session}`,
      })
    }
  }

  // Value histories of the custom properties in files that define a system (type, colour, layout).
  const values = {}
  for (const [rel, f] of Object.entries(files)) {
    if (f.text === undefined) continue
    const history = await valueHistory(root, rel, f.text)
    if (Object.keys(history).length > 0) values[rel] = history
  }

  // Keep the best few per file: decisions and commits first, then the owner's newest words.
  const out = {}
  for (const [rel, f] of Object.entries(files)) {
    if (f.ghosts.length === 0) continue
    const ownerTop = f.ghosts
      .filter(g => g.kind === 'owner')
      .sort((a, b) => b.weight - a.weight || b.date.localeCompare(a.date))
      .slice(0, 4)
    const best = kind =>
      f.ghosts
        .filter(g => g.kind === kind)
        .sort((a, b) => b.weight - a.weight || b.date.localeCompare(a.date))
    out[rel] = [...best('decision').slice(0, 10), ...best('commit').slice(0, 4), ...ownerTop].map(g => Object.fromEntries(Object.entries(g).filter(([, v]) => v !== undefined)))
  }
  return {
    v: 1,
    root,
    builtAt: Date.now(),
    sources: { decisions: decisionsSource, commits: commitGhosts, transcripts: transcriptFiles.length, ownerMessages: messages.length },
    decisionsFile: log.file,
    files: out,
    values,
  }
}

async function main() {
  const [projectDir, ...rest] = process.argv.slice(2)
  if (!projectDir) {
    console.error('usage: build-index.mjs <projectDir> <outFile> [--decisions <path>] | <projectDir> --lookup <file> [--before <text>] [--after <text>] [--decisions <path>]')
    process.exit(2)
  }
  const arg = name => (rest.indexOf(name) >= 0 ? rest[rest.indexOf(name) + 1] : undefined)
  const decisions = arg('--decisions')
  const lookupAt = rest.indexOf('--lookup')
  if (lookupAt >= 0) {
    const index = await build(projectDir, { decisions })
    const file = rest[lookupAt + 1]
    const after = arg('--after')
    const edit = after === undefined ? undefined : { before: arg('--before') ?? '', after }
    const rel = file.startsWith(`${index.root}/`) ? file.slice(index.root.length + 1) : file
    const ranked = rank(index.files[rel], edit)
    console.log(JSON.stringify({ root: index.root, sources: index.sources, filesWithHistory: Object.keys(index.files).length, file: rel, edit: edit ?? null, ghostsInIndex: index.files[rel]?.length ?? 0, raised: ranked.length }, null, 1))
    if (ranked.length === 0) {
      console.log('→ no ghost (quiet)')
      return
    }
    console.log(`→ band: ${lineOf(ranked[0].ghost, index.files[rel])}`)
    console.log(`→ context for Claude:\n${noteOf(rel, ranked)}`)
    console.log('→ ranked:')
    for (const { ghost, score } of ranked.slice(0, 6)) console.log(`  ${score.toFixed(2)} ${ghost.kind}/${ghost.scope} ${ghost.date} ${ghost.source} :: ${ghost.quote ? `"${ghost.quote}" ` : ''}${ghost.kind === 'owner' ? '' : ghost.what}`)
    return
  }
  const outFile = rest[0]
  if (!outFile || outFile.startsWith('--')) {
    console.error('missing <outFile>')
    process.exit(2)
  }
  const started = Date.now()
  const index = await build(projectDir, { cacheFile: `${outFile}.transcripts-cache.json`, decisions })
  await mkdir(dirname(outFile), { recursive: true })
  const tmp = `${outFile}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(index))
  await rename(tmp, outFile)
  console.log(`clawd-ghost: indexed ${Object.keys(index.files).length} files with history in ${Date.now() - started} ms → ${outFile}`)
}

main().catch(err => {
  console.error(`clawd-ghost: ${err?.stack ?? err}`)
  process.exit(1)
})
