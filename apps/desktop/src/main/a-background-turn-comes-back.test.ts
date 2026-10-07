import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBackgroundRuns } from './claude-background-runs.js'
import type { BackgroundAgent } from './claude-background.js'
import type { BackgroundRun } from './claude-background-runs.js'

/**
 * A BACKGROUND TURN COMES BACK (W10). Started with `claude --bg`, remembered in its own file, watched while it
 * lives, and brought into the conversation when it ends -- even when it ended while Locust was closed.
 */
const made: string[] = []
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function file(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'locust-bg-'))
  made.push(dir)
  return join(dir, 'claude-background.json')
}

/** A stand-in for Claude Code: `--bg` prints what it prints, and `agents --json` lists what the test says. */
function fakeClaude(state: { agents: unknown[]; startSays?: string; calls: string[][] }) {
  return async (args: readonly string[]) => {
    state.calls.push([...args])
    if (args[0] === '--bg') return { code: 0, stdout: state.startSays ?? 'Starting background service…\nbackgrounded · ad39859a\n', stderr: '' }
    if (args[0] === 'agents') return { code: 0, stdout: JSON.stringify(state.agents), stderr: '' }
    if (args[0] === 'stop') return { code: 0, stdout: `stopped ${args[1] ?? ''}`, stderr: '' }
    return { code: 1, stdout: '', stderr: 'unexpected' }
  }
}
/** A watch the test steps by hand. */
function manualWatch() {
  const held: { onAgents?: (agents: readonly BackgroundAgent[]) => void; list?: () => Promise<readonly BackgroundAgent[]>; ids: string[] } = { ids: [] }
  return {
    held,
    make: (onAgents: (agents: readonly BackgroundAgent[]) => void, list: () => Promise<readonly BackgroundAgent[]>) => {
      held.onAgents = onAgents
      held.list = list
      return { watch: (ids: readonly string[]) => void held.ids.push(...ids), stop: () => undefined }
    },
    tick: async () => {
      held.onAgents?.(await held.list!())
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
}

describe('a background turn comes back', () => {
  it('starts on the conversation\'s own session, is remembered, and comes back into it when it is done', async () => {
    const path = await file()
    const state = { agents: [] as unknown[], calls: [] as string[][] }
    const watch = manualWatch()
    const brought: BackgroundRun[] = []
    const runs = createBackgroundRuns({
      file: path,
      claude: fakeClaude(state),
      sessionOf: async (conversation) => (conversation === 'mission_a' ? 'ad39859a-5d0f-4439-8dc5-2f147a5b4cf6' : undefined),
      bringIn: async (run) => { brought.push(run); return { missionId: 'mission_back' } },
      onChange: () => undefined,
      watch: watch.make,
      now: () => new Date('2026-10-06T22:00:00Z')
    })
    const started = await runs.start({ prompt: 'Fix the cart total.', folder: 'C:/work/pebble', sandbox: 'workspace-write', conversation: 'mission_a', model: 'haiku' })
    expect(started).toMatchObject({ ok: true, run: { id: 'ad39859a', state: 'working', conversation: 'mission_a', sessionId: 'ad39859a-5d0f-4439-8dc5-2f147a5b4cf6' } })
    expect(state.calls[0]).toEqual(['--bg', '--resume', 'ad39859a-5d0f-4439-8dc5-2f147a5b4cf6', '--permission-mode', 'acceptEdits', '--model', 'haiku', '--', 'Fix the cart total.'])
    expect(watch.held.ids).toEqual(['ad39859a'])
    // Waiting for the person: said, and nothing brought in.
    state.agents = [{ id: 'ad39859a', kind: 'background', state: 'blocked', waitingFor: 'permission prompt', sessionId: 'ad39859a-5d0f-4439-8dc5-2f147a5b4cf6' }]
    await watch.tick()
    await vi.waitFor(async () => expect((await runs.list())[0]).toMatchObject({ state: 'blocked', waitingFor: 'permission prompt' }), { timeout: 5_000 })
    expect(brought).toEqual([])
    state.agents = [{ id: 'ad39859a', kind: 'background', state: 'done', sessionId: 'ad39859a-5d0f-4439-8dc5-2f147a5b4cf6' }]
    await watch.tick()
    // Waited for, not timed: bringing it in and saving run on their own clock.
    await vi.waitFor(() => expect(brought.map((run) => run.id)).toEqual(['ad39859a']), { timeout: 5_000 })
    await vi.waitFor(async () => expect((JSON.parse(await readFile(path, 'utf8')) as BackgroundRun[])[0]?.broughtIn).toBe('mission_back'), { timeout: 5_000 })
    const kept = JSON.parse(await readFile(path, 'utf8')) as BackgroundRun[]
    expect(kept[0]).toMatchObject({ state: 'done', broughtIn: 'mission_back' })
    expect(kept[0]?.waitingFor).toBeUndefined()
    expect([...(await runs.broughtInIds())]).toEqual(['mission_back'])
  })

  it('one that ended while Locust was closed is brought back the next time it opens', async () => {
    const path = await file()
    const state = { agents: [] as unknown[], calls: [] as string[][] }
    const first = createBackgroundRuns({ file: path, claude: fakeClaude(state), sessionOf: async () => undefined, bringIn: async () => ({ missionId: 'x' }), onChange: () => undefined, watch: manualWatch().make })
    await first.start({ prompt: 'Write the docs.', folder: 'C:/work/pebble', sandbox: 'workspace-write' })
    // Locust quits; Claude Code finishes; Locust opens again.
    const watch = manualWatch()
    const brought: string[] = []
    const again = createBackgroundRuns({ file: path, claude: fakeClaude(state), sessionOf: async () => undefined, bringIn: async (run) => { brought.push(run.id); return { missionId: 'mission_new' } }, onChange: () => undefined, watch: watch.make })
    await again.resume()
    expect(watch.held.ids).toEqual(['ad39859a'])
    state.agents = [{ id: 'ad39859a', kind: 'background', state: 'done', sessionId: 'ad39859a-1111' }]
    await watch.tick()
    await vi.waitFor(() => expect(brought).toEqual(['ad39859a']), { timeout: 5_000 })
    await vi.waitFor(async () => expect((await again.list())[0]).toMatchObject({ broughtIn: 'mission_new', sessionId: 'ad39859a-1111' }), { timeout: 5_000 })
  })

  it('an untrusted folder is said as such, and nothing is kept', async () => {
    const path = await file()
    const state = { agents: [] as unknown[], calls: [] as string[][], startSays: 'Workspace not trusted. Run `claude` in C:\\work\\pebble once and accept the trust prompt, then retry.' }
    const runs = createBackgroundRuns({ file: path, claude: fakeClaude(state), sessionOf: async () => undefined, bringIn: async () => ({ missionId: 'x' }), onChange: () => undefined, watch: manualWatch().make })
    const started = await runs.start({ prompt: 'Go.', folder: 'C:/work/pebble', sandbox: 'read-only' })
    expect(started).toMatchObject({ ok: false, needsTrust: true })
    expect(await runs.list()).toEqual([])
  })

  it('stops only an id of its own, and a finished run leaves the list while its turn stays', async () => {
    const path = await file()
    const state = { agents: [] as unknown[], calls: [] as string[][] }
    const watch = manualWatch()
    const runs = createBackgroundRuns({ file: path, claude: fakeClaude(state), sessionOf: async () => undefined, bringIn: async () => ({ missionId: 'mission_back' }), onChange: () => undefined, watch: watch.make })
    await runs.start({ prompt: 'Go.', folder: 'C:/work/pebble', sandbox: 'read-only' })
    expect(await runs.stop('--all')).toBe(false)
    expect(await runs.stop('ad39859a')).toBe(true)
    expect(state.calls.at(-1)).toEqual(['stop', 'ad39859a'])
    // Still live: not dismissed.
    await runs.dismiss('ad39859a')
    expect((await runs.list()).length).toBe(1)
    state.agents = [{ id: 'ad39859a', kind: 'background', state: 'stopped' }]
    await watch.tick()
    await vi.waitFor(async () => expect((await runs.list())[0]?.state).toBe('stopped'), { timeout: 5_000 })
    await runs.dismiss('ad39859a')
    expect(await runs.list()).toEqual([])
  })
})
