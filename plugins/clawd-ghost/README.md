# clawd-ghost: the ghost of sessions past

Unofficial fan-made mods. Not affiliated with or endorsed by Anthropic. Clawd is Anthropic's character.

Before Claude edits a file, a small ghost Clawd floats into the band above the prompt and tells you what happened to that file before: a decision you logged, a commit that swung it, or something you said about it in an earlier session. The point is to stop a settled choice from quietly swinging back.

<!-- TODO screenshot: docs/screenshot-ghost-terminal.png and docs/screenshot-ghost-desktop.png at the repository root, then link them here. -->

## What you see

Each haunting is three lines and two buttons. For example, on a fictional bakery site:

> Boooo. I'm hero 64px. You buried me on 12 May.
> Your last words: "the hero feels too loud"
> Bring me back and you undo: a quieter hero: hero 56, titles 44.
> [1 Let me rest] [2 I'm back on purpose]

- The ghost gets more solid, and on the third reversal of the same value grumpy, each time a value swings back. The count comes from that value's history in git.
- **1** dismisses it with a parting line. Claude is told nothing.
- **2** on a swing asks Claude to record your choice in your decisions file, through your project's normal process. The mod itself never writes a file. On a history-only ghost, **2** just says "Noted".
- After the edit runs, Claude gets the same facts as a short note, so it can tell you which decision an edit reverses.
- It stays quiet when the file has no history, when the history is about something the edit doesn't touch (for example, a colour decision during a font-size edit), and for files it has already haunted this session.

It only watches. It never blocks, denies or rewrites an edit.

## Commands and keys

- `/ghost` lists the ghosts for every file this session has edited. It runs right away, even mid-turn.
- `1` and `2` press the band's buttons when the prompt is empty.

## What it reads

Everything stays on your machine. The mod makes no network calls.

1. **Your decisions file**, if you keep one. By default it's `design/decisions.md`. If that isn't there, the mod tries `DECISIONS.md`, `docs/decisions.md` and `decisions.md`. It reads the file from your remote's default branch (`origin/HEAD`, then `origin/main`, then `origin/master`) when there is one, and from the working copy otherwise. One decision per line:

   ```
   - 2026-05-12 · type · a quieter hero: hero 56, titles 44 · "the hero feels too loud" · replaces 64/52
   ```

   The fields are date, area, decision, why (put your own words in quotes) and what it replaced. You can separate them with `·` or `|`. Only the date, area and decision are required.
2. **Git history:** `git log --follow` subjects that read as swings (revert, back to, undo, smaller, bigger, tone down…), and each CSS custom property's value history from `git log -L`.
3. **Your own past prompts** in this project's Claude Code transcripts (`~/.claude/projects/<project>*/*.jsonl`). The mod reads only the messages you typed, with no tool output. It removes the surname from `git config user.name` and shortens absolute paths to file names.

Without a decisions file, the ghost still works from git history and your past prompts alone.

The index is built in the background at session start and at most every 10 minutes after a turn, by `scripts/build-index.mjs` (Node 22.6 or newer, found as `node`, `/opt/homebrew/bin/node` or `/usr/local/bin/node`). It is written to `.data/` inside the plugin's own folder.

## Settings

| Option | Default | What it does |
| --- | --- | --- |
| `decisionsFile` | `design/decisions.md` | Your decisions log, relative to the repository root. Change it in `/config`. |

## What the mod reaches

From `claude plugin validate`:

```
hooks: session.start, turn.complete, tool.call, prompt.submit, ui.render{component=AbovePrompt}, command.run{command=ghost}
calls: $.clock.after (via showAfter), $.clock.every (via ensureFloat), $.clock.now, $.command.register, $.fs.read, $.fs.stat (via loadIndex, refreshIfStale), $.process.spawn (via buildIndex), $.prompt.submit (via overrule), $.session.root, $.state.get, $.state.set, $.store.get (via rotationOf), $.store.set (via remember), $.ui.blit (via ensureFloat), $.ui.invalidate (via ensureFloat), $.ui.log, $.ui.resolve
```

- `$.process.spawn` starts the local index builder, nothing else.
- `$.prompt.submit` sends one prompt, and only when you press **2** on a swing while Claude is idle.

## Requirements

- Claude Code 2.1.287 or newer (CLI). The Desktop app 2.1.286 has been seen working.
- The ghost is drawn in the terminal and in the Desktop app's Code tab. Elsewhere the hooks still run, but nothing is drawn.
- Node 22.6 or newer for the index builder.

## Install

```sh
claude plugin marketplace add ozansozuozgit/clawd-mods
claude plugin install clawd-ghost@clawd-mods
```

Or, in a session: `/plugin install clawd-ghost --marketplace ozansozuozgit/clawd-mods`

## Turn it off

Run `/plugin` and disable `clawd-ghost`, or `claude plugin uninstall clawd-ghost@clawd-mods`.

## Develop

```sh
claude plugin validate --strict .
claude plugin test .
# what an edit would raise, in a real project:
node --experimental-strip-types scripts/build-index.mjs <project> --lookup app/base.css \
  --before '--t-display: clamp(40px, 5vw, 56px);' --after '--t-display: clamp(40px, 5vw, 64px);'
# load it for one session:
claude --plugin-dir .
```

**Files**

- `hooks/register.tsx`: the hooks.
- `hooks/ghost.ts`: the index shape, ranking, the swing maths and the redactor. The index builder imports it too.
- `hooks/copy.ts`: the lines and the card.
- `hooks/sprite.ts`: the character (pixels, colours, names).
- `hooks/desktop.ts`: the Desktop SVG.
- `scripts/build-index.mjs`: the index builder.

## Licence

MIT. See [LICENSE](../../LICENSE).
