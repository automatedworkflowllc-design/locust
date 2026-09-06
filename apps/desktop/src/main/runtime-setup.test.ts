import { describe, expect, it } from 'vitest'

import { readRuntimeSetup } from './runtime-setup.js'

/** A fake disk: paths that exist map to text; anything else is ENOENT. */
function disk(files: Readonly<Record<string, string>>) {
  const normal = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  const held = new Map(Object.entries(files).map(([path, text]) => [normal(path), text]))
  return async (path: string): Promise<string> => {
    const text = held.get(normal(path))
    if (text === undefined) {
      const error = new Error('not found') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    if (text === '<<EACCES>>') {
      const error = new Error('denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      throw error
    }
    return text
  }
}

const HOME = 'C:/Users/colin'
const WS = 'C:/Users/colin/shop'

describe("what each runtime has set up for itself", () => {
  it('reads Claude Code hooks from user and project settings, and MCP servers from three places, names only', async () => {
    const setup = await readRuntimeSetup({
      workspacePath: WS,
      homeDirectory: HOME,
      read: disk({
        'C:/Users/colin/.claude/settings.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'secret.sh' }] }], PreToolUse: [{}, {}] } }),
        'C:/Users/colin/shop/.claude/settings.json': JSON.stringify({ hooks: { PostToolUse: [{}] } }),
        'C:/Users/colin/.claude.json': JSON.stringify({
          mcpServers: { github: { command: 'npx', args: ['--token', 'SECRET'] } },
          projects: { 'C:\\Users\\colin\\shop': { mcpServers: { robinhood: {} } }, 'C:/elsewhere': { mcpServers: { other: {} } } }
        }),
        'C:/Users/colin/shop/.mcp.json': JSON.stringify({ mcpServers: { playwright: {} } })
      })
    })
    expect(setup.claude?.hooks).toEqual(['Stop (1)', 'PreToolUse (2)', 'PostToolUse (1)'])
    expect(setup.claude?.mcpServers).toEqual(['github', 'robinhood', 'playwright'])
    expect(setup.claude?.unreadable).toEqual([])
    expect(JSON.stringify(setup)).not.toContain('SECRET')
    expect(JSON.stringify(setup)).not.toContain('secret.sh')
  })

  it('reads Codex MCP servers from TOML table headers and its notify hook, without a TOML parser', async () => {
    const setup = await readRuntimeSetup({
      workspacePath: undefined,
      homeDirectory: HOME,
      read: disk({
        'C:/Users/colin/.codex/config.toml': [
          'model = "gpt-5"',
          'notify = ["node", "C:\\\\scripts\\\\notify.mjs"]',
          '',
          '[mcp_servers.node_repl]',
          'command = "node"',
          '',
          '[mcp_servers.node_repl.env]',
          'TOKEN = "SECRET"',
          '',
          '[mcp_servers.robinhood]',
          'url = "https://example"'
        ].join('\n')
      })
    })
    expect(setup.codex?.mcpServers).toEqual(['node_repl', 'robinhood'])
    expect(setup.codex?.hooks).toEqual(['notify (1)'])
    expect(JSON.stringify(setup)).not.toContain('SECRET')
  })

  it('reads Cursor, OpenCode and Copilot from their own files, in the folder and at home', async () => {
    const setup = await readRuntimeSetup({
      workspacePath: WS,
      homeDirectory: HOME,
      read: disk({
        'C:/Users/colin/.cursor/mcp.json': JSON.stringify({ mcpServers: { figma: {} } }),
        'C:/Users/colin/shop/.cursor/hooks.json': JSON.stringify({ hooks: { afterFileEdit: [{ command: 'fmt' }] } }),
        'C:/Users/colin/shop/opencode.json': JSON.stringify({ mcp: { context7: {} } }),
        'C:/Users/colin/.copilot/mcp-config.json': JSON.stringify({ mcpServers: { github: {} } })
      })
    })
    expect(setup.cursor).toMatchObject({ mcpServers: ['figma'], hooks: ['afterFileEdit (1)'] })
    expect(setup.opencode?.mcpServers).toEqual(['context7'])
    expect(setup.copilot?.mcpServers).toEqual(['github'])
  })

  it('an absent file is nothing; a file that cannot be read or parsed is named, never guessed', async () => {
    const setup = await readRuntimeSetup({
      workspacePath: WS,
      homeDirectory: HOME,
      read: disk({
        'C:/Users/colin/.claude/settings.json': '{not json',
        'C:/Users/colin/.cursor/mcp.json': '<<EACCES>>'
      })
    })
    expect(setup.claude?.hooks).toEqual([])
    expect(setup.claude?.unreadable.map((p) => p.replace(/\\/g, '/'))).toEqual(['C:/Users/colin/.claude/settings.json'])
    expect(setup.cursor?.unreadable.map((p) => p.replace(/\\/g, '/'))).toEqual(['C:/Users/colin/.cursor/mcp.json'])
    expect(setup.codex).toEqual({ mcpServers: [], hooks: [], skills: [], agents: [], sources: [], unreadable: [] })
  })
})
