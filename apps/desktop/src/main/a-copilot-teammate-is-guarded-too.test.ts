import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCopilotAcpCommand, createCopilotPromptCommand, RUNTIME_ENVIRONMENT_ALLOWLIST } from '@teammate/runtime-adapters'
import type { ExecutableLaunch } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { stoppedBecause } from '../../resources/locust-command-guard.mjs'
import { codexCommandGuardConfig, commandGuardSettings, copilotCommandGuardHooks, writeCopilotCommandGuard } from './command-guard.js'

/*
 * NO TEAMMATE ENDS YOUR BROWSER, COPILOT TOO (0.721). MEASURED 2026-10-10 on
 * Copilot CLI 1.0.95 (Auto, gpt-6-luna): a Claude-format plugin from
 * `--plugin-dir` is handed Claude Code's PreToolUse event, run under
 * `powershell.exe -nop -nol -c` on Windows, and its deny stops the command,
 * in `-p` and over `--acp`. And a hook that FAILS denies the command too, so
 * Locust's can never fail.
 */
const GUARD = fileURLToPath(new URL('../../resources/locust-command-guard.mjs', import.meta.url))
const LOCUST = 'C:\\Users\\Jane O\'Neil\\AppData\\Local\\Programs\\Locust\\Locust.exe'
const SCRIPT = 'C:\\Users\\Jane O\'Neil\\AppData\\Local\\Programs\\Locust\\resources\\locust-command-guard.mjs'

/** The event Copilot handed the hook in the measurement, with this command in it. */
const copilotEvent = (command: string): string =>
  JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', timestamp: '2026-10-10T12:44:33.448Z', cwd: 'C:\\work\\pebble', tool_name: 'Bash', tool_input: { command, description: 'Run it' } })

const commandOf = (hooks: string): string => (JSON.parse(hooks) as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } }).hooks.PreToolUse[0]!.hooks[0]!.command

describe('the plugin every Copilot run is given', () => {
  it('names the guard on Windows as Codex’s is named, inside a try that always ends 0', () => {
    expect(JSON.parse(copilotCommandGuardHooks({ node: LOCUST, guardPath: SCRIPT, parent: 4242, platform: 'win32' }))).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash|PowerShell',
            hooks: [
              {
                type: 'command',
                command:
                  "try { $env:ELECTRON_RUN_AS_NODE='1'; $env:LOCUST_GUARD_PARENT='4242'; & 'C:/Users/Jane O''Neil/AppData/Local/Programs/Locust/Locust.exe' 'C:/Users/Jane O''Neil/AppData/Local/Programs/Locust/resources/locust-command-guard.mjs' } catch {}; exit 0",
                timeout: 15
              }
            ]
          }
        ]
      }
    })
    const codex = codexCommandGuardConfig({ node: LOCUST, guardPath: SCRIPT, parent: 4242, platform: 'win32' })
    expect(commandOf(copilotCommandGuardHooks({ node: LOCUST, guardPath: SCRIPT, parent: 4242, platform: 'win32' }))).toBe(`try { ${(codex.hooks.PreToolUse[0] as { hooks: Array<{ command: string }> }).hooks[0]!.command} } catch {}; exit 0`)
  })

  it('names it elsewhere as Claude Code’s is named, and never fails', () => {
    const at = { node: '/Applications/Locust.app/Contents/MacOS/Locust', guardPath: '/Applications/Locust.app/Contents/Resources/locust-command-guard.mjs', parent: 77 }
    expect(commandOf(copilotCommandGuardHooks({ ...at, platform: 'darwin' }))).toBe(`${commandOf(commandGuardSettings(at))} || true`)
  })

  it('is written where Copilot reads a Claude-format plugin: its manifest, and hooks/hooks.json beside it', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'locust-copilot-guard-'))
    const plugin = await writeCopilotCommandGuard(folder, { node: LOCUST, guardPath: SCRIPT, parent: 4242 })
    expect(plugin).toBe(join(folder, 'copilot-command-guard'))
    expect(JSON.parse(await readFile(join(plugin!, '.claude-plugin', 'plugin.json'), 'utf8'))).toMatchObject({ name: 'locust-command-guard' })
    expect(await readFile(join(plugin!, 'hooks', 'hooks.json'), 'utf8')).toBe(copilotCommandGuardHooks({ node: LOCUST, guardPath: SCRIPT, parent: 4242 }))
  })

  it('is given on the print route and the Approve-each route alike, and only when there is one', () => {
    const launch = { commandName: 'copilot', discoveredPath: 'C:\\tools\\copilot.exe', executablePath: 'C:\\tools\\copilot.exe', prefixArgs: [], kind: 'native' } as ExecutableLaunch
    for (const spec of [
      createCopilotPromptCommand(launch, { workspacePath: 'C:\\work\\pebble', prompt: 'Say hi.', guardPlugin: 'C:\\Locust\\copilot-command-guard' }),
      createCopilotAcpCommand(launch, { workspacePath: 'C:\\work\\pebble', guardPlugin: 'C:\\Locust\\copilot-command-guard' })
    ]) {
      const at = spec.args.indexOf('--plugin-dir')
      expect(spec.args.slice(at, at + 2)).toEqual(['--plugin-dir', 'C:\\Locust\\copilot-command-guard'])
    }
    expect(createCopilotPromptCommand(launch, { workspacePath: 'C:\\work\\pebble', prompt: 'Say hi.' }).args).not.toContain('--plugin-dir')
    expect(createCopilotAcpCommand(launch, { workspacePath: 'C:\\work\\pebble' }).args).not.toContain('--plugin-dir')
  })

  it.runIf(process.platform === 'win32')('names a drive’s LOCUST_GUARD_LOG in the hook itself, since Copilot passes the guard only the runner’s allowlist', async () => {
    const log = join(await mkdtemp(join(tmpdir(), 'locust-copilot-guard-log-')), "Jane's asked.jsonl")
    const command = commandOf(copilotCommandGuardHooks({ node: process.execPath, guardPath: GUARD, parent: process.pid, platform: 'win32', log }))
    // What Copilot itself was given, and so its hook: only the runner's allowlist.
    const allowed = new Set<string>(RUNTIME_ENVIRONMENT_ALLOWLIST)
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toUpperCase())))
    const child = spawn('powershell.exe', ['-nop', '-nol', '-c', command], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, env })
    child.stdin.end(copilotEvent('npm test'))
    await new Promise((resolve) => child.on('close', resolve))
    expect(JSON.parse((await readFile(log, 'utf8')).trim())).toEqual({ tool: 'Bash', command: 'npm test', refused: false })
    expect(commandOf(copilotCommandGuardHooks({ node: LOCUST, guardPath: SCRIPT, parent: 1, platform: 'win32' }))).not.toContain('LOCUST_GUARD_LOG')
  }, 30_000)

  it.runIf(process.platform === 'win32')('refuses, through PowerShell as Copilot runs it, what the guard refuses; lets the rest through; and ends 0 when it cannot start', async () => {
    const run = async (command: string, input: string): Promise<{ out: string; code: number | null }> => {
      // Copilot's own launch, measured: powershell.exe -nop -nol -c "<command>".
      const child = spawn('powershell.exe', ['-nop', '-nol', '-c', command], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
      let out = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => (out += chunk))
      child.stdin.end(input)
      const code = await new Promise<number | null>((resolve) => child.on('close', resolve))
      return { out: out.trim(), code }
    }
    const guarded = commandOf(copilotCommandGuardHooks({ node: process.execPath, guardPath: GUARD, parent: process.pid, platform: 'win32' }))
    const missing = commandOf(copilotCommandGuardHooks({ node: 'C:\\nowhere\\Locust.exe', guardPath: 'C:\\nowhere\\locust-command-guard.mjs', parent: process.pid, platform: 'win32' }))
    const [refused, allowed, unstarted] = await Promise.all([
      run(guarded, copilotEvent('taskkill /F /IM msedge.exe')),
      run(guarded, copilotEvent('npm test')),
      run(missing, copilotEvent('npm test'))
    ])
    expect(JSON.parse(refused.out)).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: stoppedBecause('taskkill /F /IM msedge.exe', () => undefined) }
    })
    expect(refused.code).toBe(0)
    expect(allowed).toEqual({ out: '', code: 0 })
    // Copilot would deny every command for a hook that failed (measured); this one gets out of the way.
    expect(unstarted).toEqual({ out: '', code: 0 })
  }, 30_000)
})
