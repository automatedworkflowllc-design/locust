import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/*
 * Colin, 2026-10-02, on a comparison that edits: "First you set this janky
 * shit to not allow auto, then i couldnt run it under normal folders because
 * they were too big ... maybe revisit the whole copy the whole folder thing".
 * 0.457 refused a folder too big to copy and sent him back to Ask. 0.555: a
 * git project still gives each column a worktree, a folder that fits a copy,
 * and one past that works in the folder itself, as its bar says -- never a
 * refusal.
 */
const APP_MAIN = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')

describe('a comparison that edits, in a folder too big to copy', () => {
  it('is never refused for its size: it works in the folder itself', () => {
    expect(APP_MAIN).not.toContain('Switch Compare to Ask and send it again.')
    expect(APP_MAIN).toContain("((await copyRefusal(workspacePath)) === undefined ? ('copy' as const) : ('folder' as const))")
    expect(APP_MAIN).toContain("} else if (compare.changes === true && compare.changesIn === 'folder') {\n        // Too big to copy (0.555): it works in the folder itself, as the bar says.\n        tree = workspacePath")
  })

  it('the menu never greys Auto out for it', () => {
    expect(APP_MAIN).toContain('ipcMain.handle(COMPARE_CHANGES_REFUSAL_CHANNEL, () => undefined)')
  })

  it('keeping one brings nothing in: its changes are already there', () => {
    expect(APP_MAIN).toContain("if (compare.changes === true && compare.kept === undefined && compare.changesIn !== 'folder') {\n          const result = await (compare.changesIn === 'copy'")
  })
})
