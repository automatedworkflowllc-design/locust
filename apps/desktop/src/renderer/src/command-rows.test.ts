import { describe, expect, it } from 'vitest'

import { isShellTool } from './missionView.js'

/**
 * A command row is drawn whatever the runtime calls its shell.
 *
 * The test asked for a tool named `shell` or a kind of `command_execution`,
 * which between them describe exactly ONE runtime: Codex. Claude Code names
 * the tool `Bash` and OpenCode names it `bash`, so every shell call either
 * of them made fell through to a generic tool row — no exit-code badge,
 * nothing to expand, and counted under "other" in the turn summary rather
 * than as a command.
 *
 * Found on 2026-09-09 trying to SEE 0.56.0's intent line on screen. That
 * feature reads the model's own `description` for a Bash call, and both
 * those adapters carry it — but the line is drawn by the command row, and
 * neither runtime ever produced one. So the feature was invisible on every
 * runtime: the two that send a description had no row, and the one with a
 * row sends no description.
 *
 * Both halves had passing tests. Neither test touched the other half, and
 * nothing looked at the screen until a probe did.
 */

describe('what counts as a command', () => {
  it('is every runtime’s shell, however it spells it', () => {
    expect(isShellTool('Bash', 'tool_use'), 'Claude Code').toBe(true)
    expect(isShellTool('bash', 'bash'), 'OpenCode').toBe(true)
    expect(isShellTool('shell', undefined), 'the older name').toBe(true)
    expect(isShellTool('anything', 'command_execution'), 'Codex').toBe(true)
  })

  it('is not everything', () => {
    // The obvious way to over-fix this: a file tool is not a shell, and a
    // name that merely starts with the word is not the word.
    expect(isShellTool('Read', 'tool_use')).toBe(false)
    expect(isShellTool('bashful', 'tool_use')).toBe(false)
    expect(isShellTool('todowrite', 'todowrite')).toBe(false)
    expect(isShellTool('task', 'task')).toBe(false)
  })
})
