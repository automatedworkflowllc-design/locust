import { describe, expect, it } from 'vitest'

import { cursorCannotSee, cursorIgnoreNotice, cursorIgnorePaths } from './cursor-visibility.js'

describe('telling a Cursor run it cannot see its own folder', () => {
  const RULES = ['# transcripts', '.claude/', 'AppData/'].join('\n')

  it('names the rule, so the person can go and change it', async () => {
    const said = await cursorCannotSee('C:/Users/<home>/.claude', async (path) =>
      path.includes('.claude') && path.endsWith('.cursorignore') && path.startsWith('C:/Users/<home>/.cursorignore') ? RULES : undefined
    )
    // The workspace file is tried first and is absent here, so it falls
    // through to the home one -- which is where every real rule has been.
    expect(said).toBeUndefined()
  })

  it('reads the home file when the workspace has none', async () => {
    const said = await cursorCannotSee('C:/Users/<home>/.claude', async (path) =>
      path === cursorIgnorePaths('C:/Users/<home>/.claude')[1] ? RULES : undefined
    )
    expect(said).toContain('.cursorignore')
    expect(said).toContain('".claude/"')
  })

  it('prefers the workspace file, which is nearer to the work', async () => {
    const said = await cursorCannotSee('C:/w/app', async (path) =>
      path === cursorIgnorePaths('C:/w/app')[0] ? 'app/\n' : undefined
    )
    expect(said).toContain('"app/"')
  })

  it('says nothing when nothing hides the folder', async () => {
    expect(await cursorCannotSee('C:/w/app', async () => RULES)).toBeUndefined()
  })

  it('says nothing when there is no rule file at all', async () => {
    expect(await cursorCannotSee('C:/w/app', async () => undefined)).toBeUndefined()
  })

  it('raises it as a runtime_error, or the thread would drop it', () => {
    /*
     * NOT cosmetic. The thread drops any diagnostic raised before the first
     * tool call unless its code ends in `runtime_error` or `notification`
     * (missionView.ts, the gate that exists to keep Codex's setup chatter out
     * of a fresh thread). This notice is raised before ANYTHING, which is the
     * only moment it is worth having, so it must be in the family that gets
     * through -- exactly the trap that once swallowed "Reconnecting... 2/5"
     * and left a working run looking dead.
     */
    const event = cursorIgnoreNotice({
      runId: 'run_1',
      missionId: 'mission_1',
      sourceAdapter: 'cursor',
      nextSequence: 1,
      at: '2026-09-12T00:00:00.000Z',
      sentence: 'Cursor cannot read files here.'
    })
    expect(event.payload).toMatchObject({ code: 'host.cursorignore.runtime_error', level: 'warning', terminal: false })
    expect(/\.(runtime_error|notification)$/.test((event.payload as { code: string }).code)).toBe(true)
  })
})
