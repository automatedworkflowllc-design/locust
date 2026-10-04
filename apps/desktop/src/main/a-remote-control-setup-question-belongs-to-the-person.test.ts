// Colin: "Do NOT run claude remote-control for real and never answer Claude
// Code's trust prompt; it needs Colin's claude.ai sign-in, so the live check is his."
import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ spawn: vi.fn(), mac: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: fake.spawn }))
vi.mock('./mac-terminal.js', () => ({ openInMacTerminal: fake.mac }))
import { openRemoteControlSetup } from './claude-remote-control.js'
const launch = { commandName: 'claude', discoveredPath: 'C:\\fake\\claude.cmd', executablePath: 'C:\\fake folder\\node.exe', prefixArgs: ['C:\\fake folder\\claude.js'], kind: 'node-shim' as const, env: { ELECTRON_RUN_AS_NODE: '1' } }
let child: EventEmitter & { unref: ReturnType<typeof vi.fn> }
beforeEach(() => {
  fake.spawn.mockReset(); fake.mac.mockReset()
  child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  fake.spawn.mockReturnValue(child)
})
it('Windows opens a visible setup terminal in this folder with the discovered launch and no remote server or answer.', async () => {
  const opened = openRemoteControlSetup(launch, 'C:\\project', 'win32')
  expect(fake.spawn).toHaveBeenCalledExactlyOnceWith('cmd.exe', ['/d /k ""C:\\fake folder\\node.exe" "C:\\fake folder\\claude.js""'], expect.objectContaining({ cwd: 'C:\\project', detached: true, windowsHide: false, windowsVerbatimArguments: true, stdio: 'ignore', env: expect.objectContaining(launch.env) }))
  child.emit('spawn'); await opened; expect(child.unref).toHaveBeenCalledOnce()
})
it('A terminal spawn failure is returned verbatim instead of claiming a window opened.', async () => {
  const opened = openRemoteControlSetup(launch, 'C:\\project', 'win32')
  child.emit('error', new Error('setup ENOENT: exact'))
  await expect(opened).rejects.toThrow('setup ENOENT: exact'); expect(child.unref).not.toHaveBeenCalled()
})
it('macOS opens the same normal Claude setup command with its environment, not a server.', async () => {
  fake.mac.mockResolvedValue({ ok: true })
  await openRemoteControlSetup(launch, '/project', 'darwin')
  expect(fake.mac).toHaveBeenCalledExactlyOnceWith('/project', { file: launch.executablePath, args: launch.prefixArgs }, launch.env)
  expect(fake.spawn).not.toHaveBeenCalled()
})
it('macOS terminal failures are shown verbatim.', async () => {
  fake.mac.mockResolvedValue({ ok: false, message: 'exact mac error' })
  await expect(openRemoteControlSetup(launch, '/project', 'darwin')).rejects.toThrow('exact mac error')
})
it('An unsupported setup terminal gives manual guidance without starting a process.', async () => {
  await expect(openRemoteControlSetup(launch, '/project', 'linux')).rejects.toThrow('Open Claude Code in a terminal in this folder')
  expect(fake.spawn).not.toHaveBeenCalled()
})
