/**
 * Claude work that keeps going when Locust closes (W10, 0.683): what the window and the host share.
 * main/claude-background-runs.ts starts and watches the runs; components/BackgroundRuns.tsx shows them.
 */
export const BACKGROUND_LIST_CHANNEL = 'background:list'
export const BACKGROUND_START_CHANNEL = 'background:start'
export const BACKGROUND_STOP_CHANNEL = 'background:stop'
export const BACKGROUND_OPEN_CHANNEL = 'background:open'
export const BACKGROUND_SETUP_CHANNEL = 'background:setup'
export const BACKGROUND_DISMISS_CHANNEL = 'background:dismiss'

export type PublicBackgroundState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped' | 'unknown'

export interface PublicBackgroundRun {
  readonly id: string
  readonly prompt: string
  readonly startedAt: string
  readonly state: PublicBackgroundState
  readonly waitingFor?: string
  readonly name?: string
  readonly teammateId?: string
  readonly model?: string
  /** The conversation it continues, when it continues one. */
  readonly conversation?: string
  /** The turn it came back as, once it is over. */
  readonly broughtIn?: string
  readonly notBroughtIn?: string
}

export interface BackgroundStartRequest {
  readonly prompt: string
  readonly teammateId?: string
  /** Any turn of the conversation it continues; absent for a new conversation. */
  readonly conversation?: string
  readonly model?: string
  readonly effort?: string
  readonly mode: 'ask' | 'plan' | 'accept-edits' | 'approve-each' | 'auto'
}

export type BackgroundStartResponse =
  | { readonly ok: true; readonly run: PublicBackgroundRun }
  | { readonly ok: false; readonly message: string; readonly needsTrust?: true }

/** The words a card says for a run's state. */
export function backgroundStateWords(run: Pick<PublicBackgroundRun, 'state' | 'waitingFor' | 'broughtIn' | 'notBroughtIn'>): string {
  switch (run.state) {
    case 'working': return 'Working in the background'
    case 'blocked': return `Waiting for you${run.waitingFor === undefined ? '' : ` (${run.waitingFor})`}. Open it to answer.`
    case 'done': return run.broughtIn !== undefined ? 'Done. Its answer is in the conversation.' : run.notBroughtIn !== undefined ? `Done, but ${lowerFirst(run.notBroughtIn)}` : 'Done'
    case 'failed': return 'Ended with an error. Open it to see what happened.'
    case 'stopped': return run.broughtIn !== undefined ? 'Stopped. What it did is in the conversation.' : 'Stopped'
    case 'unknown': return 'Running in the background'
  }
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

/** Said where the choice is made: Locust watches a background run; it does not run it. */
export const BACKGROUND_TRADE =
  "Claude Code runs it, so it keeps going if you close Locust. Locust's approval cards and spend limits don't apply; Claude Code's own permission mode does, and when it needs a yes, you answer in Claude Code."
