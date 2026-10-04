import { describe, expect, it, vi } from 'vitest'
import { redactSecrets } from '@teammate/runtime-adapters'

import { holdsSecrets, observedPatches } from './disk-observation.js'

/**
 * A CREDENTIAL FILE IS NEVER SHOWN (0.489). Colin, 2026-09-30: a teammate
 * working in his `.claude` folder, and the thread drew `.credentials.json` --
 * Claude Code's access and refresh tokens, in full -- as a change "seen on
 * disk", with `mcp-needs-auth-cache.json` and a `sessions/<n>.key`; the ledger
 * kept them. The watch read a changed file to draw its change and never asked
 * what the file was.
 */
const TOKEN = 'sk-ant-oat01-' + 'Q'.repeat(40)

describe('which files hold credentials', () => {
  it('refuses the ones from that run, and their kind', () => {
    for (const path of ['.credentials.json', 'mcp-needs-auth-cache.json', 'sessions/35372.782cf699e1d.key', '.config/app/settings.json', 'secrets/prod.yml', 'server.pem', 'id_ed25519', 'oauth-state.json', 'cookies.sqlite']) {
      expect(holdsSecrets(path), path).toBe(true)
    }
  })

  it('lets an ordinary project file through', () => {
    for (const path of ['src/app.ts', 'README.md', 'data/prices.csv', 'file-history/abc/def@v2']) {
      expect(holdsSecrets(path), path).toBe(false)
    }
  })
})

describe('what the watch draws', () => {
  it('never opens a credential file, and scrubs a token anywhere else', async () => {
    const readText = vi.fn(async (path: string) =>
      path.endsWith('.credentials.json') ? `{"accessToken":"${TOKEN}"}` : `{"note": "copy of ${TOKEN}", "accessToken": "abc123secretvalue"}`
    )
    const after = new Map<string, string>([['.credentials.json', '??'], ['notes.json', '??']])
    const patches = await observedPatches('C:/work', after, ['.credentials.json', 'notes.json'], { readText, runGit: async () => '' })
    expect(readText.mock.calls.map(([path]) => String(path))).not.toContainEqual(expect.stringContaining('.credentials.json'))
    expect(patches.has('.credentials.json')).toBe(false)
    const drawn = JSON.stringify(patches.get('notes.json') ?? {})
    expect(drawn).not.toContain(TOKEN)
    expect(drawn).not.toContain('abc123secretvalue')
  })

  it("scrubs a key in JSON's own shape, quote before the colon", () => {
    expect(redactSecrets('{"refreshToken":"abcdef123456"}')).not.toContain('abcdef123456')
    expect(redactSecrets(`token ${TOKEN} here`)).not.toContain(TOKEN)
  })
})
