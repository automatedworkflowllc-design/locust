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
export function runOpenCodeJob({ model, prompt, cwd, timeoutMs = DEFAULT_TIMEOUT_MS }) {
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
    const child = spawn(isWin ? 'cmd.exe' : 'opencode', isWin ? ['/c', 'opencode', ...args] : args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
        } else {
          child.kill('SIGKILL')
        }
      } catch {
        // already stopped
      }
    }, timeoutMs)

    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      clearTimeout(timer)
      const durationMs = Math.round(performance.now() - start)
      resolve({ status: -1, stdout, stderr, durationMs, timedOut: false, error: err.message })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const durationMs = Math.round(performance.now() - start)
      resolve({ status: code, stdout, stderr, durationMs, timedOut })
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
 * Classify model verdict into good | slow | failing.
 */
export function evaluateModelVerdict(model, jobResults) {
  const passedJobs = []
  const failedJobs = []
  const jobTimesMs = {}
  const jobDetails = {}
  let totalDurationMs = 0

  for (const res of jobResults) {
    jobTimesMs[res.id] = res.durationMs
    totalDurationMs += res.durationMs
    jobDetails[res.id] = {
      passed: res.passed,
      durationMs: res.durationMs,
      why: res.why
    }
    if (res.passed) {
      passedJobs.push(res.id)
    } else {
      failedJobs.push(res.id)
    }
  }

  const passedCount = passedJobs.length
  const totalCount = jobResults.length
  const averageDurationMs = totalCount > 0 ? Math.round(totalDurationMs / totalCount) : 0

  let state
  let why
  if (passedCount < totalCount) {
    state = 'failing'
    why = `Passed ${passedCount}/${totalCount} jobs; failed: ${failedJobs.join(', ')}`
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
export async function evaluateModel(model, scratchDir, timeoutMs = DEFAULT_TIMEOUT_MS) {
  console.log(`\nEvaluating model: ${model}`)
  const jobResults = []

  for (const job of JOBS) {
    const jobDir = join(scratchDir, `${model.replace(/[^a-zA-Z0-9._-]/g, '_')}-${job.id}`)
    rmSync(jobDir, { recursive: true, force: true })
    job.setup(jobDir)

    process.stdout.write(`  [${job.name}] Running... `)
    const runRes = await runOpenCodeJob({ model, prompt: job.prompt, cwd: jobDir, timeoutMs })

    let passed = false
    let why = ''
    if (runRes.timedOut) {
      passed = false
      why = `Timed out after ${timeoutMs}ms`
    } else {
      const verifyRes = job.verify(runRes.stdout, jobDir)
      passed = verifyRes.passed
      why = verifyRes.why
    }

    const durationSec = (runRes.durationMs / 1000).toFixed(1)
    console.log(`${passed ? 'PASS' : 'FAIL'} (${durationSec}s) - ${why}`)

    jobResults.push({
      id: job.id,
      name: job.name,
      passed,
      durationMs: runRes.durationMs,
      why,
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
    'Write File': v.jobDetails.write_file ? (v.jobDetails.write_file.passed ? `PASS (${(v.jobDetails.write_file.durationMs / 1000).toFixed(1)}s)` : 'FAIL') : 'N/A',
    'Fix Bug': v.jobDetails.fix_bug ? (v.jobDetails.fix_bug.passed ? `PASS (${(v.jobDetails.fix_bug.durationMs / 1000).toFixed(1)}s)` : 'FAIL') : 'N/A',
    'Answer Q': v.jobDetails.answer_question ? (v.jobDetails.answer_question.passed ? `PASS (${(v.jobDetails.answer_question.durationMs / 1000).toFixed(1)}s)` : 'FAIL') : 'N/A',
    'Total (s)': (v.totalDurationMs / 1000).toFixed(1),
    Why: v.why
  }))
  console.table(tableData)
  console.log(`Total benchmark duration: ${(totalRunMs / 1000).toFixed(1)}s across ${verdicts.length} models\n`)
}

if (process.argv[1] !== undefined && /free-model-scorecard\.mjs$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error('Scorecard failed:', err)
    process.exit(1)
  })
}
