import type { ReactElement } from 'react'

import { isMissionRuntime, runtimeDisplayName } from '../../../shared/runtimes.js'
import { isOwnRoute } from '../routeName.js'
import { Icon } from './Icon.js'

/**
 * `</>` OPEN IN TERMINAL (0.387).
 *
 * Colin, 2026-09-26, on a terminal option for a conversation: "we can either
 * ship it in the three dot dropdown or have it more visible, or do like a
 * coding terminal button" -- with a picture of a small `</>` square. Both:
 * the button beside the header's other two, and the same action in the ...
 * menu, where a person looks for what a conversation can do.
 *
 * The host does the opening (main/open-in-terminal.ts): the same session, in
 * the runtime's own interface, in this teammate's folder. What the button
 * says is what that means for the person: the terminal runs with the
 * runtime's own permissions, not this conversation's mode -- and, for Claude
 * Code and Codex, what they do there comes back into the conversation (0.391,
 * main/terminal-catch-up.ts). The others keep their sessions where Locust
 * does not read yet, and it says so.
 */
export interface TerminalOffer {
  /** "Claude Code": whose interface opens. */
  readonly runtimeName: string
  /** The button's accessible name. */
  readonly label: string
  /** The hover: what opens, and what it means. */
  readonly title: string
  /** Why it cannot be pressed now, when it cannot. */
  readonly disabled?: string
  /** What is said once it opened: whether what happens there comes back. */
  readonly opened: (where: string) => string
}

/** Runtimes with an interface of their own to resume a session in (open-in-terminal.ts). */
const RESUMABLE: ReadonlySet<string> = new Set(['codex', 'claude', 'copilot', 'cursor', 'opencode', 'muse'])
/** The ones whose sessions Locust reads back afterwards (terminal-catch-up.ts). */
const COMES_BACK: ReadonlySet<string> = new Set(['codex', 'claude'])

export function terminalOffer(input: {
  readonly runtime: string | undefined
  readonly model: string | undefined
  readonly missionId: string | undefined
  readonly running: boolean
  readonly teammateName: string | undefined
}): TerminalOffer | undefined {
  const { runtime, model, missionId, running, teammateName } = input
  if (missionId === undefined || runtime === undefined || !isMissionRuntime(runtime) || !RESUMABLE.has(runtime)) return undefined
  // A model of the person's own runs on settings only Locust hands OpenCode.
  if (model !== undefined && isOwnRoute(model)) return undefined
  const runtimeName = runtimeDisplayName(runtime)
  const whose = teammateName === undefined ? 'this folder' : `${teammateName}'s folder`
  const comesBack = COMES_BACK.has(runtime)
  const afterwards = comesBack ? 'What you do there comes back into this conversation' : "Locust won't see what you do there"
  return {
    runtimeName,
    label: `Open in ${runtimeName}, in a terminal`,
    title: `Open in ${runtimeName}, in a terminal\nThe same session, in ${whose}. ${afterwards}, and it runs with ${runtimeName}'s own permissions, not this conversation's mode.`,
    opened: (where) => (comesBack ? `Opened in ${where}. What you do there comes back here when you return.` : `Opened in ${where}. Locust won't see what happens there.`),
    ...(running
      ? { disabled: `Available when ${teammateName ?? 'this run'} finishes: Locust's run and a terminal can't share one session at once.` }
      : {})
  }
}

export function OpenInTerminalButton({ offer, onOpen }: { readonly offer: TerminalOffer; readonly onOpen: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="lc-button"
      aria-label={offer.label}
      title={offer.disabled ?? offer.title}
      disabled={offer.disabled !== undefined}
      onClick={onOpen}
    >
      <Icon name="code" size={13} />
    </button>
  )
}
