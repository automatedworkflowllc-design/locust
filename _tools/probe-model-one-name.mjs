// A model picked reads the same in the chip as in the list (0.528).
//
//   node _tools/probe-model-one-name.mjs [--packaged <exe>]
//
// drive-compare-answers on 0.527: the picker listed Codex's "GPT-6-Luna" and
// the chip said "GPT-6 Luna". Picks GPT-6-Luna for Wren and compares the two,
// exactly. Sends nothing.

import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'probe-model-one-name',
  port: 9850,
  sendsNothing: true,
  outPath: join(recordRoot('probe-model-one-name-2026-10-01'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-26T05:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await drive.evaluate(openTeammateScript('Wren'))
  const got = JSON.parse(String(await drive.capture('GPT-6-Luna picked: the chip beside the list', () => drive.evaluate(`(async () => {
    const chip = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
    if (!chip) return JSON.stringify({ why: 'no chip' })
    const before = chip.innerText.replace(/\\s+/g, ' ').trim()
    chip.click()
    for (let i = 0; i < 20 && !document.querySelector('.lc-picker__input'); i += 1) await new Promise((r) => setTimeout(r, 150))
    const box = document.querySelector('.lc-picker__input')
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setInput.call(box, 'luna')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 700))
    const row = [...document.querySelectorAll('.lc-picker__row:not(.is-recent)')].find((one) => !one.disabled && /luna/i.test(one.querySelector('.lc-picker__label')?.textContent ?? ''))
    if (!row) return JSON.stringify({ why: 'no Luna row', rows: [...document.querySelectorAll('.lc-picker__row')].map((one) => [one.className, one.disabled, one.querySelector('.lc-picker__label')?.textContent ?? null]) })
    const listed = row.querySelector('.lc-picker__label')?.textContent.trim() ?? ''
    row.click()
    await new Promise((r) => setTimeout(r, 800))
    const after = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
    return JSON.stringify({ before, listed, chip: after?.innerText.replace(/\\s+/g, ' ').trim() ?? '' })
  })()`))))
  const same = typeof got.listed === 'string' && got.listed.length > 0 && got.chip.includes(got.listed)
  if (!same) failures += 1
  say(`  [${same ? 'PASS' : 'FAIL'}] the chip names the model as the list does -- ${JSON.stringify(got)}`)
  // An OpenCode catalog names a model by its bare id; that is never the chip's name.
  const spelled = got.before === 'OpenCode / Nemotron 3 Ultra Free'
  if (!spelled) failures += 1
  say(`  [${spelled ? 'PASS' : 'FAIL'}] before, the free model's chip is spelled as a name, not its id -- ${String(got.before)}`)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren picks GPT-6-Luna; nothing sent.`, extra: `Checks failed: ${String(failures)}` })
}
process.exit(failures === 0 ? 0 : 1)
