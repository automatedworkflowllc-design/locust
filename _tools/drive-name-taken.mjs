// Does the New teammate dialog refuse a name another teammate has (A2.18)?
//
//   node _tools/drive-name-taken.mjs [--packaged <exe>] [--tag <name>]
//
// Wren is on the roster. The dialog is opened the way a person opens it, and
// "wren" typed into the name: it must say the name is taken and keep Create
// off -- two Wrens could not be told apart by the name a message is sent to,
// so a message to either was refused. Then "Booty": free again. Spends
// nothing; no run starts.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `name-taken-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const drive = await startDrive({
  name: 'name-taken',
  port: 9543,
  workspace: await scratchRepository('locust-drive-name-ws-'),
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const typeName = (name) => `(async () => {
  const field = document.querySelector('#lc-teammate-name')
  if (!field) return JSON.stringify({ open: false })
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(name)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 400))
  const create = [...document.querySelectorAll('.lc-dialog__foot button')].find((b) => /Create teammate/.test(b.textContent))
  return JSON.stringify({
    open: true,
    note: document.querySelector('#lc-teammate-name-taken')?.textContent ?? '',
    createOff: create?.disabled === true
  })
})()`

try {
  await drive.capture('launch: Wren on the roster', () => drive.ready())
  await drive.capture('open New teammate from the +', () => drive.evaluate(`(async () => {
    const add = [...document.querySelectorAll('button[aria-label="Add"]')].find((b) => b.getBoundingClientRect().width > 0)
    add?.click()
    await new Promise((r) => setTimeout(r, 300))
    ;[...document.querySelectorAll('[role="menuitem"]')].find((b) => /New teammate/.test(b.textContent))?.click()
    await new Promise((r) => setTimeout(r, 700))
    return document.querySelector('#lc-teammate-name') ? 'open' : 'not open'
  })()`))
  const taken = JSON.parse(await drive.capture('type "wren": taken', () => drive.evaluate(typeName('wren'))))
  check('the dialog says the name is taken', /Another teammate is already called Wren\./.test(taken.note), taken.note)
  check('and Create stays off', taken.createOff === true)
  const free = JSON.parse(await drive.capture('type "Booty": free', () => drive.evaluate(typeName('Booty'))))
  check('a free name says nothing and Create comes on', free.note === '' && free.createOff === false, JSON.stringify(free))
  say(failures === 0 ? '\nNAME TAKEN PASSED' : `\nNAME TAKEN: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on the roster; the New teammate dialog with "wren", then "Booty".` })
}
