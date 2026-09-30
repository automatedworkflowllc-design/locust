// Publish one runtime-canary verdict beside the installers (0.501).
//
//   node _tools/publish-canary-verdict.mjs docs/runtime-canary/<runtime>-<version>.json
//
// Installed copies of Locust read `runtime-canary.json` from the public
// releases repository with each look for a newer agent (runtime-updates.ts
// `canaryHeldVersions`), and hold back a version whose verdict is `ok: false`
// -- the release check ran it through a real turn and Locust could not read
// it. A pass is published too, so the file says what was checked, not only
// what failed. Same `gh api` contents route as publish-changelog.mjs.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const REPO = 'automatedworkflowllc-design/locust-releases'
const PATH_IN_REPO = 'runtime-canary.json'
const PACKAGES = { codex: '@openai/codex', copilot: '@github/copilot' }

const file = process.argv[2]
if (file === undefined) {
  console.log('usage: node _tools/publish-canary-verdict.mjs docs/runtime-canary/<runtime>-<version>.json')
  process.exit(2)
}
const verdict = JSON.parse(readFileSync(file, 'utf8'))
const pkg = PACKAGES[verdict.runtime]
if (pkg === undefined || typeof verdict.version !== 'string' || typeof verdict.ok !== 'boolean') {
  console.log(`not a verdict this can publish: ${file}`)
  process.exit(2)
}

const gh = (args, input, quiet = false) =>
  execFileSync('gh', args, { encoding: 'utf8', input, windowsHide: true, stdio: quiet ? ['pipe', 'pipe', 'ignore'] : ['pipe', 'pipe', 'inherit'] })

let sha
let published = { packages: {} }
try {
  const answer = JSON.parse(gh(['api', `repos/${REPO}/contents/${PATH_IN_REPO}`], undefined, true))
  sha = answer.sha
  published = JSON.parse(Buffer.from(answer.content ?? '', 'base64').toString('utf8'))
} catch {
  // Not there yet: the first verdict creates it.
}
const packages = typeof published.packages === 'object' && published.packages !== null ? published.packages : {}
const next = {
  about: 'What Locust\'s release check found: each new agent release run through one real turn and read by Locust. Installed copies hold back a version marked ok: false.',
  packages: {
    ...packages,
    [pkg]: {
      ...(packages[pkg] ?? {}),
      [verdict.version]: { ok: verdict.ok, checkedAt: verdict.checkedAt, ...(verdict.ok ? {} : { why: String(verdict.why ?? '').slice(0, 300) }) }
    }
  }
}
const body = JSON.stringify({
  message: `Release check: ${pkg} ${verdict.version} ${verdict.ok ? 'passed' : 'FAILED'}`,
  content: Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8').toString('base64'),
  ...(sha === undefined ? {} : { sha })
})
gh(['api', '--method', 'PUT', `repos/${REPO}/contents/${PATH_IN_REPO}`, '--input', '-'], body)
console.log(`Published ${pkg} ${verdict.version}: ${verdict.ok ? 'passed' : 'FAILED -- installed copies hold it back'}`)
