import { describe, expect, it } from 'vitest'

import APP from './App.tsx?raw'
import VIEWER from './components/FileViewer.tsx?raw'

/**
 * L21 (the code review): the viewer kept its selected version across files,
 * so opening another file showed it on the previous file's turn -- or on a
 * turn it does not have. Keyed by path, a new file starts on itself; the
 * diff is keyed by the version, so its folds reset between versions.
 */
describe('the file viewer', () => {
  it('starts afresh for each file, and each version', () => {
    expect(APP).toMatch(/<FileViewer\s+(?:\/\/[^\n]*\s+)*key=\{viewingFile\.path\}/)
    expect(VIEWER).toContain('<DiffView key={showing}')
  })
})
