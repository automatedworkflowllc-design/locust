import type { MissionApprovalRequest } from '../shared/ipc.js'

/**
 * Getting a person's attention when the window does not have it.
 *
 * An approval stops a run until it is answered. When the window is in front
 * the amber card is enough; when it is behind another app, or minimized, the
 * run sits waiting and nobody knows. So an approval that arrives while the
 * window is not focused becomes an OS notification, and clicking it brings
 * the window forward. Nothing else is notified: a notification for every
 * finished run would train a person to dismiss the one that matters.
 *
 * The decision is pure so it can be tested; the Electron calls are injected.
 */

export interface AttentionSurface {
  /** Whether the window currently has the person's attention. */
  readonly focused: () => boolean
  /** Whether the OS offers notifications at all. */
  readonly supported: () => boolean
  /** Show one; `onClick` runs when it is clicked. */
  readonly notify: (input: { readonly title: string; readonly body: string; readonly onClick: () => void }) => void
  /** Bring the window forward. */
  readonly focusWindow: () => void
}

export function shouldNotify(input: { readonly focused: boolean; readonly supported: boolean }): boolean {
  return input.supported && !input.focused
}

/** The words on the notification. Never the exact command: a toast is not a place for a secret. */
export function approvalNotificationText(
  request: Pick<MissionApprovalRequest, 'kind' | 'summary'>,
  teammateName: string | undefined
): { readonly title: string; readonly body: string } {
  const who = teammateName ?? 'A teammate'
  const title = request.kind === 'question' ? `${who} has a question` : `${who} needs your approval`
  return { title, body: `${request.summary} · the run is paused until you answer.` }
}

export function createAttention(surface: AttentionSurface): {
  approvalArrived(request: Pick<MissionApprovalRequest, 'kind' | 'summary'>, teammateName: string | undefined): boolean
} {
  return {
    approvalArrived(request, teammateName) {
      if (!shouldNotify({ focused: surface.focused(), supported: surface.supported() })) return false
      const text = approvalNotificationText(request, teammateName)
      surface.notify({ ...text, onClick: () => surface.focusWindow() })
      return true
    }
  }
}
