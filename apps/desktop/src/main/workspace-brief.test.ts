import { describe, expect, it } from 'vitest'

import { MAX_BRIEF_BYTES, MAX_BRIEF_LINES, boundedBrief, briefSection, readWorkspaceBrief } from './workspace-brief.js'

const enoent = async (): Promise<string> => {
  const error = new Error('not found') as NodeJS.ErrnoException
  error.code = 'ENOENT'
  throw error
}

describe("the folder's own instructions", () => {
  it('reads LOCUST.md from the folder root and quotes it whole, with the folder named', async () => {
    const brief = await readWorkspaceBrief('C:/w/shop', async (path) => {
      expect(path.replace(/\\/g, '/')).toBe('C:/w/shop/LOCUST.md')
      return '# shop\nRun tests with pnpm test.\r\nNever touch prices.csv.\n'
    })
    expect(brief).toEqual({ text: '# shop\nRun tests with pnpm test.\nNever touch prices.csv.', lines: 3, truncated: false })
    const section = briefSection(brief!, 'shop')
    expect(section).toContain('Instructions for the folder "shop", from its LOCUST.md')
    expect(section).toContain('Never touch prices.csv.')
    expect(section).not.toContain('not loaded')
  })

  it('none, empty, or unreadable is no brief at all -- never a section saying so', async () => {
    expect(await readWorkspaceBrief('C:/w/shop', enoent)).toBeUndefined()
    expect(await readWorkspaceBrief('C:/w/shop', async () => '   \n')).toBeUndefined()
    expect(await readWorkspaceBrief(undefined, async () => 'x')).toBeUndefined()
    expect(await readWorkspaceBrief('', async () => 'x')).toBeUndefined()
  })

  it('is bounded by lines and by bytes, and says when the rest was cut', () => {
    const long = Array.from({ length: MAX_BRIEF_LINES + 5 }, (_, i) => `line ${String(i)}`).join('\n')
    const byLines = boundedBrief(long)
    expect(byLines.lines).toBe(MAX_BRIEF_LINES)
    expect(byLines.truncated).toBe(true)
    expect(briefSection(byLines, 'shop')).toContain('the rest was not loaded')
    const fat = Array.from({ length: 50 }, () => 'x'.repeat(1000)).join('\n')
    const byBytes = boundedBrief(fat)
    expect(byBytes.truncated).toBe(true)
    expect(Buffer.byteLength(byBytes.text, 'utf8')).toBeLessThanOrEqual(MAX_BRIEF_BYTES)
    expect(byBytes.lines).toBeLessThan(50)
  })
})
