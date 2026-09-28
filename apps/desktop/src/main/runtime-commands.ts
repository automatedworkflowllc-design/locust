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
  claude: new Set(['model', 'effort', 'fast', 'config', 'mcp', 'output-style', 'agents', 'login', 'logout', 'permissions', 'hooks', 'statusline', 'theme', 'vim', 'terminal-setup', 'privacy-settings', 'upgrade', 'install-github-app', 'ide', 'keybindings', 'exit', 'resume', 'sandbox', 'plugin', 'add-dir', 'memory'])
}

export type CommandRuntime = 'claude'

export interface RuntimeCommands {
  /** What each runtime offers, hidden ones left out. */
  list(): Promise<Readonly<Partial<Record<CommandRuntime, readonly RuntimeCommandInfo[]>>>>
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
      const claude = parsed.byRuntime?.claude
      if (Array.isArray(claude)) {
        held = {
          claude: claude.flatMap((entry): RuntimeCommandInfo[] =>
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
      return held.claude === undefined ? {} : { claude: visible('claude', held.claude) }
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
      if (runtime !== 'claude') return false
      const name = commandNamed(prompt)
      return name !== undefined && visible('claude', held.claude ?? []).some((command) => command.name === name)
    }
  }
}
