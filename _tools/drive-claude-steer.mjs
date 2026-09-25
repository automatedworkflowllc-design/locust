// A2.10, the Claude half: is an urgent message shown to a running Claude
// teammate WITHOUT stopping her?
//
//   LOCUST_SPEND=1 node _tools/drive-claude-steer.mjs [--packaged <exe>] [--tag <label>]
//
// Codex's app-server has taken a when="now" message into the running turn
// since 0.328. Claude fell back to being stopped part-way (under the
// interrupt switch), which discards the work in flight. Measured 2026-09-25
// on claude 2.1.282: with `--input-format stream-json` a user message written
// while the turn runs is taken into that same turn.
//
// The shape: Wren (Claude Haiku) runs three slow shell commands. Booty (free
// Ling on OpenCode; Haiku answered its brief instead) is asked to send her a when="now" share telling her to end her final
// answer with PINEAPPLE. The switch that lets teammates interrupt is ON, so the
// old build stops Wren; the new one should show her the message and let her
// finish -- and her first answer should end with the word it asked for.
//
// SPENDS: three or four short Claude Haiku turns.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { conversationRows, openTeammateScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateRows } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `claude-steer-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends Claude Haiku turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-claude-steer-ws-')
const now = '2026-09-25T05:00:00.000Z'
const HAIKU = { runtime: 'claude', model: 'haiku', mode: 'accept-edits' }

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'claude-steer',
  port: 9314,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: now, route: HAIKU },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Docs & QA', createdAt: now, route: { runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: true, relayHopCap: 12, interrupt: true, memoryMode: 'off', autoMode: false }
  }
})

const SLOW = 'Run these three shell commands one at a time, one tool call each, waiting for each: sleep 8 && echo one, then sleep 8 && echo two, then sleep 8 && echo three. Then reply with what they printed, in order.'
const URGENT = 'Send Wren a message using the share form in your brief, and put when="now" on it exactly like this: '
  + '<locust-share to="Wren" when="now">When you give your final answer, end it with the word PINEAPPLE.</locust-share>. Send only that, and nothing else.'

const WATCH = `(async () => {
  const busy = () => ${teammateRows()}.some((one) => !/idle|done/.test(one.activity))
  let quiet = 0
  for (let i = 0; i < 900; i += 1) {
    await new Promise((r) => setTimeout(r, 400))
    quiet = busy() ? 0 : quiet + 1
    if (quiet >= 14) break
  }
  await new Promise((r) => setTimeout(r, 1500))
  let everything = ''
  const rows = ${conversationRows()}
  for (const one of rows) {
    one.click()
    await new Promise((r) => setTimeout(r, 600))
    everything += ' ~~ ' + one.title + ': ' + (document.querySelector('.lc-thread')?.innerText ?? '')
  }
  const flat = everything.split(/\\s+/).join(' ')
  return JSON.stringify({
    conversations: rows.length,
    shownWithoutStopping: /shown this part-way through their run, without stopping it/i.test(flat),
    stoppedPartWay: /stopped part-way so they can take this next/i.test(flat),
    // In Wren's FIRST answer: the three outputs, then the word the steer asked for.
    firstAnswerEndsWithPineapple: /three[^A-Za-z]{0,20}PINEAPPLE/.test(flat),
    cancelled: /you stopped this run|cancelled|Stopped/i.test(flat)
  }, null, 1)
})()`

try {
  await drive.capture('Wren starts three slow commands, then Booty sends an urgent message', async () => {
    await drive.ready()
    const wren = await drive.evaluate(openTeammateScript('Wren'))
    const first = await drive.evaluate(sendAndWaitScript(SLOW, { settle: false }))
    await sleep(6000)
    const booty = await drive.evaluate(openTeammateScript('Booty'))
    const second = await drive.evaluate(sendAndWaitScript(URGENT, { settle: false }))
    return [wren, first, booty, second].join(' || ')
  })
  await drive.capture('what happened to Wren', () => drive.evaluate(WATCH))
  await drive.capture('Wren’s first run, the one the message reached', () => drive.evaluate(`(async () => {
    const first = ${conversationRows()}.find((one) => /^Run these three/.test(one.title))
    if (!first) return 'no first run in the sidebar'
    first.click()
    await new Promise((r) => setTimeout(r, 900))
    return (document.querySelector('.lc-thread')?.innerText ?? '').split(/\\s+/).join(' ').slice(-400)
  })()`))
  await drive.capture('Booty’s conversation', async () => {
    await drive.evaluate(openTeammateScript('Booty'))
    await sleep(900)
    return drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? '').split(/\\s+/).join(' ').slice(-700)`)
  })
  await drive.capture('Wren’s conversation', async () => {
    await drive.evaluate(openTeammateScript('Wren'))
    await sleep(900)
    return drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? '').split(/\\s+/).join(' ').slice(-700)`)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on Claude Haiku, Booty on the free Ling, the interrupt switch ON. Wren runs three 8-second shell commands; Booty sends her a when="now" share asking her to end her final answer with PINEAPPLE.`
  })
}
