// A busy model says so, at once, on a build (0.368).
//
//   LOCUST_SPEND=1 node _tools/drive-busy-model.mjs [--packaged <exe>] [--tag <name>] [--approve-each]
//
// --approve-each sends it in Approve each, which runs OpenCode as a server:
// the same news arrives as the server's `retry` status instead of a log line
// (0.369).
//
// The 0.367 sweep's drives sat on "Starting" for six minutes on the free Ling
// model: its provider was answering "Rate limit exceeded. Please try again
// later." and OpenCode waits minutes between tries. OpenCode logs one line per
// try, and Locust spoke only on the second -- minutes away.
//
// The busy provider, on demand: a local OpenAI-compatible endpoint whose
// model `busy-1` passes Settings' Test (a one-token call) and answers every
// real request 429 with a two-minute retry-after. Added as "Busy Chat", a
// teammate is sent one message; within half a minute the conversation must
// say what the provider answered and what to do. Then Stop, as a person
// would. LOCUST_SPEND=1 only because a drive window refuses every route that
// is not a free model; nothing is spent -- the endpoint is this drive's own.

import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const APPROVE_EACH = process.argv.includes('--approve-each')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `busy-model${process.argv.includes('--approve-each') ? '-approve-each' : ''}-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const asked = []
const server = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    const parsed = (() => { try { return JSON.parse(body) } catch { return {} } })()
    asked.push({ method: request.method, url: request.url, maxTokens: parsed.max_tokens ?? null, at: Date.now() })
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'busy-1', object: 'model' }] }))
      return
    }
    // Settings' Test: one token, answered, so the model can be added.
    if (request.method === 'POST' && request.url === '/v1/chat/completions' && parsed.max_tokens === 1) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 't', object: 'chat.completion', created: 1, model: 'busy-1', choices: [{ index: 0, message: { role: 'assistant', content: 'o' }, finish_reason: 'length' }] }))
      return
    }
    // Every real request: busy, come back in two minutes -- a free provider's wait.
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '120' })
      response.end(JSON.stringify({ error: { message: 'Rate limit exceeded. Please try again later.', type: 'rate_limit_error' } }))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'not here' } }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const ADDRESS = `http://127.0.0.1:${String(server.address().port)}/v1`

const workspace = await scratchRepository('locust-drive-busy-model-ws-')
const drive = await startDrive({
  name: 'busy-model',
  port: 9661,
  workspace,
  spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: new Date(Date.now() - 86_400_000).toISOString(), route: FREE_ROUTE }],
    missionOwners: {}
  }
})

const type = (selector, value) => `(() => {
  const input = document.querySelector(${JSON.stringify(selector)})
  if (!input) return false
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
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
    if (said) return said
  }
  return 'nothing said'
})()`


/** Approve each, from the chat box's mode chip (as drive-opencode-approve-each). */
const MODE = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click(); await new Promise((r) => setTimeout(r, 400))
  const approve = [...document.querySelectorAll('[role=menuitemradio]')].find((b) => /^Approve each/.test(b.innerText.trim()))
  if (!approve || approve.disabled) { control.click(); return 'no Approve each: ' + (approve?.getAttribute('title') ?? 'not listed') }
  approve.click(); await new Promise((r) => setTimeout(r, 400))
  return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
})()`

const verdicts = []
try {
  await drive.capture('launch: Wren on the free route', () => drive.ready())
  await drive.capture('Settings > Your own models', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 900))
    // Its own page in Settings (settingsPages.ts); it was a section of AI agents.
    ;[...document.querySelectorAll('.lc-settings__navitem, button')].find((b) => b.textContent.trim() === 'Your own models')?.click()
    for (let i = 0; i < 20 && !document.querySelector('.lc-ownmodel__form'); i += 1) await new Promise((r) => setTimeout(r, 150))
    return document.querySelector('.lc-ownmodel__form') ? 'found' : 'no Your own models form on the Your own models page'
  })()`))
  await drive.evaluate(type(inputs(1), 'Busy Chat'))
  await drive.evaluate(type(inputs(2), 'busy-1'))
  await drive.evaluate(type(inputs(3), ADDRESS))
  await drive.capture('Test, then Add', async () => `${await drive.evaluate(pressIn('.lc-ownmodel__actions', 'Test'))} || ${await drive.evaluate(pressIn('.lc-ownmodel__actions', 'Add model'))}`)
  await drive.capture('open Wren', () => drive.evaluate(`(async () => {
    const face = ${teammateFace('Wren')}
    face?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? 'no composer'
  })()`))
  const picked = await drive.capture('the picker: Busy Chat under Your models', () => drive.evaluate(pickRouteScript({ group: '/Your models/i', search: 'Busy', row: '/Busy Chat/' })))
  verdicts.push(`picked: ${/Busy Chat/.test(picked) ? 'PASS' : 'FAIL'}`)
  if (APPROVE_EACH) {
    const mode = await drive.capture('Approve each, so OpenCode runs as a server', () => drive.evaluate(MODE))
    verdicts.push(`approve each: ${/^mode: Approve/.test(String(mode)) ? 'PASS' : 'FAIL'}`)
  }

  // One message, then watch the conversation for what the provider said.
  const sent = Date.now()
  const started = await drive.evaluate(sendAndWaitScript('Say hello.', { settle: false }))
  if (started !== 'sent') throw new Error(`the message was not sent: ${String(started)}`)
  let said = ''
  for (let waited = 0; waited < 45_000 && said === ''; waited += 1000) {
    await sleep(1000)
    said = await drive.evaluate(`[...document.querySelectorAll('.lc-diagnostic')].map((n) => n.innerText.replace(/\\s+/g, ' ').trim()).find((text) => /Rate limit exceeded/.test(text)) ?? ''`)
  }
  const after = Math.round((Date.now() - sent) / 1000)
  await drive.capture('the conversation, while the provider is busy', async () => said || 'nothing said')
  const tries = asked.filter((entry) => entry.url === '/v1/chat/completions' && entry.maxTokens !== 1).length
  say(`said after ${String(after)}s, the endpoint asked ${String(tries)} times: ${said}`)
  verdicts.push(`said within 30s: ${said !== '' && after <= 30 ? 'PASS' : 'FAIL'} (${String(after)}s)`)
  verdicts.push(`names the provider's words: ${/Rate limit exceeded\. Please try again later\./.test(said) ? 'PASS' : 'FAIL'}`)
  verdicts.push(`says what to do: ${/press Stop and pick another model/.test(said) ? 'PASS' : 'FAIL'}`)
  await drive.capture('Stop, as the person would', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label^="Stop the running"]')?.click()
    await new Promise((r) => setTimeout(r, 2500))
    return document.querySelector('button[aria-label^="Stop the running"]') ? 'still running' : 'stopped'
  })()`))
  say(verdicts.join(' | '))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  server.close()
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. A local endpoint plays a busy provider: busy-1 passes Test, then answers every run 429 "Rate limit exceeded. Please try again later." with retry-after 120. Verdicts: ${verdicts.join('; ')}` })
}
