// One press off a busy free model, on a build (C9, 0.369).
//
//   node _tools/drive-busy-free-model.mjs [--packaged <exe>] [--tag <name>] [--model <busy free model id>]
//
// On 2026-09-26 the free Ling and Muse models were limited for hours while
// three other free models answered, and a new person starts on Ling. Wren is
// seeded on the busy one and sent one message. The busy notice must offer the
// next free model; pressing it must stop the run, put the chat box on that
// model and hand the message back; Enter then sends it there and a reply
// comes back. It needs the model to be busy: when it answers instead, the
// drive says so and tests nothing. Sends only on free models.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const BUSY = arg('--model') ?? 'opencode/ling-3.0-flash-fin-free'
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `busy-free-model-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-busy-free-ws-')
const drive = await startDrive({
  name: 'busy-free-model',
  port: 9663,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-20T00:00:00.000Z', route: { runtime: 'opencode', model: BUSY, mode: 'accept-edits' } }],
    missionOwners: {}
  }
})

const chip = `(document.querySelector('form.command-dock button[aria-haspopup="listbox"]')?.innerText ?? '').replace(/\\s+/g, ' ').trim()`
const verdicts = []
try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture(`open Wren, on ${BUSY}`, async () => `${String(await drive.evaluate(openTeammateScript('Wren')))} || chip: ${String(await drive.evaluate(chip))}`)
  const started = await drive.evaluate(sendAndWaitScript('Say hello.', { settle: false }))
  if (started !== 'sent') throw new Error(`the message was not sent: ${String(started)}`)
  let offer = ''
  for (let waited = 0; waited < 60_000 && offer === ''; waited += 1000) {
    await sleep(1000)
    offer = String(await drive.evaluate(`document.querySelector('.lc-diagnostic__action')?.innerText.trim() ?? ''`))
    const running = await drive.evaluate(`!!document.querySelector('button[aria-label^="Stop the running"]')`)
    if (offer === '' && !running) break
  }
  const notice = String(await drive.capture('the busy notice, and its offer', async () => offer || 'no offer'))
  if (offer === '') {
    say(`${BUSY} answered, or said nothing busy within a minute: nothing to test today.`)
    verdicts.push('busy: NOT BUSY -- skipped')
  } else {
    verdicts.push(`offer names a model: ${/^Stop and switch to \S/.test(offer) ? 'PASS' : 'FAIL'} (${offer})`)
    const named = offer.replace(/^Stop and switch to /, '')
    const after = JSON.parse(String(await drive.capture('pressed: stopped, switched, handed back', () => drive.evaluate(`(async () => {
      document.querySelector('.lc-diagnostic__action')?.click()
      for (let i = 0; i < 20 && document.querySelector('button[aria-label^="Stop the running"]'); i += 1) await new Promise((r) => setTimeout(r, 250))
      await new Promise((r) => setTimeout(r, 600))
      return JSON.stringify({
        running: !!document.querySelector('button[aria-label^="Stop the running"]'),
        chip: ${chip},
        box: document.querySelector('form.command-dock textarea')?.value ?? null,
        focused: document.activeElement === document.querySelector('form.command-dock textarea')
      })
    })()`))))
    say(`after the press: ${JSON.stringify(after)}`)
    verdicts.push(`the run stopped: ${after.running === false ? 'PASS' : 'FAIL'}`)
    // The offer names the model as the chip does, Free and all.
    verdicts.push(`the chip is on it, by the offer's name: ${after.chip.includes(named) ? 'PASS' : 'FAIL'} (${after.chip})`)
    verdicts.push(`the message is back in the box: ${after.box === 'Say hello.' && after.focused === true ? 'PASS' : 'FAIL'} (${String(after.box)})`)
    const answered = String(await drive.capture(`Enter: sent on ${named}`, () => drive.evaluate(sendAndWaitScript(String(after.box ?? 'Say hello.'), { waitSeconds: 180 }))))
    verdicts.push(`an answer came back: ${/finished:/.test(answered) && !/Rate limit exceeded/.test(answered.slice(-160)) ? 'PASS' : 'FAIL'}`)
    void notice
  }
  say(verdicts.join(' | '))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on ${BUSY}, busy when this ran or not; the notice's offer pressed, and the message sent again on the model it named. Verdicts: ${verdicts.join('; ')}` })
}
