import { describe, expect, it } from 'vitest'

import { MEMORY_FILE, memoryFileText, writeMemoryFile } from './memory-file.js'
import type { MemoryLine } from '../shared/memory.js'

/**
 * Team memory as a file in the workspace, so a teammate can READ the whole
 * of it rather than be handed the newest few lines and told the rest exist.
 * Colin's folder, 2026-09-17: 33 memories, ~20 pasted per turn, 13 invisible.
 */

const NOW = new Date('2026-09-17T12:00:00.000Z')
const line = (text: string, at: string, scope: MemoryLine['scope'] = 'workspace', by = 'Wembley'): MemoryLine => ({ text, scope, by, where: undefined, at })

describe('the memory file', () => {
  it('lists this folder and everywhere, newest last, with who and when, and says it is read-only', () => {
    const text = memoryFileText(
      [line('Deploys go out Tuesday.', '2026-08-01T00:00:00.000Z'), line('Colin reads on his phone.', '2026-09-16T00:00:00.000Z', 'global', 'you')],
      NOW
    )
    expect(text).toContain('## This folder (1)')
    expect(text).toContain('- Deploys go out Tuesday. (by Wembley -- 2026-08-01 (6 weeks ago))')
    expect(text).toContain('## Everywhere (1)')
    expect(text).toContain('- Colin reads on his phone. (by the person -- 2026-09-16 (yesterday))')
    expect(text).toContain('Read-only: to change memory, use the <locust-memory> block')
  })

  const io = (files: Record<string, string>) => {
    const writes: Record<string, string> = {}
    return {
      writes,
      io: {
        readFile: async (path: string) => {
          const held = files[path.replace(/\\/g, '/')]
          if (held === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
          return held
        },
        writeFile: async (path: string, text: string) => {
          writes[path.replace(/\\/g, '/')] = text
        },
        mkdir: async () => undefined
      }
    }
  }

  it('writes under .locust in the folder and returns the path the brief names', async () => {
    const fake = io({})
    const path = await writeMemoryFile('C:\\work', [line('A.', '2026-09-01T00:00:00.000Z')], NOW, fake.io)
    expect(path).toBe('.locust/memory.md')
    expect(MEMORY_FILE.replace(/\\/g, '/')).toBe('.locust/memory.md')
    expect(Object.keys(fake.writes)).toEqual(['C:/work/.locust/memory.md'])
  })

  it('does not rewrite a file that already says the same', async () => {
    const lines = [line('A.', '2026-09-01T00:00:00.000Z')]
    const fake = io({ 'C:/work/.locust/memory.md': memoryFileText(lines, NOW) })
    await writeMemoryFile('C:\\work', lines, NOW, fake.io)
    expect(fake.writes).toEqual({})
  })

  it('keeps .locust out of git where there is a repository, and only there', async () => {
    const withGit = io({ 'C:/work/.git/HEAD': 'ref: refs/heads/main\n' })
    await writeMemoryFile('C:\\work', [], NOW, withGit.io)
    expect(withGit.writes['C:/work/.git/info/exclude']).toBe('.locust/\n')
    const already = io({ 'C:/work/.git/HEAD': 'ref\n', 'C:/work/.git/info/exclude': '.locust/\n' })
    await writeMemoryFile('C:\\work', [], NOW, already.io)
    expect(already.writes['C:/work/.git/info/exclude']).toBeUndefined()
    const noGit = io({})
    await writeMemoryFile('C:\\work', [], NOW, noGit.io)
    expect(noGit.writes['C:/work/.git/info/exclude']).toBeUndefined()
  })

  it('returns nothing when the folder cannot be written, so the brief pastes as before', async () => {
    const failing = { ...io({}).io, writeFile: async () => { throw new Error('EACCES') } }
    expect(await writeMemoryFile('C:\\work', [line('A.', '2026-09-01T00:00:00.000Z')], NOW, failing)).toBeUndefined()
  })
})
