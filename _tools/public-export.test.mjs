import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountRemains, isExcluded, scrubText } from './public-export.mjs'

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

test('a handoff whose name does not start with that prefix stays', () => {
  assert.equal(isExcluded('docs/BETA-HANDOFF-2026-09-21.md'), false)
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

test('letters inside a longer word are left as written', () => {
  const stuck = `prefix${account}suffix`
  assert.equal(scrubText(stuck), stuck)
  assert.equal(scrubText('the public copy keeps product docs'), 'the public copy keeps product docs')
})

test('a scrub that returns the text unchanged still has the user path', () => {
  const sample = `C:/Users/${account}/Desktop`
  const broken = (text) => text
  assert.equal(accountRemains(broken(sample)), true)
  assert.equal(accountRemains(scrubText(sample)), false)
})
