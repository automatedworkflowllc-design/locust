import { reverseChanges } from '../../shared/reverse-diff.js'
import type { Reversed } from '../../shared/reverse-diff.js'
import type { FileTurn } from './missionView.js'

/**
 * A FILE AS IT WAS AFTER AN EARLIER TURN (0.517), exactly or not at all.
 *
 * Sol, Workflow 2 (work that is not code): an older version of a document
 * opened as a code diff -- red and green lines -- where a person wanted to
 * read the document as it was. It is rebuilt from the file as it is now by
 * undoing each LATER turn's recorded change, newest first, with the same
 * exact-or-refuse rule that puts files back after an edited message
 * (shared/reverse-diff.ts). A later change that arrived cut short, a file
 * changed since, a rename: the version is not rebuilt, the reason is said,
 * and the change that turn made is shown instead. A wrong document that looks
 * right is the worst outcome, so refusing is always the cheap side.
 *
 * `index` is the turn's place in `turns` (oldest first); the result's `next`
 * is null when the file was not there after that turn.
 */
export function fileAsItWas(now: string, turns: readonly FileTurn[], index: number): Reversed {
  const later = turns.slice(index + 1)
  if (later.some((turn) => turn.truncated)) return { ok: false, why: 'a later change to it was recorded cut short' }
  return reverseChanges(now, later.map((turn) => turn.file))
}
