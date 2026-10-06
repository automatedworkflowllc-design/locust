import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import {
  evaluateModelVerdict,
  evaluateJobResult,
  extractTextFromOpenCodeOutput,
  parseFreeModels,
  providerLimitFromLine,
  runOpenCodeJob,
  verifyJobA,
  verifyJobB,
  verifyJobC
} from './free-model-scorecard.mjs'

const providerWords = 'Rate limit exceeded. Please try again later.'
const limitLog = `timestamp=2026-09-26T18:27:20.168Z level=ERROR message="stream error" providerID=opencode modelID=example-free agent=build error.error="AI_APICallError: ${providerWords}"`

test('a recorded provider limit is rate-limited with its words and detection time', () => {
  const limit = providerLimitFromLine(limitLog, 'stderr')
  assert.equal(limit.message, providerWords)
  assert.equal(limit.source, 'stderr')
  assert.ok(Number.isFinite(Date.parse(limit.detectedAt)))
  const job = { id: 'write_file', verify: () => ({ passed: true, why: 'ok' }) }
  const result = evaluateJobResult(job, { rateLimit: limit, timedOut: true, status: 1 }, '', 10)
  assert.equal(result.passed, false)
  assert.equal(result.why, providerWords)
  const verdict = evaluateModelVerdict('opencode/example-free', [{ ...result, id: job.id, durationMs: 10, rateLimit: limit }])
  assert.equal(verdict.state, 'rate-limited')
  assert.deepEqual(verdict.rateLimitedJobs, ['write_file'])
  assert.deepEqual(verdict.failedJobs, [])
  assert.deepEqual(verdict.jobDetails.write_file.rateLimit, limit)
})

test('a plain timeout remains failing and a verified pass remains good', () => {
  const job = { id: 'write_file', verify: () => ({ passed: true, why: 'ok' }) }
  const timeout = evaluateJobResult(job, { timedOut: true, status: null }, '', 10)
  assert.equal(timeout.passed, false)
  assert.match(timeout.why, /Timed out/)
  assert.equal(evaluateModelVerdict('opencode/example-free', [{ ...timeout, id: job.id, durationMs: 10 }]).state, 'failing')
  const pass = evaluateJobResult(job, { timedOut: false, status: 0, stdout: '' }, '', 10)
  assert.equal(pass.passed, true)
  assert.equal(evaluateModelVerdict('opencode/example-free', [{ ...pass, id: job.id, durationMs: 10 }]).state, 'good')
  assert.equal(evaluateJobResult(job, { status: 1 }, '', 10).passed, false)
})

test('only provider errors count as limits, including JSON quota errors', () => {
  assert.equal(providerLimitFromLine(limitLog.replace('agent=build', 'agent=title'), 'stderr'), undefined)
  assert.equal(providerLimitFromLine(JSON.stringify({ type: 'text', part: { text: providerWords } }), 'stdout'), undefined)
  assert.equal(providerLimitFromLine(JSON.stringify({ type: 'tool_use', part: { output: providerWords } }), 'stdout'), undefined)
  assert.equal(providerLimitFromLine(limitLog.replace(providerWords, 'Provider unavailable'), 'stderr'), undefined)
  assert.equal(providerLimitFromLine('Rate limit exceeded', 'stderr'), undefined)
  const quota = providerLimitFromLine(JSON.stringify({ type: 'error', error: { data: { message: 'Quota exhausted for this model' } } }), 'stdout')
  assert.equal(quota.message, 'Quota exhausted for this model')
  const statusLimit = providerLimitFromLine(JSON.stringify({ type: 'error', error: { data: { statusCode: 429, message: 'Please wait before trying again' } } }), 'stdout')
  assert.equal(statusLimit.message, 'Please wait before trying again')
  const quoted = providerLimitFromLine(limitLog.replace(`"AI_APICallError: ${providerWords}"`, JSON.stringify('AI_APICallError: Rate limit exceeded for "free"')), 'stderr')
  assert.equal(quoted.message, 'Rate limit exceeded for "free"')
  const mixed = evaluateModelVerdict('opencode/example-free', [
    { id: 'write_file', passed: false, durationMs: 1, why: 'bad file' },
    { id: 'fix_bug', passed: false, durationMs: 1, why: quota.message, rateLimit: quota }
  ])
  assert.equal(mixed.state, 'failing', 'A real failure is not hidden by a different limited job')
})

function fakeProcess() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  return child
}

test('a split live limit stops the job before its timeout and waits for close', async () => {
  const child = fakeProcess()
  let stops = 0
  let finished = false
  const run = runOpenCodeJob({ model: 'opencode/example-free', prompt: 'hello', timeoutMs: 1000 }, {
    spawnProcess: (_command, args) => {
      assert.ok(args.includes('--print-logs'))
      assert.ok(args.includes('ERROR'))
      return child
    },
    stopProcess: () => { stops += 1 }
  }).then((result) => { finished = true; return result })
  child.stderr.write(limitLog.slice(0, 100))
  assert.equal(stops, 0)
  child.stderr.write(limitLog.slice(100) + '\n')
  assert.equal(stops, 1)
  await Promise.resolve()
  assert.equal(finished, false, 'Termination must be observed before returning')
  child.emit('close', null)
  const result = await run
  assert.equal(result.timedOut, false)
  assert.equal(result.rateLimit.message, providerWords)
  assert.equal(stops, 1)
})

test('live timeout, successful output, and an unterminated limit have separate outcomes', async () => {
  for (const mode of ['timeout', 'pass', 'limit-tail', 'json-limit']) {
    const child = fakeProcess()
    let stops = 0
    const run = runOpenCodeJob({ model: 'opencode/example-free', prompt: 'hello', timeoutMs: 15 }, {
      spawnProcess: () => child,
      stopProcess: () => { stops += 1; setImmediate(() => child.emit('close', null)) }
    })
    if (mode === 'pass') {
      child.stdout.write(JSON.stringify({ type: 'text', part: { text: 'The service runs on port 8080.' } }) + '\n')
      child.emit('close', 0)
    } else if (mode === 'limit-tail') {
      child.stderr.write(limitLog)
    } else if (mode === 'json-limit') {
      child.stdout.write(JSON.stringify({ type: 'error', error: { data: { message: providerWords } } }) + '\n')
    }
    const result = await run
    assert.equal(result.timedOut, mode === 'timeout')
    assert.equal(result.rateLimit !== undefined, mode === 'limit-tail' || mode === 'json-limit')
    assert.equal(stops, mode === 'pass' ? 0 : 1)
    if (mode === 'pass') assert.equal(verifyJobC(result.stdout, '').passed, true)
  }
})

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
