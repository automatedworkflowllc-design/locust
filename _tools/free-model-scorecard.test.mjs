import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

import {
  evaluateModelVerdict,
  extractTextFromOpenCodeOutput,
  parseFreeModels,
  verifyJobA,
  verifyJobB,
  verifyJobC
} from './free-model-scorecard.mjs'

test('parseFreeModels extracts only models ending with -free', () => {
  const sample = [
    'opencode/big-pickle',
    'opencode/fledge-alpha-free',
    'opencode/muse-spark-1.3-contributor-free',
    'anthropic/claude-3-5-sonnet',
    'opencode/space-bunny-free',
    'custom-model-free-suffix'
  ].join('\n')

  const parsed = parseFreeModels(sample)
  assert.deepEqual(parsed, [
    'opencode/fledge-alpha-free',
    'opencode/muse-spark-1.3-contributor-free',
    'opencode/space-bunny-free'
  ])
})

test('extractTextFromOpenCodeOutput parses JSON event stream text', () => {
  const stream = [
    JSON.stringify({ type: 'step_start', timestamp: 100 }),
    JSON.stringify({ type: 'text', part: { type: 'text', text: 'First line.' } }),
    JSON.stringify({ type: 'tool_use', part: { type: 'tool' } }),
    JSON.stringify({ type: 'text', part: { type: 'text', text: 'Second line.' } }),
    JSON.stringify({ type: 'step_finish', part: { reason: 'stop' } })
  ].join('\n')

  const extracted = extractTextFromOpenCodeOutput(stream)
  assert.equal(extracted, 'First line.\nSecond line.')
})

test('verifyJobC: a job that wrote a file but answered wrong is not a pass (with control)', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'scorecard-jobc-'))
  try {
    // Simulate that the job wrote/modified files on disk
    writeFileSync(join(tempDir, 'notes.txt'), 'Checked config.json port value', 'utf8')
    writeFileSync(join(tempDir, 'config.json'), '{"port": 8080}', 'utf8')

    // 1. Model output answered wrong (e.g. port 3000): MUST NOT pass
    const wrongOutput = JSON.stringify({
      type: 'text',
      part: { type: 'text', text: 'The service is configured to run on port 3000.' }
    })
    const failRes = verifyJobC(wrongOutput, tempDir)
    assert.equal(failRes.passed, false, 'Job that answered wrong port must not pass even if files were written')
    assert.match(failRes.why, /8080/)

    // 2. Control: Model output answered correctly (port 8080): MUST pass
    const correctOutput = JSON.stringify({
      type: 'text',
      part: { type: 'text', text: 'The service runs on port 8080.' }
    })
    const passRes = verifyJobC(correctOutput, tempDir)
    assert.equal(passRes.passed, true, 'Control: Job that answered correct port 8080 must pass')
    assert.match(passRes.why, /8080/)

    // 3. Control: Empty or irrelevant response: MUST NOT pass
    const emptyRes = verifyJobC('', tempDir)
    assert.equal(emptyRes.passed, false, 'Control: Empty response must not pass')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('evaluateModelVerdict classifies good, slow, and failing models with controls', () => {
  const fastJobResults = [
    { id: 'write_file', passed: true, durationMs: 15000, why: 'ok' },
    { id: 'fix_bug', passed: true, durationMs: 18000, why: 'ok' },
    { id: 'answer_question', passed: true, durationMs: 12000, why: 'ok' }
  ]
  const goodVerdict = evaluateModelVerdict('opencode/fast-model-free', fastJobResults)
  assert.equal(goodVerdict.state, 'good')
  assert.equal(goodVerdict.passedCount, 3)
  assert.equal(goodVerdict.totalCount, 3)

  const slowJobResults = [
    { id: 'write_file', passed: true, durationMs: 65000, why: 'ok' },
    { id: 'fix_bug', passed: true, durationMs: 70000, why: 'ok' },
    { id: 'answer_question', passed: true, durationMs: 80000, why: 'ok' }
  ]
  const slowVerdict = evaluateModelVerdict('opencode/slow-model-free', slowJobResults)
  assert.equal(slowVerdict.state, 'slow')
  assert.equal(slowVerdict.passedCount, 3)

  // One job failed (e.g. Job C wrote file but answered wrong)
  const failedJobResults = [
    { id: 'write_file', passed: true, durationMs: 15000, why: 'ok' },
    { id: 'fix_bug', passed: true, durationMs: 18000, why: 'ok' },
    { id: 'answer_question', passed: false, durationMs: 12000, why: 'Answer did not contain expected port 8080' }
  ]
  const failingVerdict = evaluateModelVerdict('opencode/imperfect-model-free', failedJobResults)
  assert.equal(failingVerdict.state, 'failing')
  assert.equal(failingVerdict.passedCount, 2)
  assert.deepEqual(failingVerdict.failedJobs, ['answer_question'])

  // Control check: A model with any failure can never be marked good or slow
  assert.notEqual(failingVerdict.state, 'good')
  assert.notEqual(failingVerdict.state, 'slow')

  // Control check: All 0 jobs passed
  const zeroVerdict = evaluateModelVerdict('opencode/broken-model-free', [
    { id: 'write_file', passed: false, durationMs: 5000, why: 'error' },
    { id: 'fix_bug', passed: false, durationMs: 5000, why: 'error' },
    { id: 'answer_question', passed: false, durationMs: 5000, why: 'error' }
  ])
  assert.equal(zeroVerdict.state, 'failing')
  assert.equal(zeroVerdict.passedCount, 0)
})

test('verifyJobA checks greeting.txt content strictly', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'scorecard-joba-'))
  try {
    assert.equal(verifyJobA(tempDir).passed, false) // no file

    writeFileSync(join(tempDir, 'greeting.txt'), 'Hello from OpenCode', 'utf8')
    assert.equal(verifyJobA(tempDir).passed, true) // exact content

    writeFileSync(join(tempDir, 'greeting.txt'), 'Hello world', 'utf8')
    assert.equal(verifyJobA(tempDir).passed, false) // wrong content
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
