import { describe, expect, it } from 'vitest'

import { entries, entryFor } from './changelog.js'

/**
 * The app can say what changed in the build that is running.
 *
 * Read from the file that ships with it, so the notes and the bytes were
 * packaged together and cannot describe a different build.
 */

const NL = String.fromCharCode(10)
const FILE = [
  '# Changelog',
  '',
  'What changed in each build, written for someone using Locust.',
  '',
  '## 0.176.0 - 2026-09-17',
  '',
  '- **Settings is a list of pages.** Not one long scroll.',
  '- Search finds a setting by its own name.',
  '',
  '## 0.175.0 - 2026-09-17',
  '',
  '- **Deleting a conversation can be undone.**',
  '',
  '## 0.9.2',
  '',
  '- The first one, with no date on it.',
  ''
].join(NL)

describe('reading the changelog', () => {
  it('finds every entry, newest first, in the order the file writes them', () => {
    expect(entries(FILE).map((entry) => entry.version)).toEqual(['0.176.0', '0.175.0', '0.9.2'])
  })

  it('gives an entry its body and not its heading', () => {
    const entry = entryFor(FILE, '0.175.0')
    expect(entry?.date).toBe('2026-09-17')
    expect(entry?.body).toBe('- **Deleting a conversation can be undone.**')
    expect(entry?.body).not.toContain('##')
    // And not the next entry's text, which is the mistake a greedy match makes.
    expect(entry?.body).not.toContain('first one')
  })

  it('keeps a multi-line entry whole', () => {
    const entry = entryFor(FILE, '0.176.0')
    expect(entry?.body.split(NL)).toEqual([
      '- **Settings is a list of pages.** Not one long scroll.',
      '- Search finds a setting by its own name.'
    ])
  })

  it('reads an entry with no date', () => {
    expect(entryFor(FILE, '0.9.2')).toMatchObject({ version: '0.9.2', body: '- The first one, with no date on it.' })
    expect(entryFor(FILE, '0.9.2')?.date).toBeUndefined()
  })

  it('says nothing for a version the file does not carry', () => {
    // A build newer than the changelog is a build whose entry was not written.
    // Saying nothing is the truthful answer; inventing the nearest one is not.
    expect(entryFor(FILE, '0.177.0')).toBeUndefined()
    expect(entryFor(FILE, '')).toBeUndefined()
  })

  it('reads an empty or headingless file as no entries at all', () => {
    expect(entries('')).toEqual([])
    expect(entries('# Changelog' + NL + NL + 'Nothing yet.')).toEqual([])
  })

  it('is not fooled by a version-looking line inside an entry', () => {
    const tricky = ['## 1.0.0 - 2026-01-01', '', 'Mentions 2.0.0 in passing, and ## not a heading here.', ''].join(NL)
    expect(entries(tricky).map((entry) => entry.version)).toEqual(['1.0.0'])
    expect(entryFor(tricky, '1.0.0')?.body).toContain('Mentions 2.0.0')
  })
})
