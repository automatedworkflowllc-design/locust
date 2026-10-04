// A key is never remembered (0.394).
//
//   node _tools/drive-secret-not-remembered.mjs [--packaged <exe>] [--tag <name>]
//
// Spends nothing: the person types a memory on the Memory screen, as anyone
// can, and it holds a key -- made up, in an OpenAI key's shape. It must be
// refused with the reason on screen, and nothing written to the memory file.
// Then an ordinary note that only MENTIONS a key is kept, so the check is
// not refusing everything.

import { readFile } from 'node:fs/promises'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('secret-not-remembered-2026-09-27'), `secret-not-remembered-${tag}`)
await mkdir(OUT, { recursive: true })
const FAKE_KEY = `sk-proj-${'Zx9Yw8Vu'.repeat(4)}`

const workspace = await scratchRepository('locust-secret-ws-')
const profile = await mkdtemp(join(tmpdir(), 'locust-drive-secret-'))
const drive = await startDrive({
  name: `secret-not-remembered-${tag}`,
  port: 9697,
  workspace,
  profilePath: profile,
  outPath: OUT,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const remember = (text) => drive.evaluate(`(async () => {
  const field = document.querySelector('.lc-memoryform .lc-input')
  if (!field) return 'NO FIELD'
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 200))
  document.querySelector('.lc-memoryform .lc-primarybutton')?.click()
  await new Promise((r) => setTimeout(r, 1200))
  return document.querySelector('main, .lc-screen')?.innerText.replace(/\\s+/g, ' ') ?? ''
})()`)

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.capture('the Memory screen', async () => {
    await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))`)
    await sleep(900)
    return drive.evaluate(`String(document.querySelector('.lc-memoryform') !== null)`)
  })
  const refused = String(await drive.capture('remember a note that holds a key', () => remember(`The staging deploy key is ${FAKE_KEY}.`)))
  check('refused, with the reason on screen', /OpenAI API key/.test(refused) && /not kept/.test(refused), refused.slice(0, 240))
  const disk = await readFile(join(profile, 'memories.json'), 'utf8').catch(() => '')
  check('nothing written to the memory file', !disk.includes(FAKE_KEY), `${String(disk.length)} bytes`)
  const kept = String(await drive.capture('remember a note that only mentions keys', () => remember('Keep the API key in .env, never in the repo.')))
  const after = await readFile(join(profile, 'memories.json'), 'utf8').catch(() => '')
  check('an ordinary note about keys is kept', after.includes('Keep the API key in .env'), kept.slice(0, 160))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. A made-up key in an OpenAI key's shape, typed on the Memory screen.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
