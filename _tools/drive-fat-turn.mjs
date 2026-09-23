// One turn that touches a dozen files, and whether the fold still behaves.
//
//   node _tools/drive-fat-turn.mjs
//
// `drive-long-conversation` showed eight turns reading cleanly with every fold
// open -- but each of those turns touched ONE file, so it did not test the
// thing the old `openByDefault` comment actually warned about: "Every finished
// fold opening would make a long conversation a wall of tool rows."
//
// A wall needs a fat turn. This asks for twelve files in one go and then reads
// how tall that single fold is, how many rows land on screen at once, and
// whether the teammate's reply -- the thing a person is waiting for -- is still
// visible without scrolling.
//
// That last one is the real question. The whole argument for showing command
// output and file rows is that they are the record; the argument against is
// that they can bury the sentence the person actually asked for.
//
// Free OpenCode model, packaged binary, throwaway profile. Costs nothing.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, pickRouteScript, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!existsSync(EXE)) {
  say(`no packaged build at ${EXE}`)
  process.exit(1)
}

const workspace = await scratchRepository('locust-fat-ws-')
const drive = await startDrive({
  name: 'fat-turn',
  port: 9429,
  packaged: EXE,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const CHIP = `(() => {
  const c = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
  return (c?.textContent ?? '').trim()
})()`

/**
 * How tall the fold is, and whether the REPLY survived it.
 *
 * `replyVisible` is the one that matters: a fold that pushes the teammate's
 * sentence off the screen has buried the answer under the evidence for it.
 */
const SHAPE = `(() => {
  const folds = [...document.querySelectorAll('.lc-activity')]
  const rows = [...document.querySelectorAll('.lc-filerow')]
  const replies = [...document.querySelectorAll('.lc-agentline__body')]
  const last = replies[replies.length - 1] ?? null
  const box = last === null ? null : last.getBoundingClientRect()
  const foldEl = folds[folds.length - 1] ?? null
  const foldBox = foldEl === null ? null : foldEl.parentElement?.getBoundingClientRect() ?? null
  return JSON.stringify({
    folds: folds.length,
    foldsOpen: folds.filter((el) => el.getAttribute('aria-expanded') === 'true').length,
    toolRowsTotal: rows.length,
    toolRowsOnScreen: rows.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.bottom > 0 && r.top < window.innerHeight
    }).length,
    foldPixels: foldBox === null ? null : Math.round(foldBox.height),
    viewportPixels: window.innerHeight,
    replyVisible: box === null ? null : box.top < window.innerHeight && box.bottom > 0,
    replyText: last === null ? null : (last.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 80)
  })
})()`

try {
  await drive.capture('open a teammate on the free model', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise((r) => setTimeout(r, 900))
    })()`)
    await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
    return `route is ${String(await drive.evaluate(CHIP))}`
  })

  const route = String(await drive.evaluate(CHIP))
  if (!/opencode/i.test(route)) throw new Error(`route is ${JSON.stringify(route)} -- refusing to spend a paid runtime`)

  await drive.capture('one turn that writes twelve files', async () => {
    await drive.evaluate(`(async () => {
      const box = document.querySelector('textarea[aria-label="Mission instruction"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(box, 'Create twelve files in a folder called batch: batch/a.txt through batch/l.txt, each containing its own letter. Use one command per file. Then reply with exactly the sentence: All twelve are written.')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 250))
      box.focus()
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      for (let waited = 0; waited < 180000; waited += 500) {
        await new Promise((r) => setTimeout(r, 500))
        if (waited > 4000 && document.querySelector('button[aria-label^="Stop the running"]') === null) break
      }
      await new Promise((r) => setTimeout(r, 1500))
      return 'settled'
    })()`)
    return drive.evaluate(SHAPE)
  })

  await drive.capture('what a person sees without scrolling', async () => {
    return drive.evaluate(SHAPE)
  })

  await drive.capture('and with the fold closed by hand', async () => {
    return drive.evaluate(`(async () => {
      const fold = [...document.querySelectorAll('.lc-activity')].pop()
      if (fold !== undefined && fold.getAttribute('aria-expanded') === 'true') fold.click()
      await new Promise((r) => setTimeout(r, 800))
      return ${SHAPE}
    })()`)
  })
} finally {
  await drive.finish({
    intro: 'One fat turn: twelve files in a single fold, to see whether the record buries the answer.'
  })
}

say('done')
