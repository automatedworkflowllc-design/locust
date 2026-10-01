import { copyFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { documentWords, MAX_FILES, OFFICE_WORDS_DIR, officeWordsSection } from './office-words.js'

/**
 * AN OFFICE FILE READS IN ANY MODE (0.530). Sol's 0.528 pass: a teammate in
 * Ask declined to summarise a .docx and a .pptx -- binary to its read tool,
 * and Ask withholds the shell. Locust writes the words it already reads for
 * the preview to `.locust/office-words/`, and the brief names each copy.
 */
const report = fileURLToPath(new URL('../../test/documents/report-python-docx.docx', import.meta.url))
const deck = fileURLToPath(new URL('../../test/documents/deck-python-pptx.pptx', import.meta.url))

let folder: string | undefined
afterEach(async () => {
  if (folder !== undefined) await rm(folder, { recursive: true, force: true })
  folder = undefined
})
const project = async (): Promise<string> => {
  folder = await mkdtemp(join(tmpdir(), 'locust-office-words-'))
  return folder
}

describe('an office file reads in any mode', () => {
  it('names nothing in a folder with no Word or PowerPoint file', async () => {
    const here = await project()
    await writeFile(join(here, 'notes.txt'), 'plain', 'utf8')
    expect(await officeWordsSection(here)).toBeUndefined()
  })

  it('keeps each document\'s words as text and names the copy in the brief', async () => {
    const here = await project()
    await copyFile(report, join(here, 'report.docx'))
    await mkdir(join(here, 'decks'))
    await copyFile(deck, join(here, 'decks', 'deck.pptx'))
    const section = await officeWordsSection(here)
    expect(section).toContain(`- report.docx: ${OFFICE_WORDS_DIR}/report.docx.md`)
    expect(section).toContain(`- decks/deck.pptx: ${OFFICE_WORDS_DIR}/decks/deck.pptx.md`)
    expect(section).toContain('editing a copy changes nothing in the document')
    const words = await readFile(join(here, OFFICE_WORDS_DIR, 'report.docx.md'), 'utf8')
    expect(words).toContain('# Quarterly Report')
    expect(words).toContain('| Region | Q2 | Q3 |')
    expect(words).toContain('| North | 120 | 150 |')
    expect(words).toContain('  - One of them in support')
    const slides = await readFile(join(here, OFFICE_WORDS_DIR, 'decks', 'deck.pptx.md'), 'utf8')
    expect(slides).toMatch(/## Slide 1/)
  })

  it('refreshes a copy only when its document changed', async () => {
    const here = await project()
    await copyFile(report, join(here, 'report.docx'))
    await officeWordsSection(here)
    const copy = join(here, OFFICE_WORDS_DIR, 'report.docx.md')
    await writeFile(copy, 'stale words', 'utf8')
    const later = new Date(Date.now() + 60_000)
    await utimes(copy, later, later)
    await officeWordsSection(here)
    expect(await readFile(copy, 'utf8')).toBe('stale words')
    const evenLater = new Date(Date.now() + 120_000)
    await utimes(join(here, 'report.docx'), evenLater, evenLater)
    await officeWordsSection(here)
    expect(await readFile(copy, 'utf8')).toContain('# Quarterly Report')
  })

  it('leaves out a damaged file, Word\'s lock files, and anything past the limit', async () => {
    const here = await project()
    await writeFile(join(here, 'broken.docx'), 'not a zip', 'utf8')
    await copyFile(report, join(here, '~$report.docx'))
    for (let at = 0; at < MAX_FILES + 3; at += 1) await copyFile(report, join(here, `r${String(at).padStart(2, '0')}.docx`))
    const section = await officeWordsSection(here) ?? ''
    expect(section).not.toContain('broken.docx')
    expect(section).not.toContain('~$report.docx')
    expect(section.split('\n').filter((line) => line.startsWith('- ')).length).toBeLessThanOrEqual(MAX_FILES)
    await expect(stat(join(here, OFFICE_WORDS_DIR, 'broken.docx.md'))).rejects.toThrow()
  })

  it('writes a table cell\'s pipe so it cannot split the row', () => {
    const words = documentWords('a.docx', { kind: 'word', more: 0, blocks: [{ kind: 'table', rows: [['a|b', 'c']] }] })
    expect(words).toContain('| a\\|b | c |')
  })
})
