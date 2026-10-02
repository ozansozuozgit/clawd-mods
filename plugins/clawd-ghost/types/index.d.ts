/** How solid the ghost is: 1 faint, 2 more solid, 3 solid and grumpy. */
export type GhostLevel = 1 | 2 | 3

/** The ghost the band shows: three lines and two buttons, or one short line after a press. */
export type GhostCard = {
  /** Unique per haunting; a timer that hides an after-press line checks it. */
  id: string
  /** The file, relative to the project root. */
  file: string
  /** `swing`: the edit brings back a value a decision replaced. `history`: the file has history. `plain`: one fallback line. */
  kind: 'swing' | 'history' | 'plain'
  level: GhostLevel
  /** Which reversal this is on the same system. */
  n: number
  /** Punchline, fact, consequence (or the after-press line alone). */
  lines: string[]
  buttons: [string, string]
  mode: 'haunt' | 'after'
  /** How many more ghosts the file has (`/ghost` lists them). */
  more: number
  /** The facts button 2 hands to Claude on a swing. */
  overrule?: { old: string; new: string; date: string; decision: string; thing: string }
  /** The tombstone line's gravestone (desktop): the value, when it first landed, when it was decided away. */
  tomb?: { name: string; born: string; died: string }
  /** The placeholders known for this haunting, for the after-press lines. */
  vars: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    'clawd-ghost': {
      /** The ghost on screen; null when dismissed or none. */
      current: GhostCard | null
      /** Files whose ghost was already shown this session (relative paths): no repeats. */
      shown: string[]
      /** Files this session edited (relative paths), for `/ghost`. */
      touched: string[]
      /** A note for Claude after the owner overruled a ghost; rides the next tool result. */
      pendingNote: string | null
    }
  }
}
