// Colin: "Build the Settings switch and its process handling with unit tests only
// (arguments; process ended when the switch goes off or Locust quits;
// first lines and errors shown verbatim). Do NOT run claude remote-control for real
// and never answer Claude Code's trust prompt."
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteControl, REMOTE_CONTROL_ARGS } from './claude-remote-control.js'

const launch = { commandName: 'claude', discoveredPath: 'C:\\fake\\claude.cmd', executablePath: 'C:\\fake\\node.exe', prefixArgs: ['C:\\fake\\claude.js'], kind: 'node-shim' as const, env: { ELECTRON_RUN_AS_NODE: '1' } }
const runtimes = [{ id: 'claude', executable: launch }] as never
function world(autoClose = true, extra: Partial<Parameters<typeof createRemoteControl>[0]> = {}) {
  const child = Object.assign(new EventEmitter(), { pid: 24680, stdout: new PassThrough(), stderr: new PassThrough(), stdin: { write: vi.fn() }, kill: vi.fn(() => true) })
  const spawn = vi.fn(() => child)
  const killTree = vi.fn(() => { if (autoClose) queueMicrotask(() => child.emit('close', null)) })
  const openSetup = vi.fn(async () => undefined)
  const discover = vi.fn(async () => runtimes)
  const service = createRemoteControl({ discover, folder: () => 'C:\\project', platform: 'win32', spawn: spawn as never, killTree, openSetup, ...extra })
  return { service, child, spawn, killTree, openSetup, discover }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
describe('The Remote Control server belongs to the Settings switch.', () => {
  it('Starts off and runs no discovery or command until enabled.', () => {
    const w = world()
    expect(w.service.snapshot()).toEqual({ enabled: false, phase: 'off', stdout: '', stderr: '', truncated: false })
    expect(w.spawn).not.toHaveBeenCalled(); expect(w.discover).not.toHaveBeenCalled()
  })
  it('Runs exactly server mode with worktree spawning and Locust name, in the host folder with its launch environment.', async () => {
    const w = world()
    await w.service.setEnabled(true)
    expect(w.spawn).toHaveBeenCalledWith(launch.executablePath, [...launch.prefixArgs, 'remote-control', '--spawn', 'worktree', '--name', 'Locust'], expect.objectContaining({ cwd: 'C:\\project', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: false, env: expect.objectContaining(launch.env) }))
    w.child.emit('spawn')
    expect(w.service.snapshot().phase).toBe('running')
    await w.service.dispose()
  })
  it('Enabling twice owns just one server and still receives its spawn event.', async () => {
    const w = world(); await w.service.setEnabled(true); await w.service.setEnabled(true)
    w.child.emit('spawn'); expect(w.spawn).toHaveBeenCalledTimes(1); expect(w.service.snapshot().phase).toBe('running')
    await w.service.dispose()
  })
  it('Switching off kills only the owned tree and waits until the process reports close.', async () => {
    const w = world(false); await w.service.setEnabled(true)
    let finished = false
    const off = w.service.setEnabled(false).then(() => { finished = true })
    await tick(); expect(finished).toBe(false)
    expect(w.killTree).toHaveBeenCalledWith(24680, 'win32'); expect(w.child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(w.service.snapshot().phase).toBe('stopping')
    w.child.emit('close', null); await off
    expect(w.service.snapshot()).toMatchObject({ enabled: false, phase: 'off' })
  })
  it('Quitting waits for the owned process to close and refuses any subsequent enable.', async () => {
    const w = world(false); await w.service.setEnabled(true)
    let done = false; const quitting = w.service.dispose().then(() => { done = true })
    await tick(); expect(done).toBe(false); expect(w.killTree).toHaveBeenCalledTimes(1)
    w.child.emit('close', null); await quitting; await w.service.setEnabled(true)
    expect(w.spawn).toHaveBeenCalledTimes(1); expect(w.service.snapshot().enabled).toBe(false)
  })
  it.each(['off', 'quit'])('A pending discovery cannot start a server after %s.', async (action) => {
    let discovered!: (value: never) => void
    const w = world(true, { discover: () => new Promise((resolve) => { discovered = resolve }) })
    const starting = w.service.setEnabled(true)
    if (action === 'off') await w.service.setEnabled(false); else await w.service.dispose()
    discovered(runtimes); await starting
    expect(w.spawn).not.toHaveBeenCalled(); expect(w.service.snapshot().enabled).toBe(false)
  })
  it('Discovery errors are shown verbatim, without starting a command.', async () => {
    const w = world(true, { discover: async () => { throw new Error('exact discovery error\r\n  next') } })
    expect(await w.service.setEnabled(true)).toMatchObject({ error: 'exact discovery error\r\n  next', enabled: false, phase: 'error' })
    expect(w.spawn).not.toHaveBeenCalled()
  })
  it('Missing Claude Code leaves the switch off with installation help.', async () => {
    const w = world(true, { discover: async () => [] })
    expect((await w.service.setEnabled(true)).error).toContain('not installed')
    expect(w.spawn).not.toHaveBeenCalled()
  })
  it('A spawn exception is preserved verbatim.', async () => {
    const w = world(true, { spawn: (() => { throw new Error('spawn EPERM: exact') }) as never })
    expect(await w.service.setEnabled(true)).toMatchObject({ error: 'spawn EPERM: exact', enabled: false })
  })
  it('An asynchronous spawn error and close remain an error.', async () => {
    const w = world(); await w.service.setEnabled(true)
    w.child.emit('error', new Error('spawn ENOENT: exact')); w.child.emit('close', -2)
    expect(w.service.snapshot()).toMatchObject({ error: 'spawn ENOENT: exact', phase: 'error', enabled: false })
  })
  it('First lines, whitespace, ANSI bytes and a split Unicode character survive unchanged.', async () => {
    const w = world(); await w.service.setEnabled(true)
    const line = '  first\r\nhttps://claude.ai/code/session_fake\r\n\u001b[31m🐛\u001b[0m\n'
    const bytes = Buffer.from(line); const split = bytes.indexOf(Buffer.from('🐛')) + 1
    w.child.stdout.write(bytes.subarray(0, split)); w.child.stdout.write(bytes.subarray(split))
    w.child.stderr.write('  exact error\r\n')
    expect(w.service.snapshot()).toMatchObject({ stdout: line, stderr: '  exact error\r\n' })
    await w.service.dispose()
  })
  it('A failed server preserves stderr and exit code without translating the account error or retrying.', async () => {
    const w = world(); await w.service.setEnabled(true)
    w.child.stderr.write('Remote Control requires a claude.ai subscription\r\n'); w.child.emit('close', 1)
    expect(w.service.snapshot()).toMatchObject({ stderr: 'Remote Control requires a claude.ai subscription\r\n', exitCode: 1, phase: 'error', enabled: false })
    expect(w.spawn).toHaveBeenCalledTimes(1)
  })
  it('A server that exits successfully turns the switch off without a retry.', async () => {
    const w = world(); await w.service.setEnabled(true); w.child.emit('close', 0)
    expect(w.service.snapshot()).toMatchObject({ phase: 'ended', enabled: false, exitCode: 0 }); expect(w.spawn).toHaveBeenCalledTimes(1)
  })
  it.each(['Trust C:\\project? [y/N]', 'Trust C:\\project? \u001b[31m[y/N]\u001b[0m', 'Workspace not trusted', 'Enable Remote Control? (y/n)'])('Stops for %s without writing an answer, and opens setup only after close.', async (line) => {
    const w = world(false); await w.service.setEnabled(true)
    w.child.stdout.write(line.slice(0, 9)); w.child.stdout.write(line.slice(9))
    await tick(); expect(w.killTree).toHaveBeenCalledTimes(1); expect(w.openSetup).not.toHaveBeenCalled(); expect(w.child.stdin.write).not.toHaveBeenCalled()
    w.child.emit('close', null); await tick()
    expect(w.service.snapshot()).toMatchObject({ phase: 'needs-person', enabled: false, stdout: line })
    expect(w.openSetup).toHaveBeenCalledExactlyOnceWith(launch, 'C:\\project', 'win32')
  })
  it.each(['off', 'quit'])('Does not open a setup window if %s happens while ending for trust.', async (action) => {
    const w = world(false); await w.service.setEnabled(true); w.child.stderr.write('Workspace not trusted')
    const ending = action === 'off' ? w.service.setEnabled(false) : w.service.dispose()
    w.child.emit('close', null); await ending; await tick()
    expect(w.openSetup).not.toHaveBeenCalled()
  })
  it('A setup-window failure is preserved verbatim and leaves the server off.', async () => {
    const w = world(true, { openSetup: async () => { throw new Error('terminal failed: exact') } })
    await w.service.setEnabled(true); w.child.stderr.write('Workspace not trusted'); await tick()
    expect(w.service.snapshot()).toMatchObject({ enabled: false, error: 'terminal failed: exact', phase: 'error' })
  })
  it('Retains bounded first output independently for both streams and still detects a later trust error.', async () => {
    const w = world(); await w.service.setEnabled(true)
    w.child.stdout.write('x'.repeat(70_000)); w.child.stderr.write('y'.repeat(70_000))
    expect(w.service.snapshot()).toMatchObject({ stdout: 'x'.repeat(65536), stderr: 'y'.repeat(65536), truncated: true })
    w.child.stderr.write('Workspace not trusted'); await tick()
    expect(w.openSetup).toHaveBeenCalledTimes(1)
  })
  it('A termination timeout is an error and does not pretend the process ended or start another one.', async () => {
    const w = world(false, { stopDeadlineMs: 5 }); await w.service.setEnabled(true)
    expect(await w.service.setEnabled(false)).toMatchObject({ phase: 'error', enabled: false, error: 'Claude Code did not report that its Remote Control process ended.' })
    await w.service.setEnabled(true); expect(w.spawn).toHaveBeenCalledTimes(1)
    w.child.emit('close', null)
  })
  it('A cmd shim uses the existing launcher quoting instead of enabling a shell.', async () => {
    const cmd = { ...launch, executablePath: 'C:\\Windows\\System32\\cmd.exe', prefixArgs: ['/d', '/s', '/c', 'C:\\a b\\claude.cmd'], env: undefined }
    const w = world(true, { discover: async () => [{ id: 'claude', executable: cmd }] as never })
    await w.service.setEnabled(true)
    const [, args, options] = w.spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
    expect(args).toHaveLength(1); expect(args[0]).toContain('remote-control'); expect(options).toMatchObject({ windowsVerbatimArguments: true, shell: false })
    expect(REMOTE_CONTROL_ARGS).not.toContain('-p'); await w.service.dispose()
  })
  it('Off Windows the owned server has its own process group for ending the tree.', async () => {
    const w = world(true, { platform: 'darwin' }); await w.service.setEnabled(true)
    expect(w.spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ detached: true }))
    await w.service.dispose(); expect(w.killTree).toHaveBeenCalledWith(24680, 'darwin')
  })
  it('An older off request cannot overwrite a newer startup.', async () => {
    const w = world()
    const off = w.service.setEnabled(false)
    const on = w.service.setEnabled(true)
    await Promise.all([off, on]); w.child.emit('spawn')
    expect(w.service.snapshot()).toMatchObject({ enabled: true, phase: 'running' })
    await w.service.dispose()
  })
  it('Repeated trust output opens setup only once.', async () => {
    const w = world(); await w.service.setEnabled(true)
    w.child.stdout.write('Workspace not trusted'); w.child.stderr.write('Workspace not trusted'); await tick()
    expect(w.openSetup).toHaveBeenCalledTimes(1); expect(w.child.stdin.write).not.toHaveBeenCalled()
  })
})
