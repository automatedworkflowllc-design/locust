import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { stoppedBecause } from '../../resources/locust-command-guard.mjs'
import { codexCommandGuardConfig, commandGuardSettings, otherCodexHooks } from './command-guard.js'

/*
 * NO TEAMMATE ENDS YOUR BROWSER, CODEX TOO (0.720). Since 0.717 Claude Code
 * asks Locust's command guard before every command; Codex had no such guard.
 * MEASURED 2026-10-10 on Codex 0.162.1 with gpt-6-luna over app-server: a
 * PreToolUse hook in `thread/start`'s config, with `bypass_hook_trust`, is
 * handed Claude Code's own event and its deny stops the command; on Windows
 * Codex runs it under `powershell.exe -NoProfile -Command`. Nothing is written
 * to the person's config.toml.
 */
const GUARD = fileURLToPath(new URL('../../resources/locust-command-guard.mjs', import.meta.url))
const LOCUST = 'C:\\Users\\Jane O\'Neil\\AppData\\Local\\Programs\\Locust\\Locust.exe'
const SCRIPT = 'C:\\Users\\Jane O\'Neil\\AppData\\Local\\Programs\\Locust\\resources\\locust-command-guard.mjs'

/** The event Codex handed the hook in the measurement, with this command in it. */
const codexEvent = (command: string): string =>
  JSON.stringify({ session_id: 's', turn_id: 't', transcript_path: null, cwd: 'C:\\work\\pebble', hook_event_name: 'PreToolUse', model: 'gpt-6-luna', permission_mode: 'bypassPermissions', tool_name: 'Bash', tool_input: { command }, tool_use_id: 'exec-1' })

describe('the config every Codex thread is given', () => {
  it('names the guard on Windows the way Codex runs a hook there: in PowerShell, on Locust’s own binary run as node', () => {
    expect(codexCommandGuardConfig({ node: LOCUST, guardPath: SCRIPT, parent: 4242, platform: 'win32' })).toEqual({
      bypass_hook_trust: true,
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command:
                  "$env:ELECTRON_RUN_AS_NODE='1'; $env:LOCUST_GUARD_PARENT='4242'; & 'C:/Users/Jane O''Neil/AppData/Local/Programs/Locust/Locust.exe' 'C:/Users/Jane O''Neil/AppData/Local/Programs/Locust/resources/locust-command-guard.mjs'",
                timeout: 15
              }
            ]
          }
        ]
      }
    })
  })

  it('names it elsewhere exactly as Claude Code’s is named', () => {
    const codex = codexCommandGuardConfig({ node: '/Applications/Locust.app/Contents/MacOS/Locust', guardPath: '/Applications/Locust.app/Contents/Resources/locust-command-guard.mjs', parent: 77, platform: 'darwin' })
    const claude = JSON.parse(commandGuardSettings({ node: '/Applications/Locust.app/Contents/MacOS/Locust', guardPath: '/Applications/Locust.app/Contents/Resources/locust-command-guard.mjs', parent: 77 })) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> }
    }
    expect((codex.hooks.PreToolUse[0] as { hooks: Array<{ command: string }> }).hooks[0]!.command).toBe(claude.hooks.PreToolUse[0]!.hooks[0]!.command)
  })

  it.runIf(process.platform === 'win32')('refuses, through PowerShell as Codex runs it, what the guard refuses, and lets the rest through', async () => {
    const { hooks } = codexCommandGuardConfig({ node: process.execPath, guardPath: GUARD, parent: process.pid, platform: 'win32' })
    const command = (hooks.PreToolUse[0] as { hooks: Array<{ command: string }> }).hooks[0]!.command
    const run = async (input: string): Promise<string> => {
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
      let out = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => (out += chunk))
      child.stdin.end(input)
      await new Promise((resolve) => child.on('close', resolve))
      return out.trim()
    }
    const [refused, allowed] = await Promise.all([run(codexEvent('taskkill /F /IM msedge.exe')), run(codexEvent('npm test'))])
    expect(JSON.parse(refused)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: stoppedBecause('taskkill /F /IM msedge.exe', () => undefined) }
    })
    expect(allowed).toBe('')
  }, 30_000)
})

describe('the line a drive can ask the guard for', () => {
  it('is written only when LOCUST_GUARD_LOG names a file, one per question, with what was decided', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'locust-guard-log-'))
    const log = join(folder, 'asked.jsonl')
    const ask = async (command: string, env: NodeJS.ProcessEnv): Promise<void> => {
      const child = spawn(process.execPath, [GUARD], { stdio: ['pipe', 'ignore', 'ignore'], env })
      child.stdin.end(codexEvent(command))
      await new Promise((resolve) => child.on('close', resolve))
    }
    await ask('npm test', { ...process.env, LOCUST_GUARD_LOG: '' })
    await expect(readFile(log, 'utf8')).rejects.toThrow()
    await ask('npm test', { ...process.env, LOCUST_GUARD_LOG: log })
    await ask('taskkill /F /IM msedge.exe', { ...process.env, LOCUST_GUARD_LOG: log })
    expect((await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as unknown)).toEqual([
      { tool: 'Bash', command: 'npm test', refused: false },
      { tool: 'Bash', command: 'taskkill /F /IM msedge.exe', refused: true }
    ])
  }, 30_000)
})

describe('a Codex run goes without the guard when Codex would load some other hook', () => {
  const home = async (): Promise<{ codexHome: string; folder: string }> => {
    const root = await mkdtemp(join(tmpdir(), 'locust-codex-hooks-'))
    const codexHome = join(root, '.codex')
    const folder = join(root, 'work', 'pebble')
    await mkdir(codexHome, { recursive: true })
    await mkdir(folder, { recursive: true })
    return { codexHome, folder }
  }
  const put = async (path: string, text: string): Promise<void> => {
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, text, 'utf8')
  }

  it('finds none where there are none, and none in what Codex ships itself or never installed', async () => {
    const at = await home()
    await put(join(at.codexHome, 'config.toml'), 'model = "gpt-6-sol"\nnotify = ["hooks-are-not-this"]\n[plugins."browser@openai-bundled"]\nenabled = true\n')
    // Codex's own browser plugin brings a hook, and is on by default.
    await put(join(at.codexHome, 'plugins', 'cache', 'openai-bundled', 'browser', '1.0', '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'browser', hooks: { Interrupt: [{ hooks: [{ type: 'mcp_tool' }] }] } }))
    // A marketplace's copy and a half-finished install are not installed plugins.
    await put(join(at.codexHome, 'plugins', '.remote-plugin-install-staging', 'bundle', '.codex-plugin', 'plugin.json'), JSON.stringify({ hooks: { PreToolUse: [] } }))
    await put(join(at.codexHome, '.tmp', 'marketplaces', 'x', 'plugins', 'y', 'hooks', 'hooks.json'), '{}')
    // An installed plugin with no hooks.
    await put(join(at.codexHome, 'plugins', 'cache', 'claude-plugins-official', 'code-review', '1.0', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'code-review' }))
    expect(await otherCodexHooks(at)).toEqual([])
  })

  it('finds the person’s own, a plugin’s, and a project’s, in the folder or above it', async () => {
    for (const [what, place] of [
      ['config', (at: { codexHome: string }) => put(join(at.codexHome, 'config.toml'), 'model = "x"\n[hooks]\nPreToolUse = []\n')],
      ['config, dotted', (at: { codexHome: string }) => put(join(at.codexHome, 'config.toml'), 'hooks.windows_managed_dir = "C:/managed"\n')],
      ['hooks.json', (at: { codexHome: string }) => put(join(at.codexHome, 'hooks.json'), '{}')],
      ['a plugin’s hooks.json', (at: { codexHome: string }) => put(join(at.codexHome, 'plugins', 'cache', 'someone', 'helper', '1.0', 'hooks', 'hooks.json'), '{}')],
      ['a plugin that declares hooks', (at: { codexHome: string }) => put(join(at.codexHome, 'plugins', 'cache', 'someone', 'helper', '1.0', '.claude-plugin', 'plugin.json'), JSON.stringify({ hooks: './hooks.json' }))],
      ['the project’s', (at: { folder: string }) => put(join(at.folder, '.codex', 'hooks.json'), '{}')],
      ['a project above it', (at: { folder: string }) => put(join(at.folder, '..', '.codex', 'config.toml'), '[hooks]\n')]
    ] as const) {
      const at = await home()
      await place(at)
      expect((await otherCodexHooks(at)).length, what).toBe(1)
    }
  })
})
