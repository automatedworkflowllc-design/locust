/**
 * Slash commands: a way in to what the composer can already do.
 *
 * Deliberately not a new capability. Every command here maps to a control that
 * is already on the composer row -- the mode menu, the route picker, the
 * effort chip, the swarm mark, the stop button -- so the first version adds a
 * keyboard path to things that exist and demonstrably work, and nothing that
 * has to be built underneath it.
 *
 * That is the rule this app keeps returning to: a control drawn for a
 * capability that does not exist costs more than a missing one. The `+` was
 * removed for a year of design-review time over exactly this. So there is no
 * `/attach` until attaching has a keyboard path worth naming, no `/memory`,
 * and no `/agents`.
 *
 * The menu is built from what the CALLER says is available -- a command whose
 * mode this runtime cannot honour, or `/stop` when nothing is running, is not
 * offered. `availableCommands` is where that filtering happens, so a command
 * can never be listed and then refused.
 */

import type { MissionMode } from '../../shared/ipc.js'

export type SlashAction =
  | { readonly kind: 'mode'; readonly mode: MissionMode }
  | { readonly kind: 'route' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'swarm' }

export interface SlashCommand {
  /** Typed after the slash, lowercase. */
  readonly name: string
  /** What it does, in the words the menu shows. */
  readonly detail: string
  readonly action: SlashAction
  /**
   * This one has consequences the others do not, and is drawn apart.
   *
   * Amber text alone was doing a whole section's work: it says "this row is
   * different" only AFTER you have read it, which is the wrong order for the
   * row that lets a run change anything on the machine (design, 2026-09-08).
   * A weighted command sits below a hairline, in its own tinted section, with
   * the shield glyph.
   */
  readonly weighted?: true
}

/**
 * Every command this build has. Order is the order the menu draws them: the
 * modes first, because that is what a person changes most, then the route,
 * then the two that are only sometimes there.
 *
 * `/auto` is LAST, and that is the only deliberate reordering. Arrow-down from
 * a bare slash should land on `/edit`; the most consequential row belongs
 * furthest from an accidental Enter (design, 2026-09-08).
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: 'ask', detail: 'Reads and explains. Every write is refused.', action: { kind: 'mode', mode: 'ask' } },
  { name: 'plan', detail: 'Answers with the steps it would take, and changes nothing.', action: { kind: 'mode', mode: 'plan' } },
  { name: 'edit', detail: 'May edit files inside this folder.', action: { kind: 'mode', mode: 'accept-edits' } },
  { name: 'approve', detail: 'Stops and asks before every command or file change.', action: { kind: 'mode', mode: 'approve-each' } },
  { name: 'model', detail: 'Choose the runtime and model.', action: { kind: 'route' } },
  { name: 'swarm', detail: 'Every mission at its model maximum.', action: { kind: 'swarm' } },
  { name: 'stop', detail: 'Stop the running mission.', action: { kind: 'stop' } },
  { name: 'auto', detail: 'Runs without asking, and may change anything on this machine.', action: { kind: 'mode', mode: 'auto' }, weighted: true }
]

/**
 * What the person has typed, if it is a command being typed.
 *
 * Only a message that is ONLY a command counts. `/plan` opens the menu;
 * "run /plan on this" is a sentence that happens to contain a slash, and
 * turning it into a mode change would be the app acting on something that was
 * never addressed to it.
 */
export function slashQuery(text: string): string | undefined {
  const match = /^\/([a-z]*)$/i.exec(text.trim())
  return match === null ? undefined : (match[1] ?? '').toLowerCase()
}

/**
 * The commands to offer, given what is actually possible right now.
 *
 * `modes` are the modes this runtime can honour; `running` decides whether
 * stopping is a thing that can be done. A command that would be refused is
 * never listed.
 */
export function availableCommands(input: {
  readonly modes: readonly MissionMode[]
  readonly running: boolean
  readonly canSwarm: boolean
}): readonly SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => {
    switch (command.action.kind) {
      case 'mode':
        return input.modes.includes(command.action.mode)
      case 'stop':
        return input.running
      case 'swarm':
        return input.canSwarm
      default:
        return true
    }
  })
}

/** Those whose name starts with what has been typed so far. */
export function matchingCommands(
  query: string,
  available: readonly SlashCommand[]
): readonly SlashCommand[] {
  return available.filter((command) => command.name.startsWith(query))
}
