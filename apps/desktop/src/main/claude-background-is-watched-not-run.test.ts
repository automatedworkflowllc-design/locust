import { describe, expect, it } from 'vitest'

import {
  backgroundArgs,
  backgroundIdFrom,
  backgroundIsLive,
  backgroundSentence,
  createBackgroundWatch,
  needsTrust,
  parseBackgroundAgents
} from './claude-background.js'
import type { BackgroundAgent } from './claude-background.js'

/**
 * CLAUDE WORK THAT KEEPS GOING WHEN LOCUST CLOSES (W10). Claude Code runs it; Locust starts it, watches it, and
 * never answers for the person. The shapes are `claude agents --json`'s, measured 2026-10-06 (keys only).
 */
describe('claude background sessions', () => {
  it('reads only background sessions from claude agents --json, and nothing from a malformed answer', () => {
    const json = JSON.stringify([
      { id: 'bg-1a2b3c', cwd: 'C:/work/pebble', kind: 'background', startedAt: '2026-10-06T10:00:00Z', sessionId: 's-1', name: 'fix the cart', state: 'working' },
      { pid: 4321, cwd: 'C:/work/pebble', kind: 'interactive', startedAt: '2026-10-06T09:00:00Z', sessionId: 's-2', name: 'mine', status: 'idle' },
      { id: 'bg-blocked', kind: 'background', state: 'blocked', waitingFor: { tool: 'Bash' } },
      { id: 'bg-new', kind: 'background', state: 'paused' },
      { kind: 'background', state: 'working' }
    ])
    expect(parseBackgroundAgents(json)).toEqual([
      { id: 'bg-1a2b3c', cwd: 'C:/work/pebble', startedAt: '2026-10-06T10:00:00Z', sessionId: 's-1', name: 'fix the cart', state: 'working' },
      { id: 'bg-blocked', state: 'blocked', waitingFor: 'Bash' },
      // A state this build has not met is said as unknown, never guessed.
      { id: 'bg-new', state: 'unknown' }
    ])
    // Not a list: no answer, never "none are running".
    expect(parseBackgroundAgents('')).toBeUndefined()
    expect(parseBackgroundAgents('{"id":"x"}')).toBeUndefined()
    // As measured: epoch milliseconds, and what a blocked one waits for.
    expect(parseBackgroundAgents(JSON.stringify([{ pid: 21492, id: 'ad39859a', kind: 'background', startedAt: 1791339613341, sessionId: 'ad39859a-5d0f', name: 'create hello.txt file', status: 'waiting', waitingFor: 'permission prompt', state: 'blocked' }]))).toEqual([
      { id: 'ad39859a', sessionId: 'ad39859a-5d0f', name: 'create hello.txt file', startedAt: new Date(1791339613341).toISOString(), state: 'blocked', waitingFor: 'permission prompt' }
    ])
    expect(backgroundIdFrom('Starting background service…\nbackgrounded · ad39859a\n  claude agents  list sessions')).toBe('ad39859a')
  })

  it('says a blocked session waits for the person, and that Locust does not answer for them', () => {
    expect(backgroundSentence({ state: 'blocked', waitingFor: 'Bash' })).toBe('Waiting for you: Bash. Open it to answer; Locust does not answer for you.')
    expect(backgroundIsLive('blocked')).toBe(true)
    expect(backgroundIsLive('done')).toBe(false)
  })

  it('starts claude --bg on the conversation, the mode said as Claude Code\'s, the message never taken for a flag', () => {
    expect(backgroundArgs({ prompt: '--help me', sandbox: 'workspace-write', model: 'haiku', resumeSessionId: 's-1' })).toEqual([
      '--bg', '--resume', 's-1', '--permission-mode', 'acceptEdits', '--model', 'haiku', '--', '--help me'
    ])
    expect(backgroundArgs({ prompt: 'Read it.', sandbox: 'read-only' })).toEqual(['--bg', '--permission-mode', 'plan', '--', 'Read it.'])
    expect(() => backgroundArgs({ prompt: '  ', sandbox: 'read-only' })).toThrow()
  })

  it('knows the folder must be trusted in Claude Code first', () => {
    expect(needsTrust('Workspace not trusted. Run `claude` in C:\\x once and accept the trust prompt, then retry.')).toBe(true)
    expect(needsTrust('bg-1a2b3c')).toBe(false)
  })

  it('polls only while one of its own is live, and says one Claude Code no longer lists is over', async () => {
    let listed: readonly BackgroundAgent[] = [{ id: 'a', state: 'working' }, { id: 'someone-else', state: 'working' }]
    const timers: (() => void)[] = []
    const changes: (readonly BackgroundAgent[])[] = []
    const watch = createBackgroundWatch({
      list: async () => listed,
      onChange: (agents) => changes.push(agents),
      setTimer: (run) => { timers.push(run); return timers.length },
      clearTimer: () => undefined
    })
    const step = async (): Promise<void> => {
      const run = timers.shift()
      run?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(timers.length).toBe(0)
    watch.watch(['a'])
    await step()
    expect(changes.at(-1)).toEqual([{ id: 'a', state: 'working' }])
    expect(timers.length).toBe(1)
    listed = [{ id: 'a', state: 'blocked', waitingFor: 'Bash' }]
    await step()
    expect(changes.at(-1)).toEqual([{ id: 'a', state: 'blocked', waitingFor: 'Bash' }])
    // Unchanged: no second notice.
    await step()
    expect(changes.length).toBe(2)
    listed = []
    await step()
    expect(changes.at(-1)).toEqual([{ id: 'a', state: 'stopped' }])
    // Nothing of its own is live: no timer is left.
    expect(timers.length).toBe(0)
    expect(watch.watching()).toEqual([])
  })

  it('keeps one poll loop when a second watch comes while a look is in flight (2026-10-10 sweep)', async () => {
    const timers: (() => void)[] = []
    let answer: (agents: { id: string; state: string }[]) => void = () => undefined
    const watch = createBackgroundWatch({
      list: () => new Promise((resolve) => { answer = resolve as never }),
      onChange: () => undefined,
      setTimer: (run) => { timers.push(run); return timers.length },
      clearTimer: () => undefined
    })
    watch.watch(['a'])
    timers.shift()?.()
    // The look is out; a second id arrives.
    watch.watch(['b'])
    expect(timers.length).toBe(0)
    answer([{ id: 'a', state: 'working' }, { id: 'b', state: 'working' }])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(timers.length).toBe(1)
  })
})
