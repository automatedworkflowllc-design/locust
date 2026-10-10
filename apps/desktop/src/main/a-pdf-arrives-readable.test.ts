import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readablePdfNote, splitAttachments, withAttachments } from '../shared/attachments.js'
import { attachmentsForRun } from './attachments-for-run.js'
import { createPdfReadings, readablePdf } from './pdf-reading.js'
import type { PdfReading, ReadPdf } from './pdf-reading.js'

/*
 * AN ATTACHED PDF ARRIVES READABLE (0.713). A tester attached his homework to
 * a Codex conversation on 0.712: Codex's PDF skill wanted Python packages his
 * machine did not have, the sandbox stopped pip from fetching them, and eight
 * commands later (four failed) it decoded the file by hand -- 1m 39s, against
 * 33 s in Codex's own app. Locust now opens the PDF itself, the same way for
 * every runtime: its text and a picture of each page, beside the attachment
 * in Locust's own folder, named in the message. The drive is
 * _tools/drive-a-pdf-arrives-readable.mjs; this holds the pieces, and
 * renderer/src/a-pdf-page-reads-in-order.test.ts the text's order.
 */

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-pdf-readable-'))
  roots.push(root)
  await mkdir(join(root, '.locust', 'attachments'), { recursive: true })
  return root
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
/** A reader that says what it was given and counts its calls. */
function fakeReader(reading: PdfReading = { pages: 2, text: ['Page one words', 'Page two words'], pictures: [PNG, PNG] }): ReadPdf & { calls: number } {
  const read = (async () => {
    read.calls += 1
    return reading
  }) as unknown as ReadPdf & { calls: number }
  read.calls = 0
  return read
}

describe('what the agent is told', () => {
  it('names the text and the pictures, and says no tool is needed', () => {
    const note = readablePdfNote([
      { pdf: '.locust/attachments/Homework 5.pdf', text: '.locust/attachments/Homework 5.pdf.txt', pictures: ['.locust/attachments/Homework 5.pdf-pages/page-01.png', '.locust/attachments/Homework 5.pdf-pages/page-02.png'], pages: 2 }
    ])
    expect(note).toContain('no PDF tool or package is needed')
    expect(note).toContain('its text is in .locust/attachments/Homework 5.pdf.txt')
    expect(note).toContain('each of its 2 pages is a picture, .locust/attachments/Homework 5.pdf-pages/page-01.png to page-02.png')
    expect(note).toContain('For equations, tables, charts and layout, look at the pictures')
  })

  it('says when only the first pages are pictures, and when there is no text at all', () => {
    const pictures = Array.from({ length: 30 }, (_, index) => `.locust/attachments/Book.pdf-pages/page-${String(index + 1).padStart(2, '0')}.png`)
    expect(readablePdfNote([{ pdf: 'Book.pdf', text: 'Book.pdf.txt', pictures, pages: 120 }])).toContain('its first 30 of 120 pages are pictures')
    expect(readablePdfNote([{ pdf: 'Scan.pdf', pictures: ['Scan.pdf-pages/page-01.png'], pages: 1 }])).toContain('it has no text in it (scanned pages), so read the pictures; its page is a picture: Scan.pdf-pages/page-01.png')
    expect(readablePdfNote([])).toBeUndefined()
  })

  it('sits between the file list and the person’s words, and only in what is sent', () => {
    const sent = withAttachments('Explain problem 3.', ['.locust/attachments/Homework 5.pdf'], 'NOTE')
    expect(sent).toBe('Read this file in the workspace before you answer:\n- .locust/attachments/Homework 5.pdf\n\nNOTE\n\nExplain problem 3.')
    // The recorded prompt carries no note, so the bubble reads as it always did.
    expect(splitAttachments(withAttachments('Explain problem 3.', ['.locust/attachments/Homework 5.pdf']))).toEqual({ text: 'Explain problem 3.', attachments: ['.locust/attachments/Homework 5.pdf'] })
  })
})

describe('the PDF, opened beside the attachment', () => {
  it('writes the text with each page under its number, and one picture a page', async () => {
    const root = await folder()
    await writeFile(join(root, '.locust', 'attachments', 'Homework 5.pdf'), '%PDF-1.5 fake')
    const read = fakeReader()
    const readable = await readablePdf(root, '.locust/attachments/Homework 5.pdf', 'Homework 5.pdf', read)
    expect(readable).toEqual({
      pdf: '.locust/attachments/Homework 5.pdf',
      text: '.locust/attachments/Homework 5.pdf.txt',
      pictures: ['.locust/attachments/Homework 5.pdf-pages/page-01.png', '.locust/attachments/Homework 5.pdf-pages/page-02.png'],
      pages: 2
    })
    const text = await readFile(join(root, '.locust', 'attachments', 'Homework 5.pdf.txt'), 'utf8')
    // A byte-order mark, so Windows PowerShell reads it as UTF-8.
    expect(text.startsWith('﻿Homework 5.pdf, 2 pages: the text Locust read out of it.')).toBe(true)
    expect(text).toContain('--- Page 1 ---\nPage one words\n\n--- Page 2 ---\nPage two words')
    expect((await readdir(join(root, '.locust', 'attachments', 'Homework 5.pdf-pages'))).filter((name) => name.endsWith('.png'))).toEqual(['page-01.png', 'page-02.png'])
  })

  it('reads the same PDF once, and again when it changes', async () => {
    const root = await folder()
    const pdf = join(root, '.locust', 'attachments', 'notes.pdf')
    await writeFile(pdf, '%PDF one')
    const read = fakeReader()
    await readablePdf(root, '.locust/attachments/notes.pdf', 'notes.pdf', read)
    await readablePdf(root, '.locust/attachments/notes.pdf', 'notes.pdf', read)
    expect(read.calls).toBe(1)
    await writeFile(pdf, '%PDF two')
    await readablePdf(root, '.locust/attachments/notes.pdf', 'notes.pdf', read)
    expect(read.calls).toBe(2)
  })

  it('a scan has pictures and no text file', async () => {
    const root = await folder()
    await writeFile(join(root, '.locust', 'attachments', 'scan.pdf'), '%PDF scan')
    const readable = await readablePdf(root, '.locust/attachments/scan.pdf', 'scan.pdf', fakeReader({ pages: 1, text: ['  '], pictures: [PNG] }))
    expect(readable?.text).toBeUndefined()
    expect(readable?.pictures).toEqual(['.locust/attachments/scan.pdf-pages/page-01.png'])
  })

  it('Send waits for the reading the attach button started, rather than starting a second', async () => {
    const root = await folder()
    await writeFile(join(root, '.locust', 'attachments', 'a.pdf'), '%PDF a')
    let release: () => void = () => undefined
    let calls = 0
    const slow: ReadPdf = async () => {
      calls += 1
      await new Promise<void>((resolve) => { release = resolve })
      return { pages: 1, text: ['words'], pictures: [PNG] }
    }
    const readings = createPdfReadings(slow)
    const attached = readings.prepare(root, '.locust/attachments/a.pdf', 'a.pdf')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const sending = readings.prepare(root, '.locust/attachments/a.pdf', 'a.pdf')
    release()
    expect(await sending).toEqual(await attached)
    expect(calls).toBe(1)
  })
})

describe('the message a run is sent', () => {
  it('a run in the project folder is told where the PDF’s text and pictures are', async () => {
    const root = await folder()
    await writeFile(join(root, '.locust', 'attachments', 'Homework 5.pdf'), '%PDF hw')
    const read = fakeReader()
    const prompt = withAttachments('Explain problem 3.', ['.locust/attachments/Homework 5.pdf'])
    const sent = await attachmentsForRun(prompt, root, root, (where, pdf, name) => readablePdf(where, pdf, name, read))
    expect(sent.startsWith('Read this file in the workspace before you answer:\n- .locust/attachments/Homework 5.pdf\n\nLocust has already opened the PDF for you')).toBe(true)
    expect(sent).toContain('.locust/attachments/Homework 5.pdf.txt')
    expect(sent.endsWith('\n\nExplain problem 3.')).toBe(true)
  })

  it('a project PDF a worktree is sent is opened in the worktree’s own folder', async () => {
    const root = await folder()
    const tree = join(root, '.locust', 'worktrees', 'tm_wren')
    await mkdir(tree, { recursive: true })
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs', 'spec.pdf'), '%PDF spec')
    const sent = await attachmentsForRun(withAttachments('Summarize.', ['docs/spec.pdf']), root, tree, (where, pdf, name) => readablePdf(where, pdf, name, fakeReader()))
    expect(sent).toContain('- .locust/attachments/spec.pdf\n')
    expect(sent).toContain('its text is in .locust/attachments/spec.pdf.txt')
    expect(await readFile(join(tree, '.locust', 'attachments', 'spec.pdf.txt'), 'utf8')).toContain('Page one words')
  })

  it('a PDF that cannot be read is sent as it was, and other files are left alone', async () => {
    const root = await folder()
    await writeFile(join(root, '.locust', 'attachments', 'broken.pdf'), '%PDF broken')
    await writeFile(join(root, 'NOTES.md'), 'notes')
    const prompt = withAttachments('Read these.', ['NOTES.md', '.locust/attachments/broken.pdf'])
    const failing: ReadPdf = () => Promise.reject(new Error('Invalid PDF structure.'))
    expect(await attachmentsForRun(prompt, root, root, (where, pdf, name) => readablePdf(where, pdf, name, failing))).toBe(prompt)
    expect(await attachmentsForRun(withAttachments('Read it.', ['NOTES.md']), root, root, (where, pdf, name) => readablePdf(where, pdf, name, fakeReader()))).toBe(withAttachments('Read it.', ['NOTES.md']))
  })
})
