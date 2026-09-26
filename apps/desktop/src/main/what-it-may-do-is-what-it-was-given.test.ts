import {
  codexAppServerPolicy,
  createClaudePrintCommand,
  createCopilotPromptCommand,
  createCursorPrintCommand,
  createMuseExecCommand,
  createOpenCodeRunCommand,
  createOpenCodeServeCommand
} from '@teammate/runtime-adapters'
import type { ExecutableLaunch, MissionSandbox } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { whatItMayDo } from '../shared/may-do.js'

/**
 * WHAT THE PANEL SAYS A RUN MAY DO IS WHAT THE RUN WAS GIVEN (0.359).
 *
 * The Activity panel said "deny: ... any network access beyond the model's
 * own" under an OpenCode run that had just searched the web twice (the
 * first-session drive, packaged 0.358). The sentence was written once for
 * every runtime and checked against none of them.
 *
 * Each claim below is read back out of the command the real builder makes
 * for that runtime and mode -- its config, its tool list, its flags -- so a
 * change to what a run is given fails here until the panel says it too.
 */
const launch = (commandName: string): ExecutableLaunch =>
  ({ commandName, discoveredPath: `C:\\tools\\${commandName}.exe`, executablePath: `C:\\tools\\${commandName}.exe`, prefixArgs: [], kind: 'native' }) as ExecutableLaunch
const options = (sandbox: MissionSandbox) => ({ workspacePath: 'C:\\work\\pebble', prompt: 'go', sandbox })
const said = (runtime: Parameters<typeof whatItMayDo>[0], sandbox: MissionSandbox, mode?: Parameters<typeof whatItMayDo>[2]) =>
  whatItMayDo(runtime, sandbox, mode).rows.map((row) => `${row.verdict} ${row.text}`)
const SANDBOXES = ['read-only', 'workspace-write', 'full-access'] as const

describe('what the panel says a run may do', () => {
  it('OpenCode: the web, commands and the folder, from the config the run is given', () => {
    for (const sandbox of SANDBOXES) {
      const spec = createOpenCodeRunCommand(launch('opencode'), options(sandbox))
      const permission = (JSON.parse(spec.env?.OPENCODE_CONFIG_CONTENT ?? '{}') as { permission?: Record<string, unknown> }).permission ?? {}
      const rows = said('opencode', sandbox)
      if (sandbox === 'full-access') {
        expect(spec.args).toContain('--auto')
        expect(permission.external_directory).toBe('allow')
        expect(rows).toContain('allow run any command your account can run, and reach any network')
        continue
      }
      // The config the free model runs under names no web rule, so the web
      // is OpenCode's own default -- allowed -- and the panel must say so.
      expect(permission.webfetch).toBeUndefined()
      expect(permission.websearch).toBeUndefined()
      expect(rows).toContain('allow search the web and open web pages')
      expect(rows.join('\n')).not.toMatch(/network access|deny.*network/)
      // `run` refuses every "ask"; nothing named means allowed.
      if (permission.bash === 'ask') expect(rows).toContain('deny running commands')
      if (permission.bash === undefined) expect(rows).toContain('allow run commands, which can reach anything your account can')
      expect(permission.external_directory).toBe('deny')
      expect(rows).toContain('deny opening files outside this folder, other than by running a command')
    }
  })

  it('OpenCode, Approve each: what its server asks for is what the panel says it asks for', () => {
    const spec = createOpenCodeServeCommand(launch('opencode'), { workspacePath: 'C:\\work\\pebble' })
    const permission = (JSON.parse(spec.env?.OPENCODE_CONFIG_CONTENT ?? '{}') as { permission: Record<string, unknown> }).permission
    expect([permission.edit, permission.bash, permission.webfetch, permission.external_directory]).toEqual(['ask', 'ask', 'ask', 'ask'])
    expect(permission.websearch).toBeUndefined()
    const rows = said('opencode', 'workspace-write', 'approve-each')
    expect(rows).toContain('allow change files in this folder, once you approve each change')
    expect(rows).toContain('allow run commands and open web pages, once you approve each one')
    expect(rows).toContain('allow search the web')
    expect(rows).toContain('allow open files outside this folder, once you approve it')
  })

  it('Claude Code: commands only when its tool list has Bash, and never the web tools', () => {
    for (const sandbox of ['read-only', 'workspace-write'] as const) {
      const spec = createClaudePrintCommand(launch('claude'), options(sandbox))
      const tools = spec.args[spec.args.indexOf('--tools') + 1]!.split(',')
      const rows = said('claude', sandbox)
      expect(tools).not.toContain('WebFetch')
      expect(tools).not.toContain('WebSearch')
      expect(rows).toContain('deny searching the web or opening web pages: it is given no tool for either')
      expect(rows).toContain(tools.includes('Bash') ? 'allow run commands, which can reach anything your account can' : 'deny running commands')
    }
  })

  it('Copilot CLI: commands refused only where its deny list says so, and paths held unless Auto', () => {
    const readOnly = createCopilotPromptCommand(launch('copilot'), options('read-only'))
    expect(readOnly.args).toContain('--deny-tool=write,shell')
    expect(said('copilot', 'read-only')).toContain('deny running commands')
    const edit = createCopilotPromptCommand(launch('copilot'), options('workspace-write'))
    expect(edit.args.join(' ')).not.toMatch(/--deny-tool|--allow-all-paths/)
    expect(said('copilot', 'workspace-write')).toEqual(expect.arrayContaining(['allow run commands, which can reach anything your account can', 'deny opening files outside this folder, other than by running a command']))
    expect(createCopilotPromptCommand(launch('copilot'), options('full-access')).args).toContain('--allow-all-paths')
  })

  it("Muse Code: its sandbox stays on, its web tools stay on, its shell is off when read-only", () => {
    const readOnly = createMuseExecCommand(launch('muse'), options('read-only'))
    expect(readOnly.args).toEqual(expect.arrayContaining(['--disable-write', '--disable-shell']))
    expect(said('muse', 'read-only')).toContain('deny running commands')
    const edit = createMuseExecCommand(launch('muse'), options('workspace-write'))
    expect(edit.args.join(' ')).not.toMatch(/--disable-sandbox|--yolo|--disable-web-tools/)
    expect(edit.args.join(' ')).toContain('--approval-mode never')
    expect(said('muse', 'workspace-write')).toEqual(expect.arrayContaining(["allow run commands inside Muse's sandbox", 'allow search the web and open web pages']))
  })

  it('Codex: its own sandbox in every mode, and Approve each asks', () => {
    expect(codexAppServerPolicy('read-only').sandbox).toBe('read-only')
    expect(said('codex', 'read-only')).toContain("allow run commands in Codex's sandbox, which lets them read and change nothing")
    expect(codexAppServerPolicy('workspace-write').sandbox).toBe('workspace-write')
    expect(said('codex', 'workspace-write')).toContain("allow run commands in Codex's sandbox, which keeps their changes in this folder")
    expect(codexAppServerPolicy('workspace-write', 'approve-each').approvalPolicy).toBe('untrusted')
    expect(said('codex', 'workspace-write', 'approve-each')).toContain("allow run commands in Codex's sandbox, asking you before any that does more than read")
    expect(codexAppServerPolicy('full-access').sandbox).toBe('danger-full-access')
    expect(said('codex', 'full-access')).toContain('allow run any command your account can run, and reach any network')
  })

  it('Cursor Agent: says nothing about commands it was not given a rule for', () => {
    expect(createCursorPrintCommand(launch('cursor'), options('workspace-write')).args).not.toContain('--force')
    expect(said('cursor', 'workspace-write')).toEqual(['allow read the files in this folder', 'allow change files in this folder'])
    expect(createCursorPrintCommand(launch('cursor'), options('full-access')).args).toContain('--force')
    expect(said('cursor', 'full-access')).toContain('allow run any command your account can run, and reach any network')
  })

  it('leaves what it was not given to the runtime, by name', () => {
    expect(whatItMayDo('cursor', 'workspace-write').rest).toBe("Anything not listed is left to Cursor Agent's own settings.")
    expect(whatItMayDo('opencode', 'read-only').rest).toBe("Anything not listed is left to OpenCode's own settings.")
  })

  it('never denies anything in Auto, on any runtime that offers it', () => {
    for (const runtime of ['codex', 'claude', 'cursor', 'opencode', 'copilot'] as const) {
      expect(whatItMayDo(runtime, 'full-access').rows.every((row) => row.verdict === 'allow')).toBe(true)
    }
  })
})
