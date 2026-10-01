import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ATTACHMENT_DIR } from '../shared/attachments.js'
import { keepOutOfGit } from './attachments-for-run.js'

/**
 * A LONG CONVERSATION GOES TO ANOTHER MODEL BY FILE, NOT BY REFUSAL (0.513).
 *
 * Every hand-off brief has to fit `MAX_HANDOFF_PROMPT_LENGTH`. A task too long
 * for it was clipped beside a reply -- losing its end -- and refused outright
 * when there was no reply: handing over a stopped run, resuming one. That is
 * exactly when a person switches: the conversation that ran long is the one
 * that hit a limit. (QA-2026-09-29 round 2, R18; idea from a reading of
 * context-mode, PRODUCT-IDEAS-2026-10-01 item 1.)
 *
 * So a long task is written whole to `.locust/attachments/`, the one folder
 * Locust writes into a project, kept out of git through `.git/info/exclude`.
 * The brief quotes its start and names the file, and the file rides as an
 * attachment: `attachmentsForRun` copies it into an Own-branch worktree, and
 * the runtime reads it there like any other file it was handed.
 *
 * Returns the file's project-relative path, or undefined when the task fits
 * inline or the file could not be written -- the brief is then made as before.
 */
export const TASK_INLINE_LIMIT = 2_500

export async function longTaskFile(task: string, projectFolder: string, missionId: string): Promise<string | undefined> {
  if (task.length <= TASK_INLINE_LIMIT) return undefined
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(missionId)) return undefined
  const path = `${ATTACHMENT_DIR}/conversation-${missionId}.md`
  try {
    await mkdir(join(projectFolder, ATTACHMENT_DIR), { recursive: true })
    await writeFile(join(projectFolder, path), `${task}\n`, 'utf8')
    await keepOutOfGit(projectFolder)
    return path
  } catch {
    return undefined
  }
}
