import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { waitForCompareTerminals } from './compare-terminal-wait.mjs'

const state = (terminal, labels = ['interrupted', 'interrupted']) => ({ shown: { states: labels }, columns: terminal.map(value => ({ terminal: value })) })
test('interrupted labels cannot finish a comparison without both terminal receipts', async () => {
  let calls = 0, clock = 0
  const shown = await waitForCompareTerminals(async () => ++calls < 3 ? state([false, false]) : state([true, true], ['done', 'done']),
    { now: () => clock, sleep: async ms => { clock += ms }, everyMs: 10, timeoutMs: 100 })
  assert.equal(calls, 3)
  assert.deepEqual(shown.states, ['done', 'done'])
})
test('one terminal column never ends the wait for the other', async () => {
  let clock = 0
  await assert.rejects(waitForCompareTerminals(async () => state([true, false], ['done', 'done']),
    { now: () => clock, sleep: async ms => { clock += ms }, everyMs: 10, timeoutMs: 25 }), /still running:.*25ms/)
  assert.equal(clock, 25)
})
test('terminal receipts wait for the screen to display the last completed column', async () => {
  let calls = 0, clock = 0
  const shown = await waitForCompareTerminals(async () => state([true, true], ++calls === 1 ? ['working', 'done'] : ['done', 'done']),
    { now: () => clock, sleep: async ms => { clock += ms }, everyMs: 10, timeoutMs: 100 })
  assert.equal(calls, 2)
  assert.deepEqual(shown.states, ['done', 'done'])
})
test('a comparison without its two columns cannot settle', async () => {
  let clock = 0
  await assert.rejects(waitForCompareTerminals(async () => state([]),
    { now: () => clock, sleep: async ms => { clock += ms }, timeoutMs: 1 }), /still running/)
})
test('a refused start is terminal but a missing start is not', async () => {
  assert.deepEqual(await waitForCompareTerminals(async () => ({ shown: { states: ['done', 'could not start'] }, columns: [{ terminal: true }, { refused: true }] })), { states: ['done', 'could not start'] })
})
test('the drive reads receipts from each newest column and captures timeout evidence', () => {
  const drive = readFileSync(new URL('./drive-compare-in-any-folder.mjs', import.meta.url), 'utf8')
  assert.match(drive, /waitForCompareTerminals/)
  assert.match(drive, /window\.desktop\.readMission\(id\)/)
  assert.match(drive, /\['run.completed', 'run.failed', 'run.cancelled'\]/)
  assert.match(drive, /finally \{\s+await drive.capture\(label/)
})
