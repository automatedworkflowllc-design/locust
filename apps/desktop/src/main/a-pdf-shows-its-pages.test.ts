import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import type { ReadablePdf } from '../shared/attachments.js'
import { readPdfPages } from './pdf-pages.js'

/*
 * A PDF SHOWS ITS PAGES (0.714): the chat's card and the viewer ask the host
 * for the pictures Locust drew of an attached PDF. The image handler's
 * question, asked the same way: only a PDF inside the folder asked about,
 * on disk too; a path is a request, never an instruction.
 */
const roots: string[] = []
afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-pdf-pages-'))
  roots.push(root)
  await mkdir(join(root, '.locust', 'attachments'), { recursive: true })
  await writeFile(join(root, '.locust', 'attachments', 'Homework 5.pdf'), '%PDF-1.5 fake')
  await writeFile(join(root, 'notes.txt'), 'words')
  return root
}

const prepared: string[] = []
const prepare = async (where: string, pdf: string, name: string): Promise<ReadablePdf> => {
  prepared.push(`${pdf}|${name}`)
  return { pdf, text: `.locust/attachments/${name}.txt`, pictures: [`.locust/attachments/${name}-pages/page-01.png`], pages: 2 }
}

describe('an attached PDF’s pages, for the window', () => {
  it('reads a PDF in the folder, by its place in the folder, and answers its pictures', async () => {
    const root = await folder()
    const answer = await readPdfPages('.locust/attachments/Homework 5.pdf', root, [root], prepare)
    expect(answer).toEqual({ ok: true, pages: 2, pictures: ['.locust/attachments/Homework 5.pdf-pages/page-01.png'], text: '.locust/attachments/Homework 5.pdf.txt' })
    expect(prepared.at(-1)).toBe('.locust/attachments/Homework 5.pdf|Homework 5.pdf')
    // The viewer passes the whole path; it is the same file.
    expect((await readPdfPages(join(root, '.locust', 'attachments', 'Homework 5.pdf'), root, [root], prepare)).ok).toBe(true)
  })

  it('refuses what is not a PDF, what is outside the folder, and anything that is not a local path', async () => {
    const root = await folder()
    const elsewhere = await folder()
    expect(await readPdfPages('notes.txt', root, [root], prepare)).toEqual({ ok: false, message: 'Not a PDF.' })
    expect((await readPdfPages('../outside.pdf', root, [root], prepare)).ok).toBe(false)
    expect((await readPdfPages(join(elsewhere, '.locust', 'attachments', 'Homework 5.pdf'), root, [root], prepare)).ok).toBe(false)
    expect((await readPdfPages('https://example.com/a.pdf', root, [root], prepare)).ok).toBe(false)
    expect((await readPdfPages('\\\\server\\share\\a.pdf', root, [root], prepare)).ok).toBe(false)
    // A folder the host does not count as its own is no folder at all.
    expect((await readPdfPages('.locust/attachments/Homework 5.pdf', root, [elsewhere], prepare)).ok).toBe(false)
  })

  it('says so when the PDF cannot be read, and when it is not there', async () => {
    const root = await folder()
    expect(await readPdfPages('.locust/attachments/Homework 5.pdf', root, [root], async () => undefined)).toEqual({ ok: false, message: 'Locust could not read that PDF.' })
    expect((await readPdfPages('.locust/attachments/missing.pdf', root, [root], prepare)).ok).toBe(false)
  })
})
