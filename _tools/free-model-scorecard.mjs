// Benchmark OpenCode's free models (-free suffix) across three standard tasks.
//
//   node _tools/free-model-scorecard.mjs [--model <id>] [--timeout <ms>] [--scratch <dir>]
//
// Evaluates each free model in Edit mode in an isolated scratch directory:
// 1. write_file: Write greeting.txt with exact content 'Hello from OpenCode'.
// 2. fix_bug: Fix 1-line bug in math.js so node check.js passes.
// 3. answer_question: Read config.json and answer in 1 sentence what port it runs on.
//
// Verifies results from disk and output, not self-reporting.
// Outputs verdict file to scratch directory and prints a formatted summary table.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { StringDecoder } from 'node:string_decoder'

export const DEFAULT_SCRATCH = process.env.LOCUST_SCRATCH
  ? join(process.env.LOCUST_SCRATCH, 'free-model-scorecard')
  : 'D:\\work\\scratch\\free-model-scorecard'

export const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000 // 6 minutes per job

/**
 * Filter opencode models output to list of free models (-free suffix).
 */
export function parseFreeModels(output) {
  const models = []
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    const match = /^([a-z0-9][a-z0-9._-]{0,60})\/([A-Za-z0-9][A-Za-z0-9._-]{0,80})$/.exec(trimmed)
    if (match !== null && trimmed.endsWith('-free')) {
      if (!models.includes(trimmed)) {
        models.push(trimmed)
      }
    }
  }
  return models
}

/**
 * Fetch available free models using OpenCode CLI.
 */
export function getAvailableFreeModels() {
  const isWin = process.platform === 'win32'
  const res = spawnSync(isWin ? 'cmd.exe' : 'opencode', isWin ? ['/c', 'opencode', 'models'] : ['models'], { encoding: 'utf8' })
  if (res.status !== 0) {
    throw new Error(`Failed to list opencode models: ${res.stderr || res.stdout || 'exit ' + String(res.status)}`)
  }
  return parseFreeModels(res.stdout)
}

/**
 * Extract text responses from OpenCode JSON stream output.
 */
export function extractTextFromOpenCodeOutput(stdout) {
  const texts = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed.type === 'text' && parsed.part?.text) {
        texts.push(parsed.part.text)
      } else if (parsed.text) {
        texts.push(parsed.text)
      }
    } catch {
      // not JSON
    }
  }
  return texts.join('\n').trim()
}

/**
 * Run OpenCode in Edit mode with given prompt in cwd.
 */
// --print-logs forwards OpenCode's own ERROR log to stderr. The build
// agent's stream error is emitted on the first rejected provider request,
// before OpenCode waits to retry. Title-agent errors are not job evidence.
export function providerLimitFromLine(line, source) {
  let message
  let limitedStatus = false
  if (source === 'stderr') {
    if (!/message="stream error"/.test(line) || !/(?:^|\s)agent=build(?:\s|$)/.test(line)) return undefined
    const quoted = /error\.error=("(?:\\.|[^"\\])*")/.exec(line)?.[1]
    if (quoted === undefined) return undefined
    try { message = JSON.parse(quoted) } catch { return undefined }
  } else {
    try {
      const event = JSON.parse(line)
      if (event.type !== 'error') return undefined
      message = event.error?.data?.message ?? event.error?.message
      limitedStatus = event.error?.data?.statusCode === 429
    } catch { return undefined }
  }
  if (typeof message !== 'string') return undefined
  message = message.replace(/^AI_[A-Za-z]+Error:\s*/, '').trim()
  if (!limitedStatus && !/rate[\s_-]*limit|too many requests|\b429\b|quota(?:[\s_-]+(?:exceeded|exhausted|reached))?|insufficient_quota/i.test(message)) return undefined
  return { message, source, detectedAt: new Date().toISOString() }
}

function stopOpenCode(child) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGKILL')
    }
  } catch {
    // The close event still owns completion, including an already stopped child.
  }
}

export function runOpenCodeJob({ model, prompt, cwd, timeoutMs = DEFAULT_TIMEOUT_MS }, { spawnProcess = spawn, stopProcess = stopOpenCode } = {}) {
  return new Promise((resolve) => {
    const start = performance.now()
    const env = {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        permission: { external_directory: 'deny' }
      })
    }
    const isWin = process.platform === 'win32'
    const args = ['run', '--format', 'json', '--print-logs', '--log-level', 'ERROR', '-m', model, '--title', 'Locust']
    const child = spawnProcess(isWin ? 'cmd.exe' : 'opencode', isWin ? ['/c', 'opencode', ...args] : args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let rateLimit
    const buffers = { stdout: '', stderr: '' }
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }

    const inspect = (line, source) => {
      if (rateLimit !== undefined) return
      rateLimit = providerLimitFromLine(line, source)
      if (rateLimit !== undefined) {
        clearTimeout(timer)
        stopProcess(child)
      }
    }
    const consume = (chunk, source) => {
      const decoded = decoders[source].write(chunk)
      if (source === 'stdout') stdout += decoded
      else stderr += decoded
      buffers[source] += decoded
      const lines = buffers[source].split(/\r?\n/)
      buffers[source] = lines.pop()
      for (const line of lines) inspect(line, source)
    }
    const flush = () => {
      for (const source of ['stdout', 'stderr']) {
        const tail = decoders[source].end()
        if (source === 'stdout') stdout += tail
        else stderr += tail
        inspect(buffers[source] + tail, source)
        buffers[source] = ''
      }
    }

    const timer = setTimeout(() => {
      // A last log line need not end in a newline.
      for (const source of ['stdout', 'stderr']) inspect(buffers[source], source)
      if (rateLimit !== undefined) return
      timedOut = true
      stopProcess(child)
    }, timeoutMs)

    child.stdout.on('data', (chunk) => { consume(chunk, 'stdout') })
    child.stderr.on('data', (chunk) => { consume(chunk, 'stderr') })

    child.on('error', (err) => {
      clearTimeout(timer)
      const durationMs = Math.round(performance.now() - start)
      resolve({ status: -1, stdout, stderr, durationMs, timedOut: false, rateLimit, error: err.message })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      flush()
      const durationMs = Math.round(performance.now() - start)
      resolve({ status: code, stdout, stderr, durationMs, timedOut: rateLimit === undefined && timedOut, rateLimit })
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

/**
 * Job 1: Write file greeting.txt with 'Hello from OpenCode'.
 */
export function setupJobA(jobDir) {
  mkdirSync(jobDir, { recursive: true })
}

export function verifyJobA(jobDir) {
  const filePath = join(jobDir, 'greeting.txt')
  if (!existsSync(filePath)) {
    return { passed: false, why: 'File greeting.txt was not created' }
  }
  const content = readFileSync(filePath, 'utf8').trim()
  if (content !== 'Hello from OpenCode') {
    return { passed: false, why: `greeting.txt content mismatch: expected "Hello from OpenCode", got "${content.slice(0, 100)}"` }
  }
  return { passed: true, why: 'greeting.txt written with exact expected content' }
}

/**
 * Job 2: Fix 1-line bug in math.js so node check.js passes.
 */
export function setupJobB(jobDir) {
  mkdirSync(jobDir, { recursive: true })
  writeFileSync(join(jobDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2))
  writeFileSync(join(jobDir, 'math.js'), 'export function add(a, b) {\n  return a - b;\n}\n')
  writeFileSync(
    join(jobDir, 'check.js'),
    "import { add } from './math.js';\nif (add(2, 3) !== 5) {\n  console.error('Expected add(2, 3) to be 5');\n  process.exit(1);\n}\nconsole.log('PASS');\n"
  )
}

export function verifyJobB(jobDir) {
  try {
    const res = spawnSync('node', ['check.js'], { cwd: jobDir, encoding: 'utf8', timeout: 10000 })
    if (res.status === 0 && (res.stdout || '').includes('PASS')) {
      return { passed: true, why: 'node check.js passed' }
    }
    return { passed: false, why: `node check.js failed (status ${String(res.status)}): ${(res.stderr || res.stdout || '').trim().slice(0, 200)}` }
  } catch (err) {
    return { passed: false, why: `node check.js execution error: ${err.message}` }
  }
}

/**
 * Job 3: Answer question about port from config.json.
 */
export function setupJobC(jobDir) {
  mkdirSync(jobDir, { recursive: true })
  writeFileSync(
    join(jobDir, 'config.json'),
    JSON.stringify({ service: 'api-gateway', port: 8080, environment: 'production' }, null, 2)
  )
}

export function verifyJobC(stdout, _jobDir) {
  const extracted = extractTextFromOpenCodeOutput(stdout)
  const fullText = extracted || stdout || ''
  const hasPort = /\b8080\b/.test(fullText)
  if (!hasPort) {
    return {
      passed: false,
      why: 'Answer did not contain expected port 8080',
      answer: fullText.slice(0, 200)
    }
  }
  return {
    passed: true,
    why: 'Answer correctly identified port 8080',
    answer: fullText.slice(0, 200)
  }
}

export const JOBS = [
  {
    id: 'write_file',
    name: 'Write File',
    prompt: "Write a file named 'greeting.txt' in the current working directory containing exactly the following text:\nHello from OpenCode\nDo not add anything else.",
    setup: setupJobA,
    verify: (stdout, dir) => verifyJobA(dir)
  },
  {
    id: 'fix_bug',
    name: 'Fix Bug',
    prompt: "The function add(a, b) in math.js has a bug where it subtracts instead of adding. Fix math.js so that running 'node check.js' passes.",
    setup: setupJobB,
    verify: (stdout, dir) => verifyJobB(dir)
  },
  {
    id: 'answer_question',
    name: 'Answer Question',
    prompt: "Read config.json and answer this question in one sentence: What port does the service run on?",
    setup: setupJobC,
    verify: (stdout, dir) => verifyJobC(stdout, dir)
  }
]

/**
 * Classify model verdict into good | slow | failing | rate-limited.
 */
export function evaluateModelVerdict(model, jobResults) {
  const passedJobs = []
  const failedJobs = []
  const rateLimitedJobs = []
  const jobTimesMs = {}
  const jobDetails = {}
  let totalDurationMs = 0

  for (const res of jobResults) {
    jobTimesMs[res.id] = res.durationMs
    totalDurationMs += res.durationMs
    jobDetails[res.id] = {
      passed: res.passed,
      durationMs: res.durationMs,
      why: res.why,
      state: res.rateLimit !== undefined ? 'rate-limited' : res.passed ? 'passed' : 'failed',
      rateLimit: res.rateLimit
    }
    if (res.passed) {
      passedJobs.push(res.id)
    } else if (res.rateLimit !== undefined) {
      rateLimitedJobs.push(res.id)
    } else {
      failedJobs.push(res.id)
    }
  }

  const passedCount = passedJobs.length
  const totalCount = jobResults.length
  const averageDurationMs = totalCount > 0 ? Math.round(totalDurationMs / totalCount) : 0

  let state
  let why
  if (failedJobs.length > 0) {
    state = 'failing'
    why = `Passed ${passedCount}/${totalCount} jobs; failed: ${failedJobs.join(', ')}`
  } else if (rateLimitedJobs.length > 0) {
    state = 'rate-limited'
    why = `Passed ${passedCount}/${totalCount} jobs; rate-limited: ${rateLimitedJobs.join(', ')}`
  } else if (averageDurationMs > 60000) {
    state = 'slow'
    why = `Passed ${passedCount}/${totalCount} jobs, but slow (avg ${(averageDurationMs / 1000).toFixed(1)}s/job, total ${(totalDurationMs / 1000).toFixed(1)}s)`
  } else {
    state = 'good'
    why = `Passed ${passedCount}/${totalCount} jobs promptly (avg ${(averageDurationMs / 1000).toFixed(1)}s/job, total ${(totalDurationMs / 1000).toFixed(1)}s)`
  }

  return {
    model,
    state,
    passedJobs,
    failedJobs,
    rateLimitedJobs,
    passedCount,
    totalCount,
    jobTimesMs,
    totalDurationMs,
    averageDurationMs,
    jobDetails,
    why
  }
}

/**
 * Run all jobs for a single model.
 */
export function evaluateJobResult(job, runRes, jobDir, timeoutMs) {
  if (runRes.rateLimit !== undefined) return { passed: false, why: runRes.rateLimit.message }
  if (runRes.timedOut) return { passed: false, why: `Timed out after ${timeoutMs}ms` }
  if (runRes.error !== undefined || runRes.status !== 0) return { passed: false, why: runRes.error ?? `OpenCode exited with status ${String(runRes.status)}` }
  return job.verify(runRes.stdout, jobDir)
}

export async function evaluateModel(model, scratchDir, timeoutMs = DEFAULT_TIMEOUT_MS) {
  console.log(`\nEvaluating model: ${model}`)
  const jobResults = []

  for (const job of JOBS) {
    const jobDir = join(scratchDir, `${model.replace(/[^a-zA-Z0-9._-]/g, '_')}-${job.id}`)
    rmSync(jobDir, { recursive: true, force: true })
    job.setup(jobDir)

    process.stdout.write(`  [${job.name}] Running... `)
    const runRes = await runOpenCodeJob({ model, prompt: job.prompt, cwd: jobDir, timeoutMs })

    const { passed, why } = evaluateJobResult(job, runRes, jobDir, timeoutMs)
    writeFileSync(join(jobDir, 'run.json'), `${JSON.stringify(runRes, null, 2)}\n`, 'utf8')

    const durationSec = (runRes.durationMs / 1000).toFixed(1)
    console.log(`${runRes.rateLimit !== undefined ? 'RATE-LIMITED' : passed ? 'PASS' : 'FAIL'} (${durationSec}s) - ${why}`)

    jobResults.push({
      id: job.id,
      name: job.name,
      passed,
      durationMs: runRes.durationMs,
      why,
      rateLimit: runRes.rateLimit,
      timedOut: runRes.timedOut
    })
  }

  const verdict = evaluateModelVerdict(model, jobResults)
  console.log(`  => Verdict: ${verdict.state.toUpperCase()} (${verdict.why})`)
  return verdict
}

function parseCliArgs() {
  const args = process.argv.slice(2)
  let model
  let scratch = DEFAULT_SCRATCH
  let timeoutMs = DEFAULT_TIMEOUT_MS

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      model = args[++i]
    } else if (args[i] === '--scratch' && args[i + 1]) {
      scratch = args[++i]
    } else if (args[i] === '--timeout' && args[i + 1]) {
      timeoutMs = Number(args[++i])
    }
  }

  return { model, scratch, timeoutMs }
}

async function main() {
  const { model, scratch, timeoutMs } = parseCliArgs()
  mkdirSync(scratch, { recursive: true })

  const models = model ? [model] : getAvailableFreeModels()
  if (models.some((id) => !/^opencode\/[A-Za-z0-9._-]+-free$/.test(id))) throw new Error('Only OpenCode free models may be benchmarked')
  console.log(`Free Model Scorecard: evaluating ${models.length} model(s)`)
  console.log(`Scratch directory: ${scratch}`)
  console.log(`Per-job timeout: ${(timeoutMs / 1000).toFixed(0)}s`)
  console.log(`Execution method: direct OpenCode CLI (headless Edit mode)`)

  const overallStart = performance.now()
  const verdicts = []

  for (const m of models) {
    try {
      const verdict = await evaluateModel(m, scratch, timeoutMs)
      verdicts.push(verdict)
    } catch (err) {
      console.error(`Error evaluating ${m}:`, err.message)
      verdicts.push({
        model: m,
        state: 'failing',
        passedJobs: [],
        failedJobs: JOBS.map((j) => j.id),
        passedCount: 0,
        totalCount: JOBS.length,
        jobTimesMs: {},
        totalDurationMs: 0,
        averageDurationMs: 0,
        jobDetails: {},
        why: `Execution failed with error: ${err.message}`
      })
    }
  }

  const totalRunMs = Math.round(performance.now() - overallStart)

  // Write verdict file in scratch directory
  const verdictReport = {
    runtime: 'opencode',
    checkedAt: new Date().toISOString(),
    executionMethod: 'opencode-cli-direct',
    totalDurationMs: totalRunMs,
    modelCount: verdicts.length,
    models: verdicts
  }

  const verdictPath = join(scratch, 'free-model-verdict.json')
  writeFileSync(verdictPath, `${JSON.stringify(verdictReport, null, 2)}\n`, 'utf8')
  console.log(`\nSaved verdict report to: ${verdictPath}`)

  // Print Summary Table
  console.log('\n=== FREE MODEL SCORECARD SUMMARY ===')
  const tableData = verdicts.map((v) => ({
    Model: v.model.replace('opencode/', ''),
    State: v.state.toUpperCase(),
    'Write File': jobLabel(v.jobDetails.write_file),
    'Fix Bug': jobLabel(v.jobDetails.fix_bug),
    'Answer Q': jobLabel(v.jobDetails.answer_question),
    'Total (s)': (v.totalDurationMs / 1000).toFixed(1),
    Why: v.why
  }))
  console.table(tableData)
  console.log(`Total benchmark duration: ${(totalRunMs / 1000).toFixed(1)}s across ${verdicts.length} models\n`)
}

function jobLabel(detail) {
  if (detail === undefined) return 'N/A'
  if (detail.state === 'rate-limited') return 'RATE-LIMITED'
  return detail.passed ? `PASS (${(detail.durationMs / 1000).toFixed(1)}s)` : 'FAIL'
}

if (process.argv[1] !== undefined && /free-model-scorecard\.mjs$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('Scorecard failed:', err)
    process.exit(1)
  })
}
