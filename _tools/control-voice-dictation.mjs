// Four reversible negative controls; one test file at a time, no full gate.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const desktop = resolve('apps/desktop')
const main = 'src/main/voice-typing-refuses-unchecked-files.test.ts'
const ui = 'src/renderer/src/voice-typing-is-editable-and-cancellable.test.tsx'
const cases = [
  ['SHA-256', 'src/main/voice-host.ts', 'size !== asset.bytes || hash.digest(\'hex\') !== asset.sha256', 'size !== asset.bytes', main, 'refuses and deletes a SHA-256 mismatch'],
  ['timeout', 'src/main/voice-host.ts', 'timeout: options.timeoutMs ?? 120_000', 'timeout: 0', main, 'stops a hung executable at its time limit'],
  ['Windows-only', 'src/renderer/src/components/VoiceButton.tsx', "if (platform !== 'win32') return null", 'if (false) return null', ui, 'does not draw a microphone'],
  ['Escape discards late text', 'src/renderer/src/components/VoiceButton.tsx', 'if (generation.current !== token) return', 'if (false) return', ui, 'Esc while transcription is pending']
]
for (const [name, source, before, after, test, title] of cases) {
  const path = resolve(desktop, source)
  const original = readFileSync(path, 'utf8')
  assert.ok(original.includes(before), `mutation anchor: ${name}`)
  try {
    writeFileSync(path, original.replaceAll(before, after))
    let output = ''
    try {
      execFileSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', test, '-t', title], { cwd: desktop, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
    } catch (error) { output = String(error.stdout) + String(error.stderr) }
    assert.match(output, /AssertionError|AssertionError:/, `${name}: must fail an assertion, not parsing, loading, or timing out`)
    assert.match(output, /1 failed|3 failed/, `${name}: named test must fail`)
    console.log(`PASS negative control: ${name}`)
  } finally { writeFileSync(path, original) }
}
