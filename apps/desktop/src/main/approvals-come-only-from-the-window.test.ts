import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * A2.16: APPROVALS NEVER RIDE ON A TEAMMATE'S MESSAGE.
 *
 * CHECKED 2026-09-24: an approval -- a Codex action, a Claude Code connector
 * permission, an Antigravity question -- is answered in exactly one place,
 * the MISSION_APPROVAL_DECIDE handler, which takes only the app's own window
 * (`fromOwnWindow`): a person's click. A run the relay started raises its
 * cards like any other and nothing auto-answers them. Nothing a teammate
 * writes -- a share, a relayed brief, a returned answer -- reaches `decide`.
 *
 * This keeps it that way: every call of `.decide(` in the main process is in
 * the modules that hold approvals, or in that one handler. A new caller -- a
 * relay path, a block parser -- fails here and has to say why it may.
 */
const MAIN = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const HOLDERS = new Set(['approval-channel.ts', 'permission-host.ts', 'antigravity-mission.ts', 'codex-mission.ts'])

describe('who may answer an approval', () => {
  it('is only the approval holders and the window handler', () => {
    const callers = readdirSync(MAIN)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => /\.decide\(/.test(readFileSync(join(MAIN, name), 'utf8')))
    expect(callers.filter((name) => !HOLDERS.has(name) && name !== 'index.ts')).toEqual([])
    // In index.ts, the one handler and nothing else.
    const index = readFileSync(join(MAIN, 'index.ts'), 'utf8').split('\n')
    const decides = index.map((line, at) => ({ line, at })).filter(({ line }) => /\.decide\(/.test(line))
    expect(decides).toHaveLength(1)
    const handler = index.findIndex((line) => line.includes('ipcMain.handle(MISSION_APPROVAL_DECIDE_CHANNEL'))
    expect(handler).toBeGreaterThan(-1)
    expect(decides[0]!.at - handler).toBeLessThan(15)
    expect(index[handler + 1]).toContain('fromOwnWindow(event)')
  })
})

/*
 * M31: the window drops an approval card when its run ends. Pinned here,
 * beside the rule for who may answer one, because the card and the answer are
 * one contract: a card no run can take must not be offered.
 */
describe('an approval card in the window', () => {
  it('is dropped when its run ends: App applies approvalsOfLiveRuns on every change of runs', () => {
    const app = readFileSync(join(MAIN, '..', 'renderer', 'src', 'App.tsx'), 'utf8')
    expect(app).toMatch(/useEffect\(\(\) => \{\s*setApprovals\(\(current\) => approvalsOfLiveRuns\(current, runs\)\)\s*\}, \[runs\]\)/)
  })
})
