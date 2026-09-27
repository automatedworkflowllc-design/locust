// "Ask me first": a teammate proposes a memory, the person decides.
//
//   node _tools/drive-ask-memory.mjs [--packaged <exe>]
//
// Two teammates on the free OpenCode model, memory mode Ask me first. Booty
// is asked to remember something with the block; the thread must say it is
// waiting; Settings and Memory must count it; Keep on the Memory screen
// makes it kept; Wren then quotes it.

import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

// C6 (plan 2026-09-24): the same drive against a packaged build.
const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined

const workspace = await scratchRepository('locust-drive-askmem-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'ask-memory',
  port: 9303,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: { ...FREE_ROUTE, mode: 'ask' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'ask' }
  }
})
const pick = (name) => `(async () => { ${teammateFace(name)}.click(); await new Promise(r => setTimeout(r, 500)); return 'picked ${name}' })()`

try {
  await drive.capture('launch, mode Ask me first', () => drive.ready())
  /*
   * SAY WHICH ROUTE, rather than inheriting whatever the composer defaulted
   * to. This drive seeds its teammates with FREE_ROUTE, and a teammate's
   * seeded route is NOT the composer's route on a new conversation -- a drive
   * that assumed otherwise on 2026-09-20 sent its turn on Codex, which is
   * Astra's quota, and passed every check it made. `ready()` now refuses to
   * start a non-spending drive on a paid route; this line is the drive saying
   * what it meant rather than relying on that refusal to notice.
   */
  await drive.capture('pick the free route', () =>
    drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/free/i' }))
  )
  await drive.capture('ask Booty to remember the deploy command', async () => {
    await drive.evaluate(pick('Booty'))
    return drive.evaluate(sendAndWaitScript('Remember, for this project only, that deploys run with pnpm deploy. Use the memory block you were shown. Then reply with the single word OK.'))
  })
  await drive.capture('the thread says it is waiting for the person', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-memorycard .lc-activity')
    if (!fold) return 'no memory fold: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-200) ?? '')
    const summary = fold.innerText.replace(/\\s+/g, ' ')
    // Only if it is closed. A finished turn's fold opens itself since 0.49.0,
    // so an unconditional click CLOSES it and the rows below read as absent.
    if (fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 300))
    return summary + ' || ' + [...document.querySelectorAll('.lc-memorycard__line')].map(l => l.innerText.replace(/\\s+/g, ' ')).join(' / ')
  })()`))
  await drive.capture('Settings counts one waiting', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 800))
    // Settings has pages since 0.393 and opens on General; memory is its own page.
    ;[...document.querySelectorAll('.lc-settings__navitem')].find((item) => item.innerText.trim() === 'Memory')?.click()
    await new Promise(r => setTimeout(r, 500))
    const heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => /remembers/.test(h.textContent))
    heading?.scrollIntoView({ block: 'start' })
    await new Promise(r => setTimeout(r, 400))
    return heading?.closest('.lc-settings__section')?.innerText.replace(/\\s+/g, ' ').slice(0, 260) ?? 'no memory section'
  })()`))
  await drive.capture('the Memory screen: the proposal with Keep and Forget', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    const rows = [...document.querySelectorAll('.lc-memory')].map(r => (r.classList.contains('is-proposed') ? '[proposed] ' : '') + r.innerText.replace(/\\s+/g, ' ').slice(0, 140))
    return (document.querySelector('.lc-screen__meta')?.innerText ?? '') + ' || ' + rows.join(' | ')
  })()`))
  await drive.capture('press Keep', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-memory.is-proposed')].find(r => /deploy/i.test(r.innerText))
    if (!row) return 'no proposed row'
    ;[...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'Keep')?.click()
    await new Promise(r => setTimeout(r, 700))
    return (document.querySelector('.lc-screen__meta')?.innerText ?? '') + ' || ' + [...document.querySelectorAll('.lc-memory')].map(r => (r.classList.contains('is-proposed') ? '[proposed] ' : '') + r.innerText.replace(/\\s+/g, ' ').slice(0, 120)).join(' | ')
  })()`))
  await drive.capture('Wren quotes what is kept now', async () => {
    await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
    await drive.evaluate(pick('Wren'))
    return drive.evaluate(sendAndWaitScript('Your brief lists what your team remembers. Quote every remembered line, one per line, word for word. If there is none, reply NONE.'))
  })
  await drive.capture('Booty proposes another; this time Forget it', async () => {
    await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
    await drive.evaluate(pick('Booty'))
    await drive.evaluate(sendAndWaitScript('Remember, for this project only, that the test command is pnpm test. Use the memory block you were shown. Then reply with the single word OK.'))
    return drive.evaluate(`(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
      await new Promise(r => setTimeout(r, 700))
      const row = [...document.querySelectorAll('.lc-memory.is-proposed')].find(r => /pnpm test/i.test(r.innerText))
      if (!row) return 'no second proposal: ' + [...document.querySelectorAll('.lc-memory')].map(r => r.innerText.replace(/\\s+/g, ' ').slice(0, 80)).join(' | ')
      ;[...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'Forget')?.click()
      await new Promise(r => setTimeout(r, 700))
      return (document.querySelector('.lc-screen__meta')?.innerText ?? '') + ' || ' + [...document.querySelectorAll('.lc-memory')].map(r => r.innerText.replace(/\\s+/g, ' ').slice(0, 100)).join(' | ')
    })()`)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: (packaged === undefined ? 'Build: whatever `pnpm build` last wrote to out/.' : 'Build: the packaged build.') + ' Wren and Booty on the free OpenCode model, memory mode Ask me first.' })
}
