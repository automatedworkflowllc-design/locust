import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SETTINGS_PAGES_FILE = join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src', 'settingsPages.ts')
const TOOLS_DIR = join(ROOT, '_tools')

export function getValidSettingsPages(tsFile = SETTINGS_PAGES_FILE) {
  const source = readFileSync(tsFile, 'utf8')
  const labels = []
  const regex = /label:\s*(?:"([^"]+)"|'([^']+)')/g
  let match
  while ((match = regex.exec(source)) !== null) {
    labels.push(match[1] || match[2])
  }
  return new Set(labels)
}

function extractStrings(str) {
  const result = []
  const regex = /(?:"([^"]+)"|'([^']+)')/g
  let m
  while ((m = regex.exec(str)) !== null) {
    result.push(m[1] || m[2])
  }
  return result
}

export function extractDriveSettingsPages(dir = TOOLS_DIR) {
  const driveFiles = readdirSync(dir).filter(
    (f) => f.startsWith('drive-') && f.endsWith('.mjs') && !f.includes('.test.')
  )
  const references = []

  for (const file of driveFiles) {
    const content = readFileSync(join(dir, file), 'utf8')
    const lines = content.split('\n')

    lines.forEach((line, idx) => {
      const lineNum = idx + 1
      const trimmed = line.trim()
      if (trimmed.startsWith('//')) return

      // 1. settingsPage('Page Name')
      const spRegex = /settingsPage\(\s*(?:"([^"]+)"|'([^']+)')\s*\)/g
      let spMatch
      while ((spMatch = spRegex.exec(line)) !== null) {
        references.push({ file, line: lineNum, page: spMatch[1] || spMatch[2], raw: trimmed })
      }

      // 2. Navitem or Settings button clicks by text
      if (line.includes('lc-settings__navitem') || line.includes('.lc-settings button') || line.includes('.lc-settings a')) {
        const eqRegex = /(?:===|\.startsWith\()\s*(?:"([^"]+)"|'([^']+)')/g
        let eqMatch
        while ((eqMatch = eqRegex.exec(line)) !== null) {
          const val = (eqMatch[1] || eqMatch[2]).trim()
          if (val && !val.includes('lc-') && !val.includes('button') && val.length > 2) {
            references.push({ file, line: lineNum, page: val, raw: trimmed })
          }
        }
        const incMatch = line.match(/\[([^\]]+)\]\.includes\(/)
        if (incMatch) {
          for (const item of extractStrings(incMatch[1])) {
            references.push({ file, line: lineNum, page: item, raw: trimmed })
          }
        }
      }

      // 3. In Settings context: button find for page navigation (e.g. 'Your own models')
      if (line.includes('Your own models') && line.includes('find(')) {
        references.push({ file, line: lineNum, page: 'Your own models', raw: trimmed })
      }

      // 4. Page list loops in settings drives
      if (line.includes('for (const page of [') || (line.includes('const PAGES = [') && file.includes('settings'))) {
        const match = line.match(/\[([^\]]+)\]/)
        if (match) {
          for (const p of extractStrings(match[1])) {
            references.push({ file, line: lineNum, page: p, raw: trimmed })
          }
        }
      }
    })
  }

  return references
}

test('every Settings page named by a drive exists in settingsPages.ts', () => {
  const validPages = getValidSettingsPages()
  assert.ok(validPages.size > 0, 'settingsPages.ts should declare settings pages')

  const references = extractDriveSettingsPages()
  assert.ok(references.length > 0, 'should extract settings page references from drives')

  const unknown = references.filter((ref) => !validPages.has(ref.page))
  if (unknown.length > 0) {
    const details = unknown.map((u) => `${u.file}:${String(u.line)} -> "${u.page}" in: ${u.raw}`).join('\n')
    assert.fail(`Found ${String(unknown.length)} drive reference(s) to unknown Settings page(s):\n${details}\nValid pages: ${[...validPages].join(', ')}`)
  }
})
