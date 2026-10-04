import { describe, expect, it } from 'vitest'

import type { RuntimeCommandSpec } from '@teammate/runtime-adapters'
import { commandTooLong, WINDOWS_COMMAND_LINE_LIMIT, WINDOWS_PROCESS_LIMIT } from './command-length.js'

const spec = (prompt: string, stdin: 'prompt' | 'none'): RuntimeCommandSpec =>
  ({
    runtime: 'copilot',
    executablePath: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'C:\\npm\\copilot.cmd', '-p', prompt, '--output-format', 'json'],
    cwd: 'C:\\work',
    stdin,
    stdout: 'jsonl'
  }) as RuntimeCommandSpec

describe('a command that will not fit on a Windows command line', () => {
  it('lets an ordinary prompt through', () => {
    expect(commandTooLong(spec('Fix the failing test in billing.', 'none'))).toBeUndefined()
  })

  it('lets a long-but-workable prompt through', () => {
    // 7,500 characters was measured running fine against the real CLI.
    expect(commandTooLong(spec('x'.repeat(6_500), 'none'))).toBeUndefined()
  })

  it('refuses one that would hit the limit', () => {
    // 9,000 was measured failing with "The command line is too long."
    const refusal = commandTooLong(spec('x'.repeat(9_000), 'none'))
    expect(refusal).toContain(String(WINDOWS_COMMAND_LINE_LIMIT))
    expect(refusal).toContain('Codex CLI and Claude Code')
  })

  it('applies the small ceiling only to a launch that goes through cmd.exe', () => {
    // The locator resolves an npm shim past cmd.exe to node and the script.
    // MEASURED 2026-09-17: Copilot under node with a 9,228-character prompt
    // ran fine (exit 0, one premium request). The same prompt through
    // cmd.exe was measured failing on 2026-09-05. The check follows the
    // launch, not the runtime.
    const underNode = (prompt: string): RuntimeCommandSpec =>
      ({ ...spec(prompt, 'none'), executablePath: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\npm\\node_modules\\@github\\copilot\\npm-loader.js', '-p', prompt, '--output-format', 'json'] }) as RuntimeCommandSpec
    expect(commandTooLong(underNode('x'.repeat(9_000)))).toBeUndefined()
    expect(commandTooLong(underNode('x'.repeat(20_000)))).toBeUndefined()
    // Windows' own limit still holds.
    const refusal = commandTooLong(underNode('x'.repeat(33_000)))
    expect(refusal).toContain(String(WINDOWS_PROCESS_LIMIT))
    // And through cmd.exe the old number is the right one.
    expect(commandTooLong(spec('x'.repeat(9_000), 'none'))).toContain(String(WINDOWS_COMMAND_LINE_LIMIT))
  })

  it('never limits a runtime that reads the prompt from input', () => {
    // Codex and Claude take it on stdin, where there is no ceiling. Applying
    // one would refuse work that would have run perfectly.
    expect(commandTooLong(spec('x'.repeat(50_000), 'prompt'))).toBeUndefined()
  })

  it('says how long the request actually was, so the number is actionable', () => {
    const refusal = commandTooLong(spec('x'.repeat(12_000), 'none'))
    expect(refusal).toMatch(/about 12[,0-9]*/)
  })
})
