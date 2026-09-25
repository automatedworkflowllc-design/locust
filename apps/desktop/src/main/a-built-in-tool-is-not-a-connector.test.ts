import { describe, expect, it } from 'vitest'

import { builtInOrConnector } from './permission-host.js'

/**
 * Claude Code routes its OWN tools through the permission bridge in Edit
 * mode, and every request there was drawn as a connector: a drive on
 * 2026-09-25 showed `node check.js` as input sent "to the service the
 * connector reaches", which Locust "cannot undo".
 */
describe('a request through the permission bridge', () => {
  it('is a command card when it is Bash', () => {
    expect(builtInOrConnector('Bash', { command: 'node check.js' }, 'C:/work')).toEqual({ kind: 'command', summary: 'Run a command', detail: 'node check.js' })
  })

  it('is a file card, named inside the folder, when it edits a file', () => {
    expect(builtInOrConnector('Edit', { file_path: 'C:/work/notes.txt', old_string: 'a', new_string: 'b' }, 'C:/work'))
      .toEqual({ kind: 'file-change', summary: 'Change 1 file', detail: 'notes.txt' })
  })

  it('is still a connector when it is one', () => {
    expect(builtInOrConnector('mcp__claude_ai_Gmail__send_message', { to: 'x' }, 'C:/work').kind).toBe('connector')
  })
})
