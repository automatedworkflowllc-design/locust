// Live smoke for the write-capable sandbox.
//
// The whole safety claim of "Ask" versus "Accept edits" rests on one argument
// reaching Codex. This proves it does, in the only way that counts: the same
// prompt is run twice in a throwaway workspace, and the file must NOT appear
// under read-only and MUST appear under workspace-write.
//
// The read-only half is the control. Without it, a build that ignored the
// sandbox entirely -- or always passed workspace-write -- would still show a
// green "it wrote the file" result.
//
//   node _smoke/write-mode-smoke.mjs
//
// Exits non-zero on any failed assertion. Works in a temp git repo and removes
// it afterwards.

import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const adapters = await import(
  new URL('../packages/runtime-adapters/dist/index.js', import.meta.url).href
)
const { createCodexExecCommand, createNodeRuntimeProcessRunner, createNodeProbeRunner, createPathExecutableLocator, discoverInstalledRuntimes } =
  adapters

const CODEX_BIN_DIR = 'C:\\Users\\<home>\\AppData\\Local\\OpenAI\\Codex\\bin\\b99306303521e97e'
const PROOF = 'locust-write-proof.txt'
const PROMPT = `Create a file named ${PROOF} in the current directory containing exactly the word WROTE. Do not do anything else.`

let failures = 0
function check(label, ok, detail) {
  if (!ok) failures += 1
  console.error(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const runtimes = await discoverInstalledRuntimes({
  runner: createNodeProbeRunner(),
  locator: createPathExecutableLocator({
    environment: { ...process.env, PATH: `${CODEX_BIN_DIR};${process.env.PATH ?? ''}` }
  }),
  includeOmniRoute: false
})
const codex = runtimes.find((entry) => entry.id === 'codex')
if (codex?.readiness !== 'ready' || codex.executable === undefined) {
  console.error('codex is not ready; cannot run the write-mode smoke')
  process.exit(1)
}

async function runOnce(sandbox) {
  const root = await mkdtemp(join(tmpdir(), 'locust-write-'))
  try {
    // Codex refuses to run outside a git repository, and a throwaway repo is a
    // cleaner fit than loosening the product's own argv.
    execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'ignore' })
    await writeFile(join(root, 'README.md'), 'scratch workspace\n', 'utf8')

    const command = createCodexExecCommand(codex.executable, { workspacePath: root, sandbox })
    const passedSandbox = command.args[command.args.indexOf('--sandbox') + 1]
    const run = createNodeRuntimeProcessRunner().start(command, PROMPT, {})
    for await (const record of run.records) void record
    await run.completion

    const path = join(root, PROOF)
    const wrote = existsSync(path)
    const body = wrote ? (await readFile(path, 'utf8')).trim() : ''
    return { passedSandbox, wrote, body }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.error('1. read-only must refuse the write (the control)')
const readOnly = await runOnce('read-only')
check('argv carried --sandbox read-only', readOnly.passedSandbox === 'read-only', readOnly.passedSandbox)
check('no file was created', readOnly.wrote === false, readOnly.wrote ? `found: ${readOnly.body}` : undefined)

console.error('2. workspace-write must succeed')
const writable = await runOnce('workspace-write')
check('argv carried --sandbox workspace-write', writable.passedSandbox === 'workspace-write', writable.passedSandbox)
check('the file was created', writable.wrote === true)
check('with the expected contents', writable.body.includes('WROTE'), writable.body || '(empty)')

console.error(`\n${failures === 0 ? 'WRITE-MODE SMOKE PASSED' : `WRITE-MODE SMOKE FAILED (${failures})`}`)
process.exit(failures === 0 ? 0 : 1)
