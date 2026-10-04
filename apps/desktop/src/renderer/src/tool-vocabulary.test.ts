import { describe, expect, it } from 'vitest'

import { editToolName, isShellTool } from './missionView.js'

/*
 * Every tool name five runtimes have actually produced on this machine, and
 * what each one IS.
 *
 * Built 2026-09-13 by reading the recorded ledgers rather than by imagining
 * what a runtime might send: 147 missions, grouped by adapter and tool name.
 * Colin asked whether there were "small variants between all these models"
 * we were missing. There were two, both Antigravity, both silent:
 *
 *   run_command  76 calls  counted as a generic tool, so every Antigravity
 *                          run reported that it ran NO commands
 *   view_file    38 calls  counted as an EDIT, so reading a file reported a
 *                          changed file -- and since 0.96.0 that lands in a
 *                          reviewer's WHAT CHANGED as a false claim
 *
 * A runtime added later gets a row here, from a real capture, before it is
 * trusted to be classified correctly.
 */
const VOCABULARY: readonly {
  readonly adapter: string
  readonly name: string
  readonly kind: string
  readonly shell: boolean
  readonly edit: boolean
}[] = [
  // Antigravity -- the two that were wrong are the first two.
  { adapter: 'antigravity', name: 'run_command', kind: 'run_command', shell: true, edit: false },
  { adapter: 'antigravity', name: 'view_file', kind: 'view_file', shell: false, edit: false },
  { adapter: 'antigravity', name: 'write_to_file', kind: 'write_to_file', shell: false, edit: true },
  { adapter: 'antigravity', name: 'list_dir', kind: 'list_dir', shell: false, edit: false },
  { adapter: 'antigravity', name: 'grep_search', kind: 'grep_search', shell: false, edit: false },
  { adapter: 'antigravity', name: 'ask_question', kind: 'ask_question', shell: false, edit: false },
  // Codex
  { adapter: 'codex', name: 'shell', kind: 'command_execution', shell: true, edit: false },
  { adapter: 'codex', name: 'web_search', kind: 'web_search', shell: false, edit: false },
  // Cursor
  { adapter: 'cursor', name: 'shell', kind: 'shell', shell: true, edit: false },
  { adapter: 'cursor', name: 'read', kind: 'read', shell: false, edit: false },
  { adapter: 'cursor', name: 'edit', kind: 'edit', shell: false, edit: true },
  { adapter: 'cursor', name: 'delete', kind: 'delete', shell: false, edit: true },
  { adapter: 'cursor', name: 'glob', kind: 'glob', shell: false, edit: false },
  { adapter: 'cursor', name: 'grep', kind: 'grep', shell: false, edit: false },
  { adapter: 'cursor', name: 'task', kind: 'task', shell: false, edit: false },
  { adapter: 'cursor', name: 'await', kind: 'await', shell: false, edit: false },
  { adapter: 'cursor', name: 'mcp', kind: 'mcp', shell: false, edit: false },
  // OpenCode
  { adapter: 'opencode', name: 'bash', kind: 'bash', shell: true, edit: false },
  { adapter: 'opencode', name: 'read', kind: 'read', shell: false, edit: false },
  { adapter: 'opencode', name: 'grep', kind: 'grep', shell: false, edit: false },
  { adapter: 'opencode', name: 'skill', kind: 'skill', shell: false, edit: false },
  { adapter: 'opencode', name: 'write', kind: 'write', shell: false, edit: true },
  // The plan tools of three runtimes: never a file change, whatever they spell.
  { adapter: 'opencode', name: 'todowrite', kind: 'todowrite', shell: false, edit: false },
  { adapter: 'claude', name: 'TodoWrite', kind: 'tool_use', shell: false, edit: false },
  { adapter: 'copilot', name: 'write_agent', kind: 'tool_use', shell: false, edit: false },
  // Copilot CLI's shell (0.587): drawn as "Used powershell" until the cross-model pass caught it.
  { adapter: 'copilot', name: 'powershell', kind: 'powershell', shell: true, edit: false },
  { adapter: 'copilot', name: 'view', kind: 'view', shell: false, edit: false }
]

describe('the tool vocabulary every runtime actually speaks', () => {
  for (const row of VOCABULARY) {
    it(`${row.adapter}: ${row.name} is ${row.shell ? 'a command' : row.edit ? 'a file change' : 'neither'}`, () => {
      expect(isShellTool(row.name, row.kind)).toBe(row.shell)
      expect(editToolName(row.name)).toBe(row.edit)
    })
  }

  it('a name that only LOOKS at a file is never a change, however it is spelled', () => {
    // The `file` noun is shared by both kinds, so the verb has to win.
    for (const name of ['view_file', 'read_file', 'readFile', 'open_file', 'show_file', 'list_files', 'searchFiles']) {
      expect(editToolName(name), name).toBe(false)
    }
    for (const name of ['write_to_file', 'writeFile', 'edit_file', 'delete_file', 'create_file', 'apply_patch']) {
      expect(editToolName(name), name).toBe(true)
    }
  })

  // QA-2026-09-29 round 2, R13: a connector's create/delete is not a change to a file here.
  it('never calls a connector tool a file change, whatever its verb', () => {
    for (const name of [
      'mcp__github__create_issue', 'mcp__github__create_pull_request', 'mcp__github__delete_file', 'mcp__github__push_files',
      'mcp__claude_ai_Gmail__create_draft', 'mcp__claude_ai_Google_Drive__create_file', 'Google_Drive__create_file', 'mcp__linear__create_issue'
    ]) {
      expect(editToolName(name), name).toBe(false)
    }
  })
})
