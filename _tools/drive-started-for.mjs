// Is a run started to answer a message shown that message (A2.12)?
//
//   LOCUST_SPEND=1 node _tools/drive-started-for.mjs [--packaged <exe>] [--tag <name>]
//
// Booty already has six messages waiting from Wren, sent hours ago, each
// saying nothing more is needed -- the kind 0.322 leaves for Booty's next run.
// Then Wren is asked to send Booty a real question. Booty's run is started
// for the question, and the prompt it is given used to hold the five OLDEST
// waiting messages and not the question. What Booty's runtime was sent is read
// from Claude Code's own session file. Two Haiku turns; replies on, budget 2.

import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace, teammateRows } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `started-for-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-startedfor-ws-')
const profilePath = await mkdtemp(join(tmpdir(), 'locust-drive-startedfor-profile-'))
// Six waiting notes, three hours old, in the workroom's own record format.
await mkdir(join(profilePath, 'workroom'), { recursive: true })
const posted = new Date(Date.now() - 3 * 60 * 60_000).toISOString()
const records = Array.from({ length: 6 }, (_, index) => JSON.stringify({
  schemaVersion: 1,
  recordType: 'workroom.message',
  sequence: index + 1,
  occurredAt: posted,
  message: {
    messageId: `wm_seed_${String(index + 1)}`,
    from: { teammateId: 'tm_wren', name: 'Wren', missionId: 'mission_seeded' },
    to: { teammateId: 'tm_booty', name: 'Booty' },
    text: `Note ${String(index + 1)}: the nightly deploy finished. No further action is needed from you.`,
    postedAt: posted
  }
}))
await writeFile(join(profilePath, 'workroom', 'workroom.jsonl'), `${records.join('\n')}\n`, 'utf8')

const T0 = '2026-09-05T05:00:00.000Z'
const ROUTE = { runtime: 'claude', model: 'haiku', mode: 'ask' }
const drive = await startDrive({
  spends: true,
  name: 'started-for',
  port: 9542,
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
    settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'off', autoMode: false }
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
      if (text.length > 0) out.push({ at: record.timestamp ?? '', file, text })
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

try {
  await drive.capture('launch: six old notes already waiting for Booty', () => drive.ready())
  await drive.capture('Wren is asked to send Booty a real question', () => drive.evaluate(`(async () => {
    const wren = ${teammateFace('Wren')}
    wren.click()
    await new Promise(r => setTimeout(r, 500))
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Send your teammate Booty one message with the share block, asking exactly: What is 6 times 7? Do nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'no send'
  })()`))
  await drive.capture('wait for the exchange to settle', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 900; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 40 && !document.querySelector('button[aria-label^="Stop the running"]') && !${busy}) return 'settled after ' + String(i / 2) + 's'
    }
    return 'still going'
  })()`))
  const turns = await userTurns()
  // Booty's first turn is the one whose prompt quotes the waiting notes.
  const booty = turns.find((entry) => entry.text.includes('Note 1: the nightly deploy finished'))
  if (outPath !== undefined) {
    await writeFile(join(outPath, 'what-booty-was-sent.json'), JSON.stringify(booty === undefined ? null : {
      characters: booty.text.length,
      quotesTheQuestion: booty.text.includes('What is 6 times 7'),
      notesQuoted: (booty.text.match(/Note \d: the nightly deploy finished/g) ?? []).length,
      ageSaid: /\(sent (?:\d+ hours ago|an hour ago): check it still holds before acting on it\)/.test(booty.text)
    }, null, 2), 'utf8')
  }
  check("Booty's run was started and quoted the waiting notes", booty !== undefined, String(turns.length) + ' user turns')
  check('and it quoted the question it was started for', booty?.text.includes('What is 6 times 7') === true)
  check('the old notes say how old they are', /\(sent (?:\d+ hours ago|an hour ago): check it still holds before acting on it\)/.test(booty?.text ?? ''))
  say(failures === 0 ? '\nSTARTED FOR PASSED' : `\nSTARTED FOR: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren and Booty on Claude Haiku (Ask), replies on, budget 2; six notes three hours old waiting for Booty, then Wren's question.` })
}
