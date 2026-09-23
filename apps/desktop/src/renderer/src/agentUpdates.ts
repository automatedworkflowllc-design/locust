import type { RuntimeUpdateView } from '../../shared/ipc.js'

/**
 * What a runtime's row in Settings says about keeping it current -- one line,
 * and none at all when it is current: a row only speaks when its state is not
 * the ordinary one (main/runtime-updates.ts has the rules).
 */
export function updateLine(view: RuntimeUpdateView | undefined, now: Date = new Date()): string | undefined {
  if (view === undefined) return undefined
  const status = view.status
  switch (status.kind) {
    case 'current':
      return undefined
    case 'waiting':
      return status.why === 'in use'
        ? `${status.version} is out. It updates once nothing is using it.`
        : status.why === 'too new'
          ? `${status.version} is out. It updates once it has been out 12 hours.`
          : `${status.version} is out. Keeping it current is off.`
    case 'updating':
      return `Updating to ${status.version}…`
    case 'updated':
      return `Updated from ${status.from} to ${status.to} ${when(status.at, now)}.`
    case 'failed':
      return `Could not update to ${status.version} ${when(status.at, now)}: ${status.what}`
  }
}

/** "at 4:42 PM" today, "on Sep 22" before. */
function when(at: string, now: Date): string {
  const then = new Date(at)
  if (Number.isNaN(then.getTime())) return ''
  return then.toDateString() === now.toDateString()
    ? `at ${then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : `on ${then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/** The switch's own sentence. */
export function keepCurrentNote(enabled: boolean): string {
  return enabled
    ? 'On. Codex CLI and Copilot CLI are updated when a newer version is out and nothing is using them. Claude Code, OpenCode and Cursor Agent keep themselves current.'
    : 'Off. A newer Codex CLI or Copilot CLI is shown here, not installed.'
}
