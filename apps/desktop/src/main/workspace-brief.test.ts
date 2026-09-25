import { describe, expect, it } from 'vitest'

import { MAX_BRIEF_BYTES, MAX_BRIEF_LINES, boundedBrief, briefForRuntime, briefSection, readWorkspaceBrief } from './workspace-brief.js'

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

/*
 * A4.2: a LOCUST.md section can be addressed to one runtime's teammates.
 * Everything outside a section still goes to everyone.
 */
describe("LOCUST.md sections for one runtime", () => {
  const FILE = [
    '# Project',
    'Run the tests with npm test.',
    '<claude>',
    'Use the Task tool for long searches.',
    '</claude>',
    '<codex>',
    'Prefer apply_patch for edits.',
    '</codex>',
    'Never push to main.'
  ].join('\n')

  it('gives each runtime its own section and everyone the rest', () => {
    expect(briefForRuntime(FILE, 'claude')).toBe('# Project\nRun the tests with npm test.\nUse the Task tool for long searches.\nNever push to main.')
    expect(briefForRuntime(FILE, 'codex')).toBe('# Project\nRun the tests with npm test.\nPrefer apply_patch for edits.\nNever push to main.')
    expect(briefForRuntime(FILE, 'opencode')).toBe('# Project\nRun the tests with npm test.\nNever push to main.')
  })

  it('leaves alone a tag that names no runtime, a tag inside a code fence, and a tag never closed', () => {
    const other = '<details>\nmore\n</details>'
    expect(briefForRuntime(other, 'claude')).toBe(other)
    const fenced = 'Example:\n```\n<codex>\nsample\n</codex>\n```\nEnd.'
    expect(briefForRuntime(fenced, 'claude')).toBe(fenced)
    // An unclosed tag hides nothing: the rest of the file still arrives.
    const unclosed = 'Top.\n<claude>\nFor Claude.\nEveryone again.'
    expect(briefForRuntime(unclosed, 'codex')).toBe(unclosed)
  })

  it('is what a run on that runtime is given, bounded after the other sections are gone', async () => {
    const read = async () => FILE
    expect((await readWorkspaceBrief('/work', read, 'codex'))?.text).toContain('Prefer apply_patch')
    expect((await readWorkspaceBrief('/work', read, 'codex'))?.text).not.toContain('Task tool')
    // With no runtime named, the file as written (the Settings count reads it so).
    expect((await readWorkspaceBrief('/work', read))?.text).toContain('<claude>')
    // A file that is only another runtime's section is no brief for this one.
    expect(await readWorkspaceBrief('/work', async () => '<claude>\nOnly Claude.\n</claude>', 'codex')).toBeUndefined()
  })
})
