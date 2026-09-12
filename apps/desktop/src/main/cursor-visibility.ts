import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { cursorIgnoreHit, cursorIgnoreSentence } from '../shared/cursorIgnore.js'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

/**
 * Say when Cursor has been told not to look at the folder it was just given.
 *
 * Cursor's file tools refuse an ignored path with "permission denied" and no
 * reason, so the model explains its own failure by inventing one -- and the
 * invention is what reaches the person. MEASURED 2026-09-12, a teammate handed
 * a screenshot Locust had written into its own workspace: "this worker cannot
 * open them -- Read returns permission denied even after copying to temp",
 * followed by a confident paragraph about a cause that did not exist. Two
 * earlier incidents cost an afternoon each the same way (`cursorIgnore.ts`).
 *
 * The host knows before the run starts, and the rule is written down in a file
 * it can read. So it says so, once, at the top of the thread.
 *
 * Cursor only: it is the only runtime that reads `.cursorignore`, and the same
 * notice elsewhere would be a claim about nothing.
 */

/** Where the rules can live, nearest first. */
export function cursorIgnorePaths(cwd: string): readonly string[] {
  return [join(cwd, '.cursorignore'), join(homedir(), '.cursorignore')]
}

export async function cursorCannotSee(
  cwd: string,
  read: (path: string) => Promise<string | undefined> = async (path) => {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return undefined
    }
  }
): Promise<string | undefined> {
  for (const path of cursorIgnorePaths(cwd)) {
    const text = await read(path)
    if (text === undefined) continue
    const hit = cursorIgnoreHit(cwd, text)
    if (hit !== undefined) return cursorIgnoreSentence(hit, path)
  }
  return undefined
}

export function cursorIgnoreNotice(input: {
  readonly runId: string
  readonly missionId: string
  readonly sourceAdapter: NormalizedRuntimeEvent['sourceAdapter']
  readonly nextSequence: number
  readonly at: string
  readonly sentence: string
}): NormalizedRuntimeEvent {
  return {
    runId: input.runId,
    missionId: input.missionId,
    occurredAt: input.at,
    sourceAdapter: input.sourceAdapter,
    id: `${input.runId}:host:cursorignore:${String(input.nextSequence)}`,
    sequence: input.nextSequence,
    type: 'adapter.diagnostic',
    payload: {
      /*
       * A warning, not an error: the run is about to happen and may well do
       * useful work -- it simply cannot read this folder's files, and every
       * failure it reports about them will name the wrong cause.
       *
       * `runtime_error` is deliberate and load-bearing. The thread drops any
       * diagnostic raised before the first tool call UNLESS its code ends in
       * `runtime_error` or `notification` (missionView.ts) -- and this one is
       * raised before anything at all, which is the only time it is useful.
       */
      level: 'warning',
      code: 'host.cursorignore.runtime_error',
      message: input.sentence,
      terminal: false,
      evidence: { redacted: true as const }
    }
  } as NormalizedRuntimeEvent
}
