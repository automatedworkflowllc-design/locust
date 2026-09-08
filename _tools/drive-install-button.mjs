// Press the Install button. The whole point of 0.38.0, never actually clicked.
//
//   node _tools/drive-install-button.mjs
//
// The fresh-machine drive proved the PANEL draws its buttons and that a person
// who installs by hand can then send a message. It never pressed the button,
// which is the feature. This does, on a machine with nothing installed, and
// then sends a message on what the button installed.
//
// It is safe to run on a machine that already has these CLIs, and that is not
// luck: npm's global prefix on Windows is `%APPDATA%\npm`, and this drive
// points APPDATA at an empty folder -- MEASURED, not assumed
// (`APPDATA=<temp> npm config get prefix` answers `<temp>\npm`). So the
// install the app runs lands in the drive's own sandbox, which is also
// exactly where the app's path locator probes. Nothing touches the real one.
//
// Slow by nature: a real `npm install -g` of a real package.

import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-button-ws-')
const emptyHome = await mkdtemp(join(tmpdir(), 'locust-drive-button-home-'))

const drive = await startDrive({
  name: 'install-button',
  port: 9321,
  workspace,
  env: {
    // npm STAYS reachable. The first version of this drive stripped PATH
    // entirely, which also stripped npm -- so pressing the button reported
    // "npm stopped with an error after 1s" for a machine that simply had no
    // npm. That is a PRECONDITION rather than a failure, it is detected at
    // discovery now, and it has its own test. This drive exists to press the
    // button on a machine where it can actually work.
    PATH: `${process.env.LOCUST_NPM_DIR ?? ''};C:\\Windows\\system32;C:\\Windows`,
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
  await drive.capture('nothing installed, and a button that offers to fix it', async () => {
    await drive.ready()
    const seen = await drive.evaluate(`(() => {
      const cell = [...document.querySelectorAll('.lc-runtimecell')].find(c => /OpenCode/.test(c.innerText))
      const button = cell?.querySelector('.lc-runtimecell__install')
      return 'runtimes connected: ' + (document.querySelector('.lc-sidebar')?.innerText.match(/(\\d+) runtimes? connected/)?.[1] ?? '?')
        + ' || OpenCode cell: ' + (cell === undefined ? 'ABSENT' : cell.innerText.replace(/[ ]+/g, ' ').split(String.fromCharCode(10)).join(' '))
        + ' || its button: ' + (button === null || button === undefined ? 'NONE' : button.innerText.trim() + (button.disabled ? ' [disabled]' : ''))
    })()`)
    return String(seen)
  })

  await drive.capture('press it, and watch what the app says while npm works', () => drive.evaluate(`(async () => {
    const cell = [...document.querySelectorAll('.lc-runtimecell')].find(c => /OpenCode/.test(c.innerText))
    const button = cell?.querySelector('.lc-runtimecell__install')
    if (button === null || button === undefined) return 'NO BUTTON TO PRESS'
    button.click()
    // What it says while it works, sampled: the label, the shared line, and
    // whether the other buttons stood down.
    const seen = []
    let others = 'not checked'
    for (let i = 0; i < 600; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      // While installing, the cell draws a TAG, not a button -- it keeps its
      // box rather than becoming a spinner. Reading only the button gave
      // "undefined" for the whole run and hid what the screen actually said.
      const slot = cell.querySelector('.lc-runtimecell__install, .lc-runtimecell__tag, .lc-runtimecell__version')
      const label = slot?.innerText.trim()
      const note = document.querySelector('.lc-installnote')?.innerText.replace(/[ ]+/g, ' ').trim()
      if (i === 4) {
        const rest = [...document.querySelectorAll('.lc-runtimecell__install')].filter(b => b !== cell.querySelector('.lc-runtimecell__install'))
        others = rest.filter(b => b.disabled).length + ' of ' + rest.length + ' disabled while it runs'
      }
      const line = String(label) + ' :: ' + String(note)
      if (seen[seen.length - 1] !== line) seen.push(line)
      // Done when the cell stops offering an install at all -- it has become
      // the ready row.
      if (label === undefined && note === undefined) break
    }
    return 'others: ' + others + ' || over time: ' + seen.slice(0, 6).join('  ->  ')
  })()`))

  await drive.capture('what landed on disk, and what the app now says', async () => {
    const landed = await readdir(join(emptyHome, 'npm')).catch(() => [])
    const seen = await drive.evaluate(`(() => {
      const cell = [...document.querySelectorAll('.lc-runtimecell')].find(c => /OpenCode/.test(c.innerText))
      return 'connected: ' + (document.querySelector('.lc-sidebar')?.innerText.match(/(\\d+) runtimes? connected/)?.[1] ?? '?')
        + ' || OpenCode cell: ' + (cell === undefined ? 'gone from the panel' : cell.innerText.replace(/[ ]+/g, ' ').split(String.fromCharCode(10)).join(' '))
    })()`)
    return `npm prefix holds: ${landed.join(', ') || 'nothing'} || ${String(seen)}`
  })

  await drive.capture('and a message runs on what the button installed', async () => {
    await drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()
      await new Promise(r => setTimeout(r, 1200))
    })()`)
    await drive.evaluate(sendAndWaitScript('Reply with exactly the word INSTALLED and nothing else.', { waitSeconds: 300 }))
    return drive.evaluate(`(() => {
      const thread = document.querySelector('.lc-thread')?.innerText ?? ''
      const chip = [...document.querySelectorAll('.lc-control')].map(b => b.innerText.replace(/[ ]+/g, ' ')).find(t => /OpenCode|Codex/.test(t)) ?? 'no chip'
      return 'reply contains INSTALLED: ' + /INSTALLED/.test(thread) + ' || chip: ' + chip.split(String.fromCharCode(10)).join(' ')
    })()`)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. A machine with no coding-agent CLI, where the Install button is pressed for real and npm installs into the drive\'s own sandbox.'
  })
}
