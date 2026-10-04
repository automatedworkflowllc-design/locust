// Every saved approval rule can go at once, and the row asks first (0.587).
//
//   node _tools/drive-remove-all-rules.mjs [--packaged <exe>] [--tag <name>]
//
// QA's item Q7: Settings > Teammates > Saved approvals removed rules one at a
// time. Three rules are seeded into a throwaway profile (no model runs; this
// drive sends nothing and spends nothing). Settings must list all three;
// "Remove all rules" must ask, naming the count, and "Keep them" must leave
// them; asked again and confirmed, the list must say "None yet." and the file
// on disk must be readable and empty, so every card asks again afterwards.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-remove-all-ws-')
const rule = (ruleId, effect, kind, pattern, extra = {}) => ({ ruleId, effect, kind, pattern, createdAt: '2026-10-03T09:00:00.000Z', ...extra })
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `remove-all-rules-${tag}`,
  port: 9847,
  sendsNothing: true,
  workspace,
  outPath: join(recordRoot('remove-all-rules-2026-10-04'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-26T05:00:00.000Z', route: { runtime: 'codex', model: 'gpt-6-luna', mode: 'approve-each', effort: 'low' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  },
  files: {
    'approval-rules.json': {
      schemaVersion: 1,
      rules: [
        rule('rule_1', 'allow', 'command', 'node --version', { teammateId: 'tm_wren', folder: workspace, uses: 2, lastUsedAt: '2026-10-03T09:30:00.000Z' }),
        rule('rule_2', 'deny', 'command', 'git push:*'),
        rule('rule_3', 'allow', 'read', 'docs/**')
      ]
    }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
// The section as a person reads it: its text, how many rule rows, which buttons it offers.
const SECTION = `[...document.querySelectorAll('.lc-settings__heading')].find((h) => h.innerText.trim() === 'Saved approvals')?.closest('section')`
const readSection = `(() => {
  const section = ${SECTION}
  if (!section) return JSON.stringify({ text: 'no Saved approvals section', rules: -1, buttons: [] })
  return JSON.stringify({
    text: section.innerText.replace(/\\s+/g, ' ').trim(),
    rules: section.querySelectorAll('.lc-tag').length,
    buttons: [...section.querySelectorAll('button')].map((b) => b.innerText.trim())
  })
})()`
const openRules = `(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 900))
  ;[...document.querySelectorAll('.lc-settings__navitem, button')].find((b) => b.innerText.trim() === 'Teammates')?.click()
  await new Promise((r) => setTimeout(r, 900))
  ;${SECTION}?.scrollIntoView()
  return ${readSection}
})()`
const press = (label) => `(async () => {
  const section = ${SECTION}
  const button = [...(section?.querySelectorAll('button') ?? [])].find((b) => b.innerText.trim() === ${JSON.stringify(label)})
  if (!button) return JSON.stringify({ text: 'no button ' + ${JSON.stringify(label)}, rules: -1, buttons: [] })
  button.click()
  await new Promise((r) => setTimeout(r, 1200))
  return ${readSection}
})()`
const seen = async (name, script) => JSON.parse(String(await drive.capture(name, () => drive.evaluate(script))))

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1440, 900)
  const listed = await seen('Settings > Teammates: three saved rules', openRules)
  check('Settings lists the three seeded rules', listed.rules === 3 && /ALLOW/.test(listed.text) && /NEVER/.test(listed.text), listed.text)
  check('a rule with uses says how many cards it answered', /Answered 2 cards\./.test(listed.text), listed.text)
  check('under the list, "Remove all rules" is offered once', listed.buttons.filter((b) => b === 'Remove all rules').length === 1, listed.buttons.join(' | '))

  const asked = await seen('Remove all rules, pressed: it asks first', press('Remove all rules'))
  check('pressed, it asks, naming the count, and says what follows', /Remove all 3 saved rules\? Every card asks again afterwards\./.test(asked.text), asked.text)
  check('the asking row offers Remove all and Keep them, and the rules are still there', asked.buttons.includes('Remove all') && asked.buttons.includes('Keep them') && asked.rules === 3, asked.buttons.join(' | '))

  const kept = await seen('Keep them: nothing goes', press('Keep them'))
  check('Keep them leaves all three and offers "Remove all rules" again (control)', kept.rules === 3 && kept.buttons.includes('Remove all rules') && !kept.buttons.includes('Remove all'), kept.text)

  await seen('asked again', press('Remove all rules'))
  const gone = await seen('Remove all, confirmed: None yet', press('Remove all'))
  check('confirmed, the list says None yet and no rule row remains', gone.rules === 0 && /None yet\./.test(gone.text), gone.text)
  check('the asking row is gone with the rules', !gone.buttons.includes('Remove all') && !gone.buttons.includes('Remove all rules') && !gone.buttons.includes('Keep them'), gone.buttons.join(' | '))

  // The file is left readable and empty, not deleted and not torn: every card asks again.
  await sleep(500)
  const file = JSON.parse(await readFile(join(drive.profile, 'approval-rules.json'), 'utf8'))
  check('the rules file on disk is readable and holds no rule', file.schemaVersion === 1 && Array.isArray(file.rules) && file.rules.length === 0, JSON.stringify(file))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Three seeded rules; Remove all rules asked, kept, then confirmed. No model ran.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
