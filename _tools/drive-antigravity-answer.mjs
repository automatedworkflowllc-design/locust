// Antigravity asks; Locust asks you; your answer reaches Antigravity -- and a
// question answered in Antigravity's own window leaves Locust's card.
//
//   LOCUST_SPEND=1 node _tools/drive-antigravity-answer.mjs [--packaged <exe>] [--once]
//
// Yurt's beta run, 2026-09-23, hung on an `ask_question` that Antigravity drew
// only in its own window. Colin: "he was hung up while waiting on this answer
// since the google question wasnt popping up in our chat". Two turns on
// Antigravity's cheapest tier (Flash), in the folder Antigravity already has
// open (it refuses any other):
//
//   1. the question arrives as Locust's question card, the teammate reads
//      "waiting on you", the SECOND option is picked and sent from the card,
//      and the agent names that option back;
//   2. the question is answered straight through Antigravity's own server,
//      as its IDE does, and Locust's card goes away by itself.
//
// Spends two short Antigravity Flash turns on the person's own account, so it
// says `spends: true` and needs LOCUST_SPEND=1.

import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { pickRouteScript, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const WORKSPACE = 'C:/Users/<home>/Documents/antigravtest'
const OUT = join(new URL('../docs/antigravity-answer-2026-09-23/', import.meta.url).pathname.slice(1), packaged === undefined ? 'local' : 'packaged')
await mkdir(OUT, { recursive: true })

const drive = await startDrive({
  name: 'antigravity-answer',
  port: 9402,
  workspace: WORKSPACE,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Custom', avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape: 'droid', face: 'eyes' } }, createdAt: '2026-09-23T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const shoot = async (file) => {
  const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
}

const PROMPT = 'Ask me to choose between exactly four different ways to organise this folder, using your multiple-choice question tool. Do not pick one yourself -- wait for my answer. When I have answered, reply with one sentence naming the option I chose, and change no files.'

const send = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 300))
  field.form.requestSubmit()
  return 'sent'
})()`)

// The question card: Locust's approval card holding a question.
const CARD = `document.querySelector('.lc-card.is-pending .lc-questions')`
const readCard = () => drive.evaluate(`(() => {
  const questions = ${CARD}
  if (!questions) return JSON.stringify(null)
  const card = questions.closest('.lc-card')
  return JSON.stringify({
    head: card.querySelector('.lc-card__head')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    action: card.querySelector('.lc-receipt dd')?.innerText.trim() ?? '',
    question: card.querySelector('.lc-question__text')?.innerText.trim() ?? '',
    options: [...card.querySelectorAll('.lc-question__option .lc-question__label')].map((el) => el.innerText.trim()),
    buttons: [...card.querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean),
    elsewhere: /Answer it in Antigravity/.test(card.innerText)
  })
})()`)
const header = () => drive.evaluate(`document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
const gemState = () => drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-bot[data-teammate="tm_gem"]')].map((b) => ({ activity: b.getAttribute('data-activity'), ring: !!b.querySelector('.lc-bot__ring'), dot: b.querySelector('.lc-presence')?.className ?? '' })))`)
// The thread's tail: the reply is the last thing in it.
const lastReply = () => drive.evaluate(`(document.querySelector('.lc-thread')?.innerText.slice(-600) ?? '').replace(/\\s+/g, ' ').trim()`)

// ---- Antigravity's own server, spoken to the way its IDE does (for turn 2)
const server = () => {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name LIKE 'language_server%'" | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`], { encoding: 'utf8' })
  const [pid, cmd] = out.split(/\r?\n/).map((line) => line.split('\t')).find(([p, c]) => p && c && /--csrf_token/.test(c)) ?? []
  const token = /--csrf_token\s+([0-9a-f-]{36})/i.exec(cmd ?? '')?.[1]
  const ports = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique) -join ','`], { encoding: 'utf8' }).trim().split(',').map(Number)
  return { token, ports }
}
const connect = (port, token, method, body) => new Promise((resolve) => {
  const payload = JSON.stringify(body)
  const request = http.request({ host: '127.0.0.1', port, method: 'POST', path: `/exa.language_server_pb.LanguageServerService/${method}`, headers: { 'content-type': 'application/json', 'connect-protocol-version': '1', 'x-codeium-csrf-token': token, 'content-length': Buffer.byteLength(payload) }, timeout: 5000 }, (response) => {
    let text = ''
    response.on('data', (chunk) => { text += chunk })
    response.on('end', () => resolve({ status: response.statusCode, text }))
  })
  request.on('error', (error) => resolve({ status: 0, text: error.message }))
  request.end(payload)
})
const BRAIN = join(homedir(), '.gemini', 'antigravity', 'brain')
const transcriptOf = (conversation) => join(BRAIN, conversation, '.system_generated', 'logs', 'transcript.jsonl')
/**
 * This drive's own conversation: the Antigravity id its mission ledger holds,
 * never simply the newest one -- another session may be driving Antigravity
 * at the same time, and its question is not this drive's to answer.
 */
const activeConversation = async () => {
  const dir = join(drive.profile, 'mission-ledger')
  const names = await readdir(dir).catch(() => [])
  const text = (await Promise.all(names.map((name) => readFile(join(dir, name), 'utf8').catch(() => '')))).join(' ')
  const ids = [...new Set(text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])]
  const dated = await Promise.all(ids.map(async (id) => ({ id, at: await stat(transcriptOf(id)).then((s) => s.mtimeMs, () => -1) })))
  return dated.filter((entry) => entry.at >= 0).sort((a, b) => b.at - a.at)[0]?.id
}
/**
 * The answer Antigravity recorded for its last question, from its own
 * transcript: the tool completion it writes as `A1: <text>` -- the ground
 * truth that the answer reached the agent, whoever sent it.
 */
const recordedAnswer = async (conversation) => {
  const text = await readFile(transcriptOf(conversation), 'utf8').catch(() => '')
  const answers = text.split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line) } catch { return {} } })
    .filter((record) => record.type === 'GENERIC' && /\nA1: /.test(record.content ?? ''))
  return answers.at(-1)?.content.split('\nA1: ')[1]?.trim()
}
const same = (a, b) => String(a ?? '').replace(/\s+/g, ' ').trim() === String(b ?? '').replace(/\s+/g, ' ').trim()

const askAndWaitForCard = async (label) => {
  await send(PROMPT)
  for (let second = 0; second < 150; second += 1) {
    await sleep(1000)
    const card = JSON.parse(await readCard())
    if (card !== null) {
      say(`${label}: the card is up after ${String(second)}s: ${JSON.stringify(card).slice(0, 400)}`)
      return card
    }
    const said = await header()
    if (/completed|failed|cancelled/i.test(said)) {
      say(`${label}: the run settled with no card: ${said.slice(0, 160)} || ${(await lastReply()).slice(0, 300)}`)
      return null
    }
  }
  say(`${label}: no card after 150s: ${(await header()).slice(0, 160)}`)
  return null
}

try {
  await drive.ready()
  await drive.resize(1120, 720)
  const opened = await drive.evaluate(`(async () => {
    const gem = [...document.querySelectorAll('button')].find((b) => /Gem/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.innerText))
    if (!gem) return 'NO GEM BUTTON'
    gem.click()
    await new Promise((r) => setTimeout(r, 800))
    return 'opened'
  })()`)
  say(`Gem: ${opened}`)
  say(await drive.evaluate(pickRouteScript({ group: '/antigravity/i', search: 'flash', row: '/flash/i' })))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/antigravity/i.test(route) || !/flash/i.test(route) || /pro\b/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}", not Antigravity's Flash`)
  say(`route: ${route}`)

  // ---- Turn 1: answered from Locust's card
  const card = await askAndWaitForCard('turn 1')
  check("Antigravity's question arrives as Locust's question card", card !== null && card.options.length >= 2, card === null ? 'no card' : `${String(card.options.length)} options`)
  if (card !== null) {
    check('the card names Antigravity, reads as words, and offers Send and Skip', /Antigravity/.test(card.head) && !/\]\(file:/.test(card.question) && card.buttons.includes('Send answer') && card.buttons.includes('Skip') && !card.elsewhere, JSON.stringify({ head: card.head, buttons: card.buttons, elsewhere: card.elsewhere }))
    const gem = JSON.parse(await gemState())
    say(`Gem while asking: ${JSON.stringify(gem)}`)
    check('Gem reads as waiting on you, in the header and the sidebar', gem.length >= 2 && gem.every((b) => b.activity === 'waiting' && b.ring), JSON.stringify(gem))
    await shoot('01-the-question-in-locust.png')
    const chosen = card.options[1]
    say(`choosing: ${chosen}`)
    await drive.evaluate(`(async () => {
      const card = ${CARD}.closest('.lc-card')
      card.querySelectorAll('.lc-question__option')[1].click()
      await new Promise((r) => setTimeout(r, 300))
      ;[...card.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Send answer').click()
      return 'sent'
    })()`)
    await drive.waitFor(`!(${CARD})`, { timeoutMs: 20_000, what: 'the card to go once the answer is delivered' })
    check('the answer is delivered and the card goes', true)
    await shoot('02-answered.png')
    await drive.waitFor(`/completed|failed|cancelled/i.test(document.querySelector('.lc-workroom__header')?.innerText ?? '')`, { timeoutMs: 150_000, everyMs: 1000, what: 'the run to finish' })
    const said = await header()
    const conversation = await activeConversation()
    const recorded = await recordedAnswer(conversation)
    say(`turn 1 settled: ${said.slice(0, 120)} || Antigravity recorded: ${String(recorded)} || thread ends: ${(await lastReply()).slice(-300)}`)
    check('Antigravity recorded the option picked in Locust as the answer', same(recorded, chosen), `${String(recorded)} vs ${chosen}`)
    check('and the run carries on to the end', /completed/i.test(said), said.slice(0, 120))
    await shoot('03-it-carried-on.png')
  }

  // ---- Turn 2: answered in Antigravity itself (through its server, as its
  // window does). A follow-up in the same conversation: it asks again.
  // `--once` stops after turn 1, to spend one turn instead of two.
  const second = process.argv.includes('--once') ? undefined : await askAndWaitForCard('turn 2')
  if (second === undefined) say('turn 2 skipped (--once)')
  if (second !== undefined) check('the second question arrives as a card too', second !== null)
  if (second !== undefined && second !== null) {
    const conversation = await activeConversation()
    const { token, ports } = server()
    let answered = 'not tried'
    let picked
    for (const port of ports) {
      const steps = await connect(port, token, 'GetCascadeTrajectorySteps', { cascadeId: conversation, stepOffset: 0 })
      if (steps.status !== 200) continue
      const waiting = JSON.parse(steps.text).steps?.findLast((step) => step.type === 'CORTEX_STEP_TYPE_ASK_QUESTION' && step.status !== 'CORTEX_STEP_STATUS_DONE')
      if (!waiting) { answered = 'no waiting step'; break }
      const info = waiting.metadata.sourceTrajectoryStepInfo
      const questions = waiting.askQuestion.questions
      picked = questions[0].options[2].text
      const result = await connect(port, token, 'HandleCascadeUserInteraction', {
        cascadeId: conversation,
        interaction: { trajectoryId: info.trajectoryId, stepIndex: info.stepIndex, askQuestion: { responses: questions.map((q) => ({ question: q.question, options: q.options, selectedOptionIds: [q.options[2].id] })) } }
      })
      answered = `${String(result.status)} ${result.text.slice(0, 120)}`
      break
    }
    say(`answered in Antigravity (conversation ${String(conversation)}): ${answered}`)
    await drive.waitFor(`!(${CARD})`, { timeoutMs: 30_000, what: "the card to go once Antigravity has the answer" })
    check("a question answered in Antigravity's own window leaves Locust's card", true)
    await drive.waitFor(`/completed|failed|cancelled/i.test(document.querySelector('.lc-workroom__header')?.innerText ?? '')`, { timeoutMs: 150_000, everyMs: 1000, what: 'the second run to finish' })
    check('and the run carries on to the end', /completed/i.test(await header()), (await header()).slice(0, 120))
    const recorded = await recordedAnswer(conversation)
    check('with the answer given in Antigravity', same(recorded, picked), `${String(recorded)} vs ${String(picked)}`)
    await shoot('04-answered-elsewhere.png')
  }
  say(failures === 0 ? '\nANTIGRAVITY ANSWER PASSED' : `\nANTIGRAVITY ANSWER: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
  await shoot('99-where-it-stopped.png').catch(() => undefined)
} finally {
  await drive.finish({ intro: "Antigravity asks, and Locust answers. Two Antigravity Flash turns on the person's own account." })
}
