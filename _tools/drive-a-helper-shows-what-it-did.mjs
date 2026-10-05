// A helper the teammate sends out shows what it did, under its own row.
//
//   LOCUST_SPEND=1 node _tools/drive-a-helper-shows-what-it-did.mjs
//
// Wren on Claude Code / Haiku 4.5, Edit, asked to use a helper to count the
// files in the folder (docs/HANDOFF-2026-10-05-helper-visibility.md). The
// Activity card should show the helper's row with a count of its calls, folded;
// pressed, it opens onto those calls one step in; and the turn's own rows read
// as they did before -- none of the helper's calls among them. Spends one short
// Claude Code run with one helper.

import { openAllStepsScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const workspace = await scratchRepository('locust-drive-helper-calls-ws-')
for (const name of ['one.txt', 'two.txt', 'three.txt']) await writeFile(join(workspace, name), `${name}\n`, 'utf8')

const drive = await startDrive({
  name: tag === undefined ? 'a-helper-shows-what-it-did' : `a-helper-shows-what-it-did-${tag}`,
  port: 9341,
  workspace,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const check = (ok, words) => `${ok ? 'PASS' : 'FAIL'} ${words}`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('Wren: ask for a helper to count the files, and wait for the turn to end', async () => {
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(sendAndWaitScript('Use a helper (your Agent tool, an Explore helper) to count the files in this folder, then tell me the count in one sentence. Do not edit anything.', { waitSeconds: 300 }))
  })
  await drive.capture("the helper's row: its count, folded", () => drive.evaluate(`(async () => {
    await (${openAllStepsScript()})
    const rows = [...document.querySelectorAll('.lc-thread .lc-filerow.is-helper')]
    const row = rows.find(r => r.tagName === 'BUTTON') ?? rows[0]
    if (!row) return ${JSON.stringify(check(false, 'a helper row is drawn'))} + ' -- rows: ' + [...document.querySelectorAll('.lc-thread .lc-filerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()).join(' | ')
    const text = row.innerText.replace(/\\s+/g, ' ').trim()
    const count = /(\\d+) calls?/.exec(text)
    return [
      ${JSON.stringify(check(true, 'a helper row is drawn'))} + ': ' + text,
      (count ? 'PASS' : 'FAIL') + ' the row counts its calls' + (count ? ' (' + count[0] + ')' : ''),
      (row.getAttribute('aria-expanded') === 'false' && !document.querySelector('.lc-helper__calls') ? 'PASS' : 'FAIL') + ' folded until pressed'
    ].join(' || ')
  })()`))
  await drive.capture('pressed: it opens onto its calls, one step in', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-thread button.lc-filerow.is-helper')][0]
    if (!row) return 'FAIL no helper row to press'
    const said = /(\\d+) calls?/.exec(row.innerText)
    row.click()
    await new Promise(r => setTimeout(r, 400))
    const list = document.querySelector('.lc-helper__calls')
    const calls = list ? [...list.querySelectorAll('[role=listitem]')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()) : []
    const indent = list ? getComputedStyle(list).marginLeft : 'none'
    return [
      (list ? 'PASS' : 'FAIL') + ' the calls open under the row',
      ((said && calls.length === Number(said[1])) ? 'PASS' : 'FAIL') + ' as many calls as the row said (' + calls.length + ')',
      ((indent !== 'none' && parseFloat(indent) > 0) ? 'PASS' : 'FAIL') + ' indented one step (' + indent + ')',
      'calls: ' + calls.join(' | ')
    ].join(' || ')
  })()`))
  await drive.capture("the turn's own rows: none of the helper's calls among them", () => drive.evaluate(`(async () => {
    const all = [...document.querySelectorAll('.lc-thread .lc-filerow')]
    const own = all.filter(r => !r.closest('.lc-helper__calls'))
    const children = all.filter(r => r.closest('.lc-helper__calls')).map(r => r.innerText.replace(/\\s+/g, ' ').trim())
    const ownText = own.map(r => r.innerText.replace(/\\s+/g, ' ').trim())
    const leaked = children.filter(c => ownText.includes(c))
    const line = [...document.querySelectorAll('.lc-thread .lc-steps__line')].map(l => l.innerText.replace(/\\s+/g, ' ').trim()).join(' / ')
    return [
      (leaked.length === 0 ? 'PASS' : 'FAIL') + " no helper call is drawn as the turn's own" + (leaked.length === 0 ? '' : ': ' + leaked.join(' | ')),
      'own rows: ' + ownText.join(' | '),
      'steps line: ' + line
    ].join(' || ')
  })()`))
  await drive.capture('the reply', () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-260) ?? ''`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on Claude Code / Haiku 4.5, Edit, asked to use a helper to count the files in the folder.' })
}
