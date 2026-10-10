import { describe, expect, it } from 'vitest'

import { countOf, treeOf } from './components/ChangesPanel.js'
import { parseUnifiedDiff } from './diff.js'

/*
 * THE CHANGES PANEL (0.732): the files as folders, each with what it added and removed, as Claude Code's tree.
 */
const diff = [
  'diff --git a/src/cart.py b/src/cart.py',
  '--- a/src/cart.py',
  '+++ b/src/cart.py',
  '@@ -1,2 +1,3 @@',
  ' def total(items):',
  '-    return 0',
  '+    return sum(items)',
  '+',
  'diff --git a/src/shop/price.py b/src/shop/price.py',
  '--- a/src/shop/price.py',
  '+++ b/src/shop/price.py',
  '@@ -1 +1 @@',
  '-PRICE = 1',
  '+PRICE = 2',
  'diff --git a/README.md b/README.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/README.md',
  '@@ -0,0 +1 @@',
  '+# Shop'
].join('\n')

describe('the changes panel', () => {
  const files = parseUnifiedDiff(diff)

  it('counts each file’s added and removed lines', () => {
    expect(files.map((file) => [file.path, countOf(file)])).toEqual([
      ['src/cart.py', { added: 2, removed: 1 }],
      ['src/shop/price.py', { added: 1, removed: 1 }],
      ['README.md', { added: 1, removed: 0 }]
    ])
  })

  it('groups them by folder, each folder’s own files under it', () => {
    const root = treeOf(files)
    expect(root.files.map((file) => file.path)).toEqual(['README.md'])
    const src = root.folders.get('src')!
    expect(src.files.map((file) => file.path)).toEqual(['src/cart.py'])
    expect([...src.folders.keys()]).toEqual(['shop'])
    expect(src.folders.get('shop')!.files.map((file) => file.path)).toEqual(['src/shop/price.py'])
  })
})
