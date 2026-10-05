// A model of your own, end to end on a build (0.357).
//
//   LOCUST_SPEND=1 node _tools/drive-own-model.mjs [--packaged <exe>] [--tag <name>]
//
// A company's model, played by a local OpenAI-compatible endpoint this drive
// starts: GET /v1/models lists `acme-70b`, POST /v1/chat/completions streams
// "Hello from Acme." -- and it records what it was asked, so the key and the
// model can be checked at the far end. LOCUST_SPEND=1 only because a drive
// window refuses every route that is not a free model; nothing is spent.
//
// It must: add "Acme Chat" in Settings > Runtimes > Your own models, where
// Test says the endpoint serves the model; list it in the model picker under
// Your models; run a teammate on it and show the endpoint's reply; send the
// key as a bearer token to that endpoint; and keep the key off the disk in
// the clear.

import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `own-model-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const KEY = 'sk-drive-acme-7731'
const asked = []
const server = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    const parsed = (() => { try { return JSON.parse(body) } catch { return {} } })()
    const tools = Array.isArray(parsed.tools) ? parsed.tools.length : 0
    asked.push({ method: request.method, url: request.url, auth: request.headers.authorization ?? null, model: parsed.model ?? null, tools })
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'acme-70b', object: 'model' }, { id: 'plain-1', object: 'model' }] }))
      return
    }
    // plain-1 is a model that cannot take tools, answering the way Ollama does.
    if (request.method === 'POST' && request.url === '/v1/chat/completions' && parsed.model === 'plain-1' && tools > 0) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'registry.example/plain-1 does not support tools', type: 'invalid_request_error' } }))
      return
    }
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunk = (data) => response.write(`data: ${JSON.stringify(data)}\n\n`)
      const base = { id: 'acme-1', object: 'chat.completion.chunk', created: 1, model: parsed.model ?? 'acme-70b' }
      chunk({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: parsed.model === 'plain-1' ? 'Plain hello.' : 'Hello from Acme.' }, finish_reason: null }] })
      chunk({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } })
      response.end('data: [DONE]\n\n')
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'not here' } }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const ADDRESS = `http://127.0.0.1:${String(server.address().port)}/v1`

const workspace = await scratchRepository('locust-drive-own-model-ws-')
const drive = await startDrive({
  name: 'own-model',
  port: 9616,
  workspace,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: new Date(Date.now() - 86_400_000).toISOString(), route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

const type = (selector, value) => `(() => {
  const input = document.querySelector(${JSON.stringify(selector)})
  if (!input) return false
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`

const settingsRuntimes = `(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 900))
  // Its own page in Settings (settingsPages.ts); it was a section of AI agents.
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Your own models')?.click()
  for (let i = 0; i < 20 && !document.querySelector('.lc-ownmodel__form'); i += 1) await new Promise((r) => setTimeout(r, 150))
  const form = document.querySelector('.lc-ownmodel__form')
  if (!form) return 'no Your own models form on the Runtimes page'
  form.closest('section')?.scrollIntoView({ block: 'start' })
  return 'found: ' + (form.closest('section')?.querySelector('h2')?.textContent ?? '?')
})()`

const inputs = (index) => `.lc-ownmodel__form label:nth-of-type(${String(index)}) input`
const pressIn = (scope, label) => `(async () => {
  const button = [...document.querySelectorAll(${JSON.stringify(scope)} + ' button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)})
  if (!button) return 'no ' + ${JSON.stringify(label)} + ' button'
  if (button.disabled) return ${JSON.stringify(label)} + ' is disabled'
  button.click()
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250))
    const said = document.querySelector('.lc-ownmodel__form .lc-ownmodel__said')?.textContent
    if (said && !said.startsWith('Testing')) return said
  }
  return 'nothing said'
})()`

const verdicts = []
try {
  await drive.capture('launch: Wren on the free route, no model of your own yet', () => drive.ready())
  await drive.capture('Settings > Runtimes: Your own models', () => drive.evaluate(settingsRuntimes))
  await drive.evaluate(type(inputs(1), 'Acme Chat'))
  await drive.evaluate(type(inputs(2), 'acme-70b'))
  await drive.evaluate(type(inputs(3), ADDRESS))
  await drive.evaluate(type(inputs(4), KEY))
  const tested = await drive.capture('Test, before adding', () => drive.evaluate(pressIn('.lc-ownmodel__actions', 'Test')))
  verdicts.push(`test: ${/It answered, and serves acme-70b\./.test(tested) ? 'PASS' : 'FAIL'}`)
  const added = await drive.capture('Add model', () => drive.evaluate(pressIn('.lc-ownmodel__actions', 'Add model')))
  const row = await drive.evaluate(`document.querySelector('.lc-ownmodel')?.innerText.replace(/\\s+/g, ' ') ?? 'no row'`)
  verdicts.push(`added: ${/is in every teammate's model list/.test(added) && /Acme Chat/.test(row) && /key kept/.test(row) && !row.includes(KEY) ? 'PASS' : 'FAIL'}`)
  await drive.capture('open Wren', () => drive.evaluate(`(async () => {
    const face = ${teammateFace('Wren')}
    face?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? 'no composer'
  })()`))
  const picked = await drive.capture('the picker: Acme Chat under Your models', () => drive.evaluate(pickRouteScript({ group: '/Your models/i', search: 'Acme', row: '/Acme Chat/' })))
  verdicts.push(`picked: ${/Acme Chat/.test(picked) ? 'PASS' : 'FAIL'}`)
  const answered = await drive.capture('Wren runs on Acme Chat', () => drive.evaluate(sendAndWaitScript('Say hello.', { waitSeconds: 180 })))
  verdicts.push(`answered: ${/Hello from Acme\./.test(answered) ? 'PASS' : 'FAIL'}`)
  /*
   * NAMED AS YOURS (0.361): the chip read "OpenCode / Acme Chat" and the
   * header "Code & Migrations · OpenCode". The chip is the route button, the
   * header's role line sits beside the name.
   */
  const named = await drive.evaluate(`JSON.stringify({
    chip: (document.querySelector('form.command-dock button[aria-haspopup="listbox"]')?.innerText ?? '').replace(/\\s+/g, ' ').trim(),
    header: (document.querySelector('.lc-workroom__role')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
  })`)
  say(`named: ${named}`)
  const { chip, header } = JSON.parse(named)
  verdicts.push(`named as yours: ${/^Acme Chat/.test(chip) && !/OpenCode/.test(chip) && /Your model/.test(header) && !/OpenCode/.test(header) ? 'PASS' : 'FAIL'} (${chip} | ${header})`)
  // Test's own tools check is a chat call too, capped at one token: counted
  // apart from the run's.
  const completions = asked.filter((entry) => entry.url === '/v1/chat/completions' && entry.model === 'acme-70b')
  verdicts.push(`at the endpoint: ${completions.length > 0 && completions.every((entry) => entry.auth === `Bearer ${KEY}`) ? 'PASS' : 'FAIL'} (${String(completions.length)} chat calls)`)

  /*
   * A MODEL THAT ONLY CHATS (0.358). plain-1 refuses any request carrying
   * tools. Test must find that out and set it to chat only; a teammate on it
   * must then be answered, its runs carrying no tools at all.
   */
  await drive.capture('Settings again, for a model that cannot take tools', () => drive.evaluate(settingsRuntimes))
  await drive.evaluate(type(inputs(1), 'Plain Chat'))
  await drive.evaluate(type(inputs(2), 'plain-1'))
  await drive.evaluate(type(inputs(3), ADDRESS))
  const plainTested = await drive.capture('Test finds it cannot take tools', () => drive.evaluate(pressIn('.lc-ownmodel__actions', 'Test')))
  const switchSays = await drive.evaluate(`document.querySelector('.lc-ownmodel__tools .lc-ownmodel__name')?.textContent ?? 'no switch'`)
  verdicts.push(`found chat only: ${/cannot use tools, so it is set to chat only/.test(plainTested) && switchSays === 'Chat only' ? 'PASS' : 'FAIL'}`)
  await drive.capture('Add the chat-only model', () => drive.evaluate(pressIn('.lc-ownmodel__actions', 'Add model')))
  const plainRow = await drive.evaluate(`[...document.querySelectorAll('.lc-ownmodel')].map((row) => row.innerText.replace(/\\s+/g, ' ')).find((text) => text.includes('Plain Chat')) ?? 'no row'`)
  verdicts.push(`listed chat only: ${/chat only/.test(plainRow) ? 'PASS' : 'FAIL'}`)
  await drive.capture('open Wren again', () => drive.evaluate(`(async () => {
    const face = ${teammateFace('Wren')}
    face?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? 'no composer'
  })()`))
  const plainPicked = await drive.capture('the picker: Plain Chat under Your models', () => drive.evaluate(pickRouteScript({ group: '/Your models/i', search: 'Plain', row: '/Plain Chat/' })))
  verdicts.push(`picked chat only: ${/Plain Chat/.test(plainPicked) ? 'PASS' : 'FAIL'}`)
  const plainAnswered = await drive.capture('Wren chats on Plain Chat', () => drive.evaluate(sendAndWaitScript('Say hello again.', { waitSeconds: 180 })))
  verdicts.push(`answered chat only: ${/Plain hello\./.test(plainAnswered) ? 'PASS' : 'FAIL'}`)
  const plainRuns = asked.filter((entry) => entry.url === '/v1/chat/completions' && entry.model === 'plain-1')
  // The Test's own check carried one tool, on purpose; every run request carried none.
  verdicts.push(`no tools sent in the run: ${plainRuns.filter((entry) => entry.tools === 0).length > 0 && plainRuns.filter((entry) => entry.tools > 0).length === 1 ? 'PASS' : 'FAIL'} (${plainRuns.map((entry) => String(entry.tools)).join(',')})`)
  const onDisk = await readFile(join(drive.profile, 'own-models.json'), 'utf8').catch(() => '')
  verdicts.push(`key on disk in the clear: ${onDisk.length > 0 && !onDisk.includes(KEY) ? 'no -- PASS' : 'FAIL'}`)
  say(verdicts.join(' | '))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  server.close()
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. A local OpenAI-compatible endpoint plays the company's model (acme-70b, key ${KEY.slice(0, 8)}...). Verdicts: ${verdicts.join('; ')}` })
}
