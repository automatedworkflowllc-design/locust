// The app is killed with a run in flight, and opened again.
//
//   node _tools/drive-interrupted.mjs
//
// A beta gate nobody had run: every drive so far has let its runs finish.
// A person closes the laptop, the machine sleeps, the app is force-quit --
// and the question is whether the record survives that honestly. The three
// things that must hold: the mission reads INTERRUPTED rather than still
// running or quietly completed, the ledger still opens with its history
// intact, and the next run starts normally on the same profile.
//
// The kill here is `child.kill()` on the Electron process, which is what a
// force-quit or a lost power does -- no `before-quit`, no graceful flush,
// so the record has to be recoverable from what was already written rather
// than from anything the app does on the way out.
//
// Spends one short OpenCode run on the free model, which is stopped part
// way, and one more to prove the profile still works.

import { rm } from 'node:fs/promises'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-interrupted-ws-')
const seed = {
  schemaVersion: 1,
  teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
  missionOwners: {},
  settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
}

let drive = await startDrive({ name: 'interrupted', port: 9311, workspace, seed, keep: true })
let handoff

try {
  await drive.capture('launch, and a run started but not waited for', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren')).click(); await new Promise(r => setTimeout(r, 500)) })()`)
    const route = await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/muse/i' }))
    // `settle: false` returns as soon as it is sent; the point is to be mid-run.
    await drive.evaluate(sendAndWaitScript('Count slowly from 1 to 40, one number per line, then say done.', { settle: false }))
    const seen = await drive.evaluate(`(async () => {
      for (let i = 0; i < 80; i += 1) {
        await new Promise(r => setTimeout(r, 250))
        if (document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 90) ?? 'no header'
      return 'running: ' + (document.querySelector('button[aria-label^="Stop the running"]') !== null) + ' || ' + header
    })()`)
    // Awaited before joining: concatenating the promise itself put
    // "[object Promise]" in the record (2026-09-06).
    return `${String(seen)} || ${String(route)}`
  })

  handoff = await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on the free OpenCode model, killed mid-run and opened again.',
    last: false
  })
} catch (error) {
  say(`first half failed: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  // The same profile, opened again -- as a person would after a force-quit.
  drive = await startDrive({
    name: 'interrupted',
    port: 9311,
    workspace,
    profilePath: handoff.profile,
    outPath: handoff.out,
    stepFrom: handoff.step
  })

  await drive.capture('opened again: what the record says about the run that was cut off', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      document.querySelector('button[title="All missions (Ctrl 1)"]')?.click()
      await new Promise(r => setTimeout(r, 1200))
      const rows = [...document.querySelectorAll('.lc-missionrow, .lc-mission')].map(r => r.innerText.replace(/[ \\t\\n]+/g, ' ').trim()).slice(0, 3)
      const screen = document.querySelector('.lc-screen, main')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 220) ?? ''
      return 'missions listed: ' + rows.length + ' || ' + (rows.join(' | ') || screen)
    })()`)
  })

  await drive.capture('the interrupted conversation, opened', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-teammate')].find(r => /Wren/.test(r.innerText))
    row?.querySelector('.lc-teammate__mission')?.click()
    await new Promise(r => setTimeout(r, 1200))
    const header = document.querySelector('.lc-workroom__header')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 140) ?? 'no header'
    const thread = document.querySelector('.lc-thread')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(-200) ?? 'no thread'
    return 'header: ' + header + ' || thread ends: ' + thread
  })()`))

  await drive.capture('and the profile still works: a fresh run on it', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 700)) })()`)
    await drive.evaluate(sendAndWaitScript('Reply with the single word RECOVERED.', { waitSeconds: 240 }))
    return drive.evaluate(`(document.querySelector('.lc-thread')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(-160) ?? '')`)
  })
} catch (error) {
  say(`second half failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on the free OpenCode model, killed mid-run and opened again.' })
  if (handoff !== undefined) await rm(handoff.profile, { recursive: true, force: true }).catch(() => undefined)
}
