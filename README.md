# clawd-mods

Unofficial fan-made mods. Not affiliated with or endorsed by Anthropic. Clawd is Anthropic's character.

Small Claude Code mods that put Clawd in the band above your prompt.

| Mod | What it does | Reaches |
| --- | --- | --- |
| [clawd-ghost](plugins/clawd-ghost) | Before Claude edits a file, a ghost tells you what happened to that file before (a logged decision, a commit that swung it, something you said about it) so settled choices don't quietly swing back. | Local only: your decisions file, git history, your own past prompts. No network. Observe-only. |

<!-- TODO screenshots: docs/screenshot-ghost-terminal.png, docs/screenshot-ghost-desktop.png -->

## Install

```sh
claude plugin marketplace add ozansozuozgit/clawd-mods
claude plugin install clawd-ghost@clawd-mods
```

Or, in a session:

```
/plugin install clawd-ghost --marketplace ozansozuozgit/clawd-mods
```

## Requirements

- Claude Code 2.1.287 or newer (CLI). The Desktop app 2.1.286 has been seen working.
- The mods are drawn in the terminal and in the Desktop app's Code tab. On other surfaces the hooks still run, but nothing is drawn.
- clawd-ghost builds its index with Node 22.6 or newer.

## What each mod reaches

These lines are the output of `claude plugin validate`.

**clawd-ghost**

```
hooks: session.start, turn.complete, tool.call, prompt.submit, ui.render{component=AbovePrompt}, command.run{command=ghost}
calls: $.clock.after (via showAfter), $.clock.every (via ensureFloat), $.clock.now, $.command.register, $.fs.read, $.fs.stat (via loadIndex, refreshIfStale), $.process.spawn (via buildIndex), $.prompt.submit (via overrule), $.session.root, $.state.get, $.state.set, $.store.get (via rotationOf), $.store.set (via remember), $.ui.blit (via ensureFloat), $.ui.invalidate (via ensureFloat), $.ui.log, $.ui.resolve
```

- It reads your decisions file (`design/decisions.md` by default; set `decisionsFile` in `/config`), your git history, and your own past Claude Code prompts in `~/.claude/projects`, all locally.
- It builds a local index under the plugin's own folder (`.data/`), using a Node script that `$.process.spawn` starts.
- It never sends anything over the network.
- It is observe-only: it never blocks or rewrites an edit, and it never writes your decisions file.

## Commands and keys

| | |
| --- | --- |
| `/ghost` | Lists the ghosts for the files this session edited. |
| `1` `2` | Press the band's buttons when the prompt is empty: rest / overrule. |

## Turn it off

Run `/plugin` and disable the mod, or uninstall it:

```sh
claude plugin uninstall clawd-ghost@clawd-mods
```

## Develop

```sh
claude plugin validate --strict .                      # the marketplace
claude plugin validate --strict plugins/clawd-ghost
claude plugin test plugins/clawd-ghost
claude --plugin-dir plugins/clawd-ghost                # try it for a session
```

Claude Code writes its TypeScript declarations into a plugin's `.claude-plugin/types/` (gitignored) when it loads the plugin from a local folder (`claude --plugin-dir`), or when you run `/plugin-types`. After that, `npx tsc --noEmit -p plugins/clawd-ghost` type-checks it.

The ghost keeps its character, Clawd's pixels and colours, in one place: `hooks/sprite.ts` and `hooks/desktop.ts`.

## Licence

MIT. See [LICENSE](LICENSE).
