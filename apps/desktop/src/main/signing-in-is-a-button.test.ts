import { signInCommand, signInOpenedLine } from '../shared/runtime-install.js'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { consoleCommandLine, openSignIn, signInArgs } from './runtime-sign-in.js'

/**
 * SIGNING IN IS A BUTTON.
 *
 * Colin, 2026-09-22, signed in to Meta in the browser and still reading SIGN
 * IN on Muse: "idk where to even login ... the user would have to go through
 * all this drama no?". The sign-in itself cannot go -- a CLI does not share a
 * browser's session -- but finding a terminal and knowing what to type can.
 */
describe('signing in is a button', () => {
  it('runs the words the install facts name, and nothing for OpenCode', () => {
    expect(signInArgs('muse')).toEqual(['login'])
    expect(signInArgs('cursor')).toEqual(['login'])
    // Claude Code and Codex sign in from their own first screen.
    expect(signInArgs('claude')).toEqual([])
    expect(signInArgs('codex')).toEqual([])
    // The one runtime with no account has no sign-in to open.
    expect(signInArgs('opencode')).toBeUndefined()
    expect(signInArgs('not-a-runtime')).toBeUndefined()
  })

  it('signs in again with each CLI’s own command, read from its --help (Colin, 2026-10-02: change accounts)', () => {
    expect(signInArgs('claude', true)).toEqual(['auth', 'login'])
    expect(signInArgs('codex', true)).toEqual(['login'])
    expect(signInArgs('cursor', true)).toEqual(['login'])
    expect(signInArgs('muse', true)).toEqual(['login'])
    // Copilot's is its own /login, inside the window.
    expect(signInArgs('copilot', true)).toEqual([])
    // Antigravity's too (0.553): `agy` opens its sign-in; /logout and /login inside it.
    expect(signInArgs('antigravity', true)).toEqual([])
    expect(signInCommand('antigravity', true)).toBe('run agy, then type /logout, then /login, and choose the account')
    // And once its window is open, the row says the steps, not only the tooltip (0.656):
    // `agy` opens signed in as it was, so "finish in the window" left Colin looking at a signed-in CLI.
    expect(signInOpenedLine('antigravity', true)).toBe('In the window that opened, type /logout, then /login, and choose the account.')
    expect(signInOpenedLine('antigravity')).toBe('Finish in the window that opened.')
    expect(signInOpenedLine('codex', true)).toBe('Finish in the window that opened.')
    // No account at all: nothing, rather than a guess.
    expect(signInArgs('opencode', true)).toBeUndefined()
  })

  it('refuses a runtime discovery did not find, rather than guessing a path', async () => {
    const answer = await openSignIn('muse', { discover: async () => [], closed: () => {}, platform: 'win32' })
    expect(answer.ok).toBe(false)
  })

  it.runIf(process.platform === 'win32')('survives a path with a space in it, run through cmd.exe for real', () => {
    /*
     * The quoting is the part that goes wrong silently: Node's own argument
     * quoting does not make the shape cmd's `/k` wants, and a path under
     * "Program Files" is ordinary. So this runs the SAME line through the
     * real cmd.exe -- with `/c` swapped in for `/k`, so no window is left
     * open -- against a stand-in CLI in a folder with a space, and reads
     * back what it was given.
     */
    const folder = mkdtempSync(join(tmpdir(), 'locust sign in '))
    const cli = join(folder, 'fake cli.cmd')
    writeFileSync(cli, '@echo ran with %*\r\n')
    const line = consoleCommandLine(cli, ['login']).replace('/k', '/c')
    const result = spawnSync('cmd.exe', [line], { windowsVerbatimArguments: true, encoding: 'utf8' })
    expect(result.stdout.trim()).toBe('ran with login')
  })
})
