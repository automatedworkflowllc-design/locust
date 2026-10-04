import { describe, expect, it } from 'vitest'

import { extensionOf, isViewableText, MAX_TEXT_BYTES, viewerMode } from './text-files.js'

/**
 * What the file viewer will open, and how it draws it.
 *
 * The viewer exists because a teammate writes you a report and the most the
 * app could do was put a file manager in front of it (Colin, 2026-09-20). It
 * reads files a MODEL wrote, so what it will and will not open is a real
 * decision rather than a convenience.
 */

describe('which files the viewer opens', () => {
  it('opens what a teammate actually writes', () => {
    for (const path of ['docs/report.md', 'notes.txt', 'src/index.ts', 'data.json', 'run.log']) {
      expect(isViewableText(path), path).toBe(true)
    }
  })

  it('refuses what it cannot honestly draw', () => {
    // An allowlist, not a binary sniff: guessing wrong renders a megabyte of
    // machine code as mojibake in a panel.
    for (const path of ['photo.png', 'app.exe', 'archive.zip', 'font.woff2', 'video.mp4']) {
      expect(isViewableText(path), path).toBe(false)
    }
  })

  it('reads a dotfile as its own extension', () => {
    // `.gitignore` has no second dot, and treating the whole name as the
    // extension is the only reading that opens it.
    expect(extensionOf('.gitignore')).toBe('gitignore')
    expect(isViewableText('.gitignore')).toBe(true)
    expect(extensionOf('notes')).toBe('')
    expect(isViewableText('notes')).toBe(false)
  })

  it('is not fooled by a dot in a folder name', () => {
    expect(extensionOf('my.folder/report.md')).toBe('md')
    expect(extensionOf('my.folder/README')).toBe('')
  })

  it('takes a Windows path as readily as a posix one', () => {
    expect(extensionOf('docs\\report.md')).toBe('md')
  })
})

describe('how it draws them', () => {
  it('draws markdown as prose, through the renderer a reply already uses', () => {
    expect(viewerMode('docs/report.md')).toBe('markdown')
    expect(viewerMode('README.markdown')).toBe('markdown')
  })

  it('draws everything else as code', () => {
    // A `.ts` file rendered as Markdown would eat its own asterisks.
    expect(viewerMode('src/index.ts')).toBe('code')
    expect(viewerMode('run.log')).toBe('code')
    expect(viewerMode('data.json')).toBe('code')
  })
})

describe('the bound', () => {
  it('is big enough for anything written to be read, and not for a runaway log', () => {
    expect(MAX_TEXT_BYTES).toBe(262_144)
  })
})
