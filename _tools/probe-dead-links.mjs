// Every "Get it" link in the app was dead. Are they now?
//
//   node _tools/probe-dead-links.mjs
//
// The host denies window.open and cancels navigation away from its own URL,
// on purpose -- shell.openExternal bypasses every egress rule the packaged
// build has. The note beside that policy asked that a feature needing a link
// name the exact URL in the HOST. The first-run panel then grew three
// <a target="_blank"> links and nobody did, so all three were dead in every
// build that shipped them: they rendered, they had a cursor, and clicking
// did nothing at all. Found by the first outside tester on 0.55.0, who had
// no Node.js and whose only offered way out was one of them.
//
// Launched as a machine with nothing installed, the way that tester saw it.
//
// NOTE: the last step really does open a browser tab, because that is the
// only honest proof that the link works. Nothing else here leaves the app.

import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-probe-links-ws-')
// Somewhere with no CLI in it, standing in for a machine that has none.
const emptyHome = await mkdtemp(join(tmpdir(), 'locust-probe-links-home-'))

const drive = await startDrive({
  name: 'dead-links',
  port: 9438,
  workspace,
  env: {
    PATH: 'C:\\Windows\\system32;C:\\Windows',
    APPDATA: emptyHome,
    LOCALAPPDATA: emptyHome
  },
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('a machine with nothing installed: what the panel offers', async () => {
    await drive.ready()
    return drive.evaluate(`(() => {
      const slots = [...document.querySelectorAll('.lc-runtimecell__install')]
      return 'slots: ' + slots.length +
        ' || tags: ' + slots.map(b => b.tagName + ':' + (b.innerText.trim() || '?') + (b.disabled ? ' [disabled]' : '')).join(' | ') +
        ' || note: ' + (document.querySelector('.lc-installnote')?.innerText.replace(/[ ]+/g, ' ').slice(0, 100) ?? 'none')
    })()`)
  })

  // The premise, outside capture(): no "Get it" on screen means nothing to
  // press, and the probe would report a link working that was never there.
  const gettable = await drive.evaluate(`[...document.querySelectorAll('.lc-runtimecell__install')].filter(b => /Get it/.test(b.innerText)).length`)
  if (Number(gettable) < 1) throw new Error('NOT A LINK TEST: no "Get it" control is on screen to press')
  say(`  ${String(gettable)} "Get it" control(s) on screen`)

  await drive.capture('none of them is an anchor any more', () => drive.evaluate(`(() => {
    // An <a href> to anywhere but the app does nothing here, silently. That
    // is the shape that shipped, so it is the shape this looks for.
    const anchors = [...document.querySelectorAll('a[href]')].filter(a => !a.getAttribute('href').startsWith('#'))
    return 'anchors that would navigate: ' + anchors.length +
      (anchors.length ? ' -- ' + anchors.map(a => a.getAttribute('href')).join(', ') : '') +
      ' || Get it is a: ' + ([...document.querySelectorAll('.lc-runtimecell__install')].find(b => /Get it/.test(b.innerText))?.tagName ?? 'MISSING')
  })()`))

  await drive.capture('the host refuses an address it does not allow', () => drive.evaluate(`(async () => {
    const said = await window.desktop.openLink('https://example.com/steal')
    return JSON.stringify(said)
  })()`))

  await drive.capture('and opens one it does: a real browser tab', () => drive.evaluate(`(async () => {
    const said = await window.desktop.openLink('https://nodejs.org')
    return JSON.stringify(said)
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Launched with an empty PATH, APPDATA and LOCALAPPDATA, so no coding-agent CLI is found -- the state the first outside tester was in.' })
}
