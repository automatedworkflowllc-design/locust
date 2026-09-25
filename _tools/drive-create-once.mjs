// Does a double click on Create teammate create one teammate (L22)?
//
//   node _tools/drive-create-once.mjs [--packaged <exe>] [--tag <name>]
//
// + then New teammate, a name typed, and Create teammate clicked twice in
// quick succession -- the way a double click, or an impatient second press,
// lands. The button had no busy state and every press saved, so the same
// teammate appeared twice. Sends nothing.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `create-once-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const drive = await startDrive({
  name: 'create-once',
  port: 9595,
  workspace: await scratchRepository('locust-drive-createonce-ws-'),
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1215, 800)
  await sleep(1200)
  const typed = String(await drive.capture('open New teammate and type a name', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-sidebar button[aria-label="Add"]')?.click()
    await new Promise((r) => setTimeout(r, 500))
    ;[...document.querySelectorAll('.lc-context__item')].find((b) => /^New teammate/.test(b.textContent.trim()))?.click()
    await new Promise((r) => setTimeout(r, 800))
    const field = document.querySelector('input[placeholder="Wren"]')
    if (!field) return 'no name field'
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(field, 'Twice')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    return 'typed'
  })()`)))
  check('the dialog took a name', typed === 'typed', typed)
  await drive.capture('click Create teammate twice, quickly', () => drive.evaluate(`(async () => {
    const create = [...document.querySelectorAll('button')].find((b) => /^Create teammate$/.test(b.textContent.trim()))
    if (!create) return 'no Create button'
    create.click()
    create.click()
    await new Promise((r) => setTimeout(r, 2500))
    return 'clicked twice'
  })()`))
  const count = Number(await drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => /^\\s*Team\\s*$/.test(b.textContent ?? ''))?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return (document.querySelector('.lc-screen')?.innerText.match(/Twice/g) ?? []).length
  })()`))
  await drive.capture('the Team screen', () => drive.evaluate(`document.querySelector('.lc-screen')?.innerText.replace(/\\s+/g, ' ').slice(0, 300) ?? ''`))
  check('one teammate named Twice was made', count >= 1 && count <= 1, `${String(count)} mention(s) on the Team screen`)
  say(failures === 0 ? '\nCREATE ONCE PASSED' : `\nCREATE ONCE: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. New teammate "Twice", with Create teammate clicked twice in a row.` })
}
