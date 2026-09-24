// Does a teammate's claim reach its recipient beside what the host saw (A2.17)?
//
//   LOCUST_SPEND=1 node _tools/drive-host-saw.mjs [--packaged <exe>] [--tag <name>]
//
// Two messages wait for Booty from Wren: "I fixed app.ts." carrying what the
// host saw Wren's run change (src/app.ts), and "Just a note." carrying no
// reading. Booty is started on one short task; what Booty's runtime was sent
// is read from Claude Code's own session file. The first must arrive with
// "(Locust saw their run change: src/app.ts.)" under it, the second with no
// such line. One Haiku turn.

import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace, teammateRows } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `host-saw-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-hostsaw-ws-')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-hostsaw-profile-'))
await mkdir(join(profilePath, 'workroom'), { recursive: true })
const posted = new Date(Date.now() - 5 * 60_000).toISOString()
const seeded = [
  { id: 'wm_seed_1', text: 'I fixed app.ts.', observed: ['src/app.ts'] },
  { id: 'wm_seed_2', text: 'Just a note.' }
].map((entry, index) => JSON.stringify({
  schemaVersion: 1,
  recordType: 'workroom.message',
  sequence: index + 1,
  occurredAt: posted,
  message: {
    messageId: entry.id,
    from: { teammateId: 'tm_wren', name: 'Wren', missionId: 'mission_seeded' },
    to: { teammateId: 'tm_booty', name: 'Booty' },
    text: entry.text,
    postedAt: posted,
    ...(entry.observed === undefined ? {} : { observed: entry.observed })
  }
}))
await writeFile(join(profilePath, 'workroom', 'workroom.jsonl'), `${seeded.join('\n')}\n`, 'utf8')

const T0 = '2026-09-05T05:00:00.000Z'
const ROUTE = { runtime: 'claude', model: 'haiku', mode: 'ask' }
const drive = await startDrive({
  spends: true,
  name: 'host-saw',
  port: 9551,
  workspace,
  profilePath,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: ROUTE },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const busy = `${teammateRows()}.some(r => /working|running|starting|replying|listening|thinking|waiting/i.test(r.innerText))`

async function userTurns() {
  const folder = join(homedir(), '.claude', 'projects', workspace.replace(/[^A-Za-z0-9]/g, '-'))
  const out = []
  for (const file of (await readdir(folder).catch(() => [])).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(folder, file), 'utf8')).split('\n')) {
      if (line.trim().length === 0) continue
      let record
      try { record = JSON.parse(line) } catch { continue }
      if (record.type !== 'user' || record.isMeta === true) continue
      const content = record.message?.content
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') : ''
      if (text.length > 0) out.push({ at: record.timestamp ?? '', text })
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

try {
  await drive.capture('launch: two messages from Wren waiting for Booty', () => drive.ready())
  await drive.capture('Booty is given one short task', () => drive.evaluate(`(async () => {
    ${teammateFace('Booty')}.click()
    await new Promise(r => setTimeout(r, 500))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with the single word OK. Do nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'no send'
  })()`))
  await drive.capture('wait for the run to end', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 400; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 10 && !document.querySelector('button[aria-label^="Stop the running"]') && !${busy}) return 'settled after ' + String(i / 2) + 's'
    }
    return 'still going'
  })()`))
  const turns = await userTurns()
  const booty = turns.find((entry) => entry.text.includes('I fixed app.ts.'))
  const sent = booty?.text ?? ''
  if (outPath !== undefined) await writeFile(join(outPath, 'what-booty-was-sent.txt'), sent, 'utf8')
  check("Booty's runtime was sent both waiting messages", sent.includes('I fixed app.ts.') && sent.includes('Just a note.'), String(turns.length) + ' user turns')
  check('the claim arrives with what the host saw under it', /I fixed app\.ts\.\n\s+\(Locust saw their run change: src\/app\.ts\.\)/.test(sent))
  check('and the message the host did not look behind has no such line', (sent.match(/Locust saw their run change/g) ?? []).length === 1)
  say(failures === 0 ? '\nHOST SAW PASSED' : `\nHOST SAW: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Booty on Claude Haiku (Ask), two messages from Wren waiting, one carrying what the host saw.` })
}
