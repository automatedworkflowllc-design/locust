import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { RuntimeCommandInfo } from '@teammate/runtime-adapters'

/**
 * EACH RUNTIME'S OWN SLASH COMMANDS, IN THE `/` MENU (0.426).
 *
 * Colin, 2026-09-28: "is there a way to include all the commands for each
 * respective model? Lots of the nerdier coders live by their commands and if
 * they can't access them or see them in the same way they can in claude
 * code/codex etc. it may be a turn off for them."
 *
 * Claude Code lists every command it has -- its own and the person's
 * (.claude/commands, skills) -- with a description, at the start of every
 * run. Locust used to drop that list; it is kept here, once, outside every
 * mission's record, and read by the composer's `/` menu. A message that
 * starts with one of them is sent as the command itself (peer-exchange).
 *
 * MEASURED 2026-09-28 on Claude Code 2.1.283, headless: 119 commands, among
 * them compact, init, context, clear, security-review. Left out: the ones
 * that change the person's own Claude Code setup outside the conversation --
 * model and effort are the teammate's, set in Locust; config, mcp,
 * output-style, agents and fast would rewrite the person's settings.
 */
export const HIDDEN_COMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  claude: new Set(['model', 'effort', 'fast', 'config', 'mcp', 'output-style', 'agents', 'login', 'logout', 'permissions', 'hooks', 'statusline', 'theme', 'vim', 'terminal-setup', 'privacy-settings', 'upgrade', 'install-github-app', 'ide', 'keybindings', 'exit', 'resume', 'sandbox', 'plugin', 'add-dir', 'memory', 'auto-mode-setup'])
}

/**
 * The runtimes whose commands Locust can list and send (0.427 adds OpenCode:
 * its server lists them, opencode-commands.ts, and `run --command` sends one).
 * OpenCode's are all prompt templates -- `init`, `review`, the person's
 * commands and skills -- so none is hidden.
 */
export const COMMAND_RUNTIMES = ['claude', 'opencode'] as const
export type CommandRuntime = (typeof COMMAND_RUNTIMES)[number]
const isCommandRuntime = (runtime: string | undefined): runtime is CommandRuntime =>
  (COMMAND_RUNTIMES as readonly string[]).includes(runtime ?? '')

/**
 * CODEX'S OWN COMMANDS (0.428), which Codex never lists: its terminal draws
 * them and sends each as a request of its own. Only the ones that do work in
 * a conversation are here, described as its terminal describes them; the
 * rest (/model, /approvals, /new, /diff, /status) are Locust's own controls.
 * `review` and `compact` go as the requests (codex-app-server-run.ts); `init`
 * is a turn carrying CODEX_INIT_PROMPT.
 */
export const CODEX_COMMANDS: readonly RuntimeCommandInfo[] = [
  { name: 'review', description: 'Review your current changes and find issues', argumentHint: '[what to review]' },
  { name: 'compact', description: 'Summarize the conversation to prevent hitting the context limit', argumentHint: '' },
  { name: 'init', description: 'Create an AGENTS.md file with instructions for Codex', argumentHint: '' }
]

/** What `/init` asks Codex to do -- Locust's words, to the same end as its terminal's. */
export const CODEX_INIT_PROMPT =
  'Create an AGENTS.md file at the root of this repository: a short guide for coding agents working here. ' +
  'Look at the project first. Cover how it is laid out, how to build, test and run it, the conventions its code follows, ' +
  'and anything a newcomer would likely get wrong. Keep it concise and specific to this repository. ' +
  'If an AGENTS.md already exists, improve it rather than replacing it.'

export interface RuntimeCommands {
  /** What each runtime offers, hidden ones left out. */
  list(): Promise<Readonly<Partial<Record<CommandRuntime | 'codex', readonly RuntimeCommandInfo[]>>>>
  /** Take a runtime's list as its CLI sent it; true when it changed. */
  set(runtime: CommandRuntime, commands: readonly RuntimeCommandInfo[]): Promise<boolean>
  /** Whether a message is one of this runtime's commands, and so is sent as it is. */
  isCommand(runtime: string | undefined, prompt: string): boolean
}

/** The command a message names, when it starts with `/name`. */
export function commandNamed(prompt: string): string | undefined {
  return /^\/([A-Za-z0-9][A-Za-z0-9:._-]{0,63})(?=\s|$)/.exec(prompt.trimStart())?.[1]
}

export function createRuntimeCommands(options: { readonly file: string }): RuntimeCommands {
  let held: Partial<Record<CommandRuntime, readonly RuntimeCommandInfo[]>> = {}
  const visible = (runtime: CommandRuntime, commands: readonly RuntimeCommandInfo[]): readonly RuntimeCommandInfo[] =>
    commands.filter((command) => !(HIDDEN_COMMANDS[runtime]?.has(command.name) ?? false))
  const read = async (): Promise<void> => {
    try {
      const parsed = JSON.parse(await readFile(options.file, 'utf8')) as { byRuntime?: Record<string, unknown> }
      for (const runtime of COMMAND_RUNTIMES) {
        const kept = parsed.byRuntime?.[runtime]
        if (!Array.isArray(kept)) continue
        held = {
          ...held,
          [runtime]: kept.flatMap((entry): RuntimeCommandInfo[] =>
            typeof entry === 'object' && entry !== null && typeof (entry as RuntimeCommandInfo).name === 'string'
              ? [{ name: (entry as RuntimeCommandInfo).name, description: String((entry as RuntimeCommandInfo).description ?? ''), argumentHint: String((entry as RuntimeCommandInfo).argumentHint ?? '') }]
              : [])
        }
      }
    } catch {
      // None yet, or unreadable: the menu offers Locust's own until the next Claude run lists them.
    }
  }
  // Read at once, so the first message of a session is recognised; every
  // caller waits on the same read (a flag set before it finished handed a
  // second caller an empty list).
  const loading = read()
  const load = (): Promise<void> => loading
  return {
    async list() {
      await load()
      return {
        ...Object.fromEntries(COMMAND_RUNTIMES.flatMap((runtime) => {
          const commands = held[runtime]
          return commands === undefined ? [] : [[runtime, visible(runtime, commands)]]
        })),
        codex: CODEX_COMMANDS
      }
    },
    async set(runtime, commands) {
      await load()
      if (JSON.stringify(held[runtime] ?? []) === JSON.stringify(commands)) return false
      held = { ...held, [runtime]: commands }
      const temporary = `${options.file}.tmp`
      await mkdir(dirname(options.file), { recursive: true })
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, byRuntime: held }), 'utf8')
      await rename(temporary, options.file)
      return true
    },
    isCommand(runtime, prompt) {
      const name = commandNamed(prompt)
      if (runtime === 'codex') return name !== undefined && CODEX_COMMANDS.some((command) => command.name === name)
      if (!isCommandRuntime(runtime)) return false
      return name !== undefined && visible(runtime, held[runtime] ?? []).some((command) => command.name === name)
    }
  }
}
