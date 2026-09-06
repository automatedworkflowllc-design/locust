// What someone sees who has installed Locust and nothing else.
//
//   node _tools/drive-fresh-machine.mjs
//
// Every drive so far runs on a machine with all six runtimes installed and
// signed in, which is the one machine Locust has never had to explain itself
// to. Colin is sending this to Ian; Ian has none of them. So this launches the
// built app as a machine with no coding-agent CLI on it and reads what the app
// offers a person in that state.
//
// A fresh machine is not just an empty PATH. Discovery also looks in the
// folders each CLI installs itself into, keyed off APPDATA and LOCALAPPDATA --
// deliberately, because Cursor's installer appends to a user PATH that a
// packaged app cannot see until it restarts. Stripping PATH alone left every
// runtime READY, which is a good property of the app and a useless drive, so
// all three are pointed somewhere empty.
//
// It asserts nothing about beauty. It reads the sentences, because the question
// is whether a person can get from "nothing works" to "one teammate works"
// without leaving the app to go and search.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-fresh-ws-')
// Somewhere with no CLI in it, standing in for a machine that has none.
const emptyHome = await mkdtemp(join(tmpdir(), 'locust-drive-fresh-home-'))

const drive = await startDrive({
  name: 'fresh-machine',
  port: 9317,
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
  await drive.capture('launch with no coding agent installed', async () => {
    await drive.ready()
    return drive.evaluate(`(() => {
      const foot = document.querySelector('.lc-sidebar')?.innerText.replace(/[ ]+/g, ' ') ?? ''
      return 'sidebar tail: ' + foot.slice(-140)
    })()`)
  })

  await drive.capture('what the composer offers when nothing can run', () => drive.evaluate(`(() => {
    const dock = document.querySelector('form.command-dock')?.innerText.replace(/[ ]+/g, ' ') ?? 'no composer'
    return dock.split(String.fromCharCode(10)).join(' | ').slice(0, 240)
  })()`))

  await drive.capture('Settings: every runtime, and what it tells you to do', async () => {
    await drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => /Settings/.test(b.innerText))?.click()
      await new Promise(r => setTimeout(r, 900))
    })()`)
    return drive.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.lc-runtimerow')].map(r => r.innerText.replace(/[ ]+/g, ' ').split(String.fromCharCode(10)).join(' | '))
      return rows.join('  //  ').slice(0, 1400)
    })()`)
  })

  await drive.capture('is the free path actually reachable from here', () => drive.evaluate(`(() => {
    const text = document.body.innerText
    return 'opencode command shown: ' + /npm install -g opencode-ai/.test(text)
      + ' | claude command shown: ' + /npm install -g @anthropic-ai\\/claude-code/.test(text)
      + ' | copy buttons: ' + [...document.querySelectorAll('button')].filter(b => b.innerText.trim() === 'Copy').length
      + ' | says no sign-in needed: ' + /no account and no sign-in/.test(text)
      + ' | cursor sent to its own page: ' + /cursor.com\\/cli/.test(text)
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Launched as a machine with no coding-agent CLI: empty PATH, and APPDATA/LOCALAPPDATA pointed at an empty folder so the install-directory probes find nothing either.'
  })
}
