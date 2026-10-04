import assert from 'node:assert/strict'
import { test } from 'vitest'
import { accountRemains, denyHits, denyTerms, isExcluded, scrubText } from './public-export.mjs'

const account = ['h', 'i', 's', 'b', 'o'].join('')
const slash = String.fromCharCode(92)

test('a screenshot folder under docs is excluded', () => {
  assert.equal(isExcluded('docs/user-session/2026-09-30/01-launch.png'), true)
  assert.equal(isExcluded('docs/beta-fixes-2026-09-24/notes/SESSION.md'), true)
})

test('the readme imagery and a product document stay', () => {
  assert.equal(isExcluded('docs/assets/shots/01-home.png'), false)
  assert.equal(isExcluded('docs/assets/locust-banner.png'), false)
  assert.equal(isExcluded('docs/ARCHITECTURE.md'), false)
  assert.equal(isExcluded('docs/wip/mascots-wip-2026-10-02.patch'), false)
})

test('a beta review and a handoff are excluded', () => {
  assert.equal(isExcluded('docs/BETA-REVIEW-2026-09-21.md'), true)
  assert.equal(isExcluded('docs/HANDOFF-2026-09-22.md'), true)
  assert.equal(isExcluded('docs/HANDOFF-claude-adapter.md'), true)
  assert.equal(isExcluded('docs/internal/notes.md'), true)
})

test('a document under docs that is not on the published list is excluded, even a new one', () => {
  assert.equal(isExcluded('docs/BETA-HANDOFF-2026-09-21.md'), true)
  assert.equal(isExcluded('docs/PLAN-2026-10-03-EXECUTE.md'), true)
  assert.equal(isExcluded('docs/a-folder-made-tomorrow-2026-10-05/01-launch.png'), true)
  assert.equal(isExcluded('docs/DECISION-2026-09-20-LOCUST-NEVER-RUNS-MODEL-CODE.md'), false)
  assert.equal(isExcluded('docs/ROADMAP.md'), false)
})

test('the desktop ui profile is excluded', () => {
  assert.equal(isExcluded('apps/desktop/_ui-profile/Local Storage/leveldb/LOG'), true)
})

test('a cpu profile and the astra worktree note are excluded', () => {
  assert.equal(isExcluded('docs/runtime-canary/switch.cpuprofile'), true)
  assert.equal(isExcluded('ASTRA-WORKTREE.md'), true)
})

test('a smoke or drive profile directory is excluded and a smoke script is not', () => {
  assert.equal(isExcluded('scratch/drive-profile/Cookies'), true)
  assert.equal(isExcluded('_smoke/renderer-smoke.mjs'), false)
})

test('a windows user path is rewritten so the folder name is home', () => {
  const backslash = `C:${slash}Users${slash}${account}${slash}Documents`
  const forward = `C:/Users/${account}/Desktop`
  const mixedCase = `c:/users/${account.toUpperCase()}/Desktop`
  assert.equal(scrubText(backslash), `C:${slash}Users${slash}<home>${slash}Documents`)
  assert.equal(scrubText(forward), 'C:/Users/<home>/Desktop')
  assert.equal(scrubText(mixedCase), 'c:/users/<home>/Desktop')
  assert.equal(accountRemains(scrubText(backslash)), false)
  assert.equal(accountRemains(scrubText(forward)), false)
})

test('an escaped windows user path and a hyphenated encoding are rewritten', () => {
  const doubled = `C:${slash}${slash}Users${slash}${slash}${account}${slash}${slash}Desktop`
  const hyphenated = `C-Users-${account}-code-streaks`
  assert.equal(scrubText(doubled), `C:${slash}${slash}Users${slash}${slash}<home>${slash}${slash}Desktop`)
  assert.equal(scrubText(hyphenated), 'C-Users-<home>-code-streaks')
})

test('a home path written the unix way is rewritten', () => {
  assert.equal(scrubText(`/home/${account}/claude`), '/home/<home>/claude')
})

test('the account name is rewritten even when the slashes around it are gone', () => {
  assert.equal(scrubText(`C:Users${account}AppData`), 'C:Users<home>AppData')
  assert.equal(scrubText('the public copy keeps product docs'), 'the public copy keeps product docs')
})

test('a length-prefixed protobuf that embeds the account folder is excluded', () => {
  assert.equal(isExcluded('packages/runtime-adapters/test/fixtures/antigravity/summaries.pb'), true)
})

test('a scrub that returns the text unchanged still has the user path', () => {
  const sample = `C:/Users/${account}/Desktop`
  const broken = (text) => text
  assert.equal(accountRemains(broken(sample)), true)
  assert.equal(accountRemains(scrubText(sample)), false)
})

test('a deny-file phone number is found however it is written, and nothing else is', () => {
  const terms = denyTerms('# the owner\n+1 555 010 0199\nFairhaven Lane\n')
  assert.deepEqual(terms, ['+1 555 010 0199', 'Fairhaven Lane'])
  assert.deepEqual(denyHits("'Call the shop at 555-010-0199.'", terms), [1])
  assert.deepEqual(denyHits('(555) 010 0199', terms), [1])
  assert.deepEqual(denyHits('12 fairhaven lane', terms), [2])
  // Controls: other numbers, and digits from unrelated runs glued together.
  assert.deepEqual(denyHits('Call 555-010-0142. Order 5550 shipped; 100199 left.', terms), [])
  assert.deepEqual(denyHits('sha a5b5c5d0e1f0g0h1i9j9', terms), [])
})
