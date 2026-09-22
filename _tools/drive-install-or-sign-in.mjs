// Does the first screen tell "install it" apart from "sign in to it"?
//
//   node _tools/drive-install-or-sign-in.mjs
//
// Colin, 2026-09-22: "can that beginning screen know the difference if the
// user needs to "install" or "sign in"? that would be really good".
//
// Three states on one screen, from THIS machine without touching it:
//   - APPDATA points at an empty folder and PATH holds only Windows and Node,
//     which hides every npm-global CLI (claude, codex, copilot, opencode):
//     NOT INSTALLED. Cursor keeps its login under APPDATA too, so it reads
//     signed out here -- an artefact of the drive, not of the machine.
//   - XDG_CONFIG_HOME points at an empty folder, which is where Muse reads its
//     login when that variable is set: Muse is INSTALLED and SIGNED OUT.
//   - Cursor Agent and Antigravity live elsewhere and stay as they are.
// No login file is read or written, and nothing is installed.
//
// Spends nothing: no mission is sent.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const emptyAppData = await mkdtemp(join(tmpdir(), 'locust-signin-appdata-'))
const emptyConfig = await mkdtemp(join(tmpdir(), 'locust-signin-config-'))
const workspace = await scratchRepository('locust-install-or-sign-in-ws-')

const drive = await startDrive({
  name: 'install-or-sign-in',
  port: 9349,
  workspace,
  sendsNothing: true,
  // APPDATA alone is not enough: this machine's PATH names the npm folder
  // directly, so the CLIs in it were still found (first run of this drive).
  // PATH keeps Windows and Node and nothing else, as drive-install-states
  // does; LOCALAPPDATA stays real, which is where Cursor and Muse live.
  env: {
    APPDATA: emptyAppData,
    XDG_CONFIG_HOME: emptyConfig,
    PATH: ['C:\\Program Files\\nodejs', 'C:\\Windows\\system32', 'C:\\Windows'].join(';')
  },
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' } }
})

const ROWS = `(() => [...document.querySelectorAll('.lc-runtimecell')].map(row => {
  const name = row.querySelector('.lc-runtimecell__name')?.innerText.trim() ?? '?'
  const need = row.querySelector('.lc-runtimecell__need')?.innerText.trim() ?? ''
  const action = [...row.querySelectorAll('button, .lc-runtimecell__tag, .lc-runtimecell__version')].map(b => b.innerText.trim()).join(' / ')
  return name + ' | ' + need + ' | ' + action
}).join(' || '))()`

try {
  await drive.capture('the first screen, as it opens', async () => {
    await drive.ready()
    await new Promise((r) => setTimeout(r, 1500))
    return drive.evaluate(ROWS)
  })
  await drive.capture('every runtime, the deferred ones shown too', async () => {
    await drive.evaluate(`(async () => { document.querySelector('.lc-agentmore')?.click(); await new Promise(r => setTimeout(r, 500)) })()`)
    return drive.evaluate(ROWS)
  })
} finally {
  await drive.finish({ intro: 'Build: out/. Empty APPDATA (npm CLIs not installed) and empty XDG_CONFIG_HOME (Muse installed, signed out). Which rows say install and which say sign in.' })
}
say('done')
