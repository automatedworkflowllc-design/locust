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

import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

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
  await drive.capture('launch with no coding agent installed: what the panel offers', async () => {
    await drive.ready()
    return drive.evaluate(`(() => {
      const foot = document.querySelector('.lc-sidebar')?.innerText.replace(/[ ]+/g, ' ') ?? ''
      const panel = document.querySelector('.lc-runtimepanel')
      const slots = [...document.querySelectorAll('.lc-runtimecell__install')]
      const note = document.querySelector('.lc-installnote')
      return 'panel: ' + (panel === null ? 'ABSENT' : 'present')
        + ' || action slots: ' + slots.length
        + ' || ' + slots.map(b => (b.innerText.trim() || 'link') + (b.disabled ? ' [disabled]' : '')).join(' | ')
        + ' || primary: ' + (document.querySelector('.lc-runtimecell__install.is-primary') === null ? 'none' : 'yes')
        + ' || note: ' + (note === null ? 'none' : note.innerText.replace(/[ ]+/g, ' ').slice(0, 90))
        + ' || sidebar: ' + foot.slice(-40)
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
  // ------------------------------------------------------------------
  // The half nobody had driven: do what the app just told the person to do,
  // then come back and try to use it. The QA pass did this by hand on Linux
  // and found that the composer still said "Install a coding agent…", Enter
  // did nothing, and nothing said why.
  //
  // The install goes into `<emptyHome>/npm`, which is where the app's own
  // path locator probes (`%APPDATA%\\npm`) -- and APPDATA is pointed at
  // `emptyHome` for this drive. So this is the real discovery path, not a
  // PATH trick.
  // ------------------------------------------------------------------
  await drive.capture('run the line Settings gave, for real', async () => {
    const prefix = join(emptyHome, 'npm')
    // shell: true because Windows will not spawn a .cmd otherwise -- without
    // it this returns status null and an empty stderr, which looks exactly
    // like the install failing silently.
    const done = spawnSync('npm', ['install', '-g', '--prefix', prefix, 'opencode-ai'], {
      encoding: 'utf8',
      timeout: 8 * 60_000,
      shell: true
    })
    if (done.error !== undefined) throw new Error('could not run npm: ' + String(done.error.message))
    const landed = await readdir(prefix).catch(() => [])
    if (done.status !== 0) {
      throw new Error(`npm install failed (${String(done.status)}): ${(done.stderr ?? '').slice(-300)}`)
    }
    return `npm exited ${String(done.status)} · ${prefix} now holds: ${landed.join(', ') || 'nothing'}`
  })

  await drive.capture('come back to the window: does it notice on its own', () => drive.evaluate(`(async () => {
    // What a person does: click back into the app. The host re-probes on
    // focus, and nothing here relaunches it.
    window.dispatchEvent(new Event('focus'))
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const foot = document.querySelector('.lc-sidebar')?.innerText ?? ''
      if (/1 (?:runtime connected|AI agent ready)/.test(foot) || /runtimes connected|AI agents ready/.test(foot) === false) {
        if (/1 runtime connected/.test(foot)) return 'noticed after ' + String(i + 1) + 's: ' + foot.slice(-40).replace(/[ ]+/g, ' ')
      }
    }
    const foot = document.querySelector('.lc-sidebar')?.innerText.slice(-60) ?? ''
    return 'still not noticed after 60s · foot: ' + foot.replace(/[ ]+/g, ' ')
  })()`))

  await drive.capture('THE QUESTION: can they now type and send', () => drive.evaluate(`(async () => {
    // Back to where a person types. Step 3 left the app on Settings, which
    // has no composer -- and "no composer" reads as the defect rather than as
    // the drive standing in the wrong room.
    // The Missions LIST has no composer either -- it is a list. The composer
    // lives where a person writes to a teammate.
    ;${teammateFace('Wren')}?.click()
    await new Promise(r => setTimeout(r, 1200))
    const field = document.querySelector('form.command-dock textarea')
    const placeholder = field?.getAttribute('placeholder') ?? 'no composer'
    const chip = [...document.querySelectorAll('.lc-control')].map(b => b.innerText.replace(/[ ]+/g, ' ')).find(t => /OpenCode|Codex/.test(t)) ?? 'no route chip'
    return 'placeholder: ' + placeholder + ' || chip: ' + chip.split(String.fromCharCode(10)).join(' ')
  })()`))

  await drive.capture('and does a message actually run', async () => {
    const { sendAndWaitScript } = await import('./drive-lib.mjs')
    await drive.evaluate(sendAndWaitScript('Reply with exactly the word ARRIVED and nothing else.', { waitSeconds: 300 }))
    return drive.evaluate(`(() => {
      const thread = document.querySelector('.lc-thread')?.innerText ?? ''
      return 'reply contains ARRIVED: ' + /ARRIVED/.test(thread) + ' || thread ends: ' + thread.replace(/[ ]+/g, ' ').slice(-120)
    })()`)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Launched as a machine with no coding-agent CLI: empty PATH, and APPDATA/LOCALAPPDATA pointed at an empty folder so the install-directory probes find nothing either.'
  })
}
