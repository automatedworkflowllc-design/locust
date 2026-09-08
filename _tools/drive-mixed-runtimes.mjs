// Two teammates, two DIFFERENT runtimes, one folder, at the same time.
//
//   node _tools/drive-mixed-runtimes.mjs
//
// `drive-concurrent.mjs` ran three teammates at once and found a real defect:
// every activity card counted all three teammates' work, because for a run
// allowed to write the host takes a `git status` before and after and treats
// every difference as that run's doing. 0.36.3 fixed it by reporting the
// FOLDER's change as the folder's, counted against nobody.
//
// But all three were on the same runtime. "Teammates on different runtimes
// together" is listed as untested in the build log's own Open-honestly block,
// and it is the case where the attribution logic has to hold across two
// adapters and two normalizers rather than one.
//
// So: Wren on OpenCode's free model, Booty on Cursor's Composer, started
// without waiting, each writing a file only it was told about. The questions
// are the same three that matter -- does each finish, does each reply land in
// its own thread, and does either card claim the other's file.
//
// One free OpenCode turn and one short Cursor turn.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

/** Each teammate's own file and word, so a crossed wire is visible. */
const WORK = {
  Wren: { word: 'ALMANAC', file: 'wren-note.txt', route: { group: '/opencode/i', search: 'free', row: '/free/i' } },
  Booty: { word: 'BRAMBLE', file: 'booty-note.txt', route: { group: '/cursor/i', search: 'composer 2.5', row: '/composer 2\\.5/i' } }
}

const workspace = await scratchRepository('locust-mixed-ws-')

const drive = await startDrive({
  name: 'mixed-runtimes',
  port: 9357,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Docs & QA', createdAt: '2026-09-05T05:00:01.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Open a teammate, put it on ITS OWN runtime, and send without waiting. */
const startFor = async (name) => {
  const { word, file, route } = WORK[name]
  await drive.evaluate(`(async () => {
    [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message ${name}')).click()
    await new Promise(r => setTimeout(r, 400))
  })()`)
  await drive.evaluate(pickRouteScript(route))
  return drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Create a file named ${file} containing exactly the single line ${word}. Touch no other file. Then reply with exactly the word ${word}.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    await new Promise(r => setTimeout(r, 400))
    return 'sent to ${name}'
  })()`)
}

try {
  // The premise, checked before anything is measured: a seeded record that
  // does not parse is DROPPED rather than reported, and every prompt would
  // then pile onto whichever teammate survived.
  await drive.ready()
  const rostered = Number(await drive.evaluate(`document.querySelectorAll('.lc-teammate').length`))
  if (rostered !== 2) throw new Error(`roster holds ${String(rostered)} teammates, not 2 -- a seeded record did not parse`)

  await drive.capture('two teammates, two runtimes', async () => {
    const said = []
    for (const name of Object.keys(WORK)) said.push(await startFor(name))
    return said.join(' || ')
  })

  await drive.capture('both live at once, on different runtimes', () => drive.evaluate(`(async () => {
    let peak = 0
    let peakLine = ''
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 400))
      const rows = [...document.querySelectorAll('.lc-teammate')]
      const working = rows.filter(r => !/idle/.test(r.innerText)).length
      if (working > peak) {
        peak = working
        peakLine = rows.map(r => r.innerText.split(String.fromCharCode(10)).slice(0, 3).join(' ').trim()).join(' | ')
      }
      if (peak > 0 && working === 0) break
    }
    return 'peak working at once: ' + String(peak) + ' || at peak: ' + peakLine
  })()`))

  await drive.capture('both settled', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const rows = [...document.querySelectorAll('.lc-teammate')].map(r => r.innerText)
      if (rows.every(r => /idle|done/.test(r))) return 'both settled after ' + String(i / 2) + 's'
    }
    return 'STILL GOING after 150s'
  })()`))

  // The heart of it: what each card CLAIMS about files, next to what each
  // teammate was actually told to write.
  await drive.capture('what each card claims it changed', () => drive.evaluate(`(async () => {
    const want = ${JSON.stringify(Object.fromEntries(Object.entries(WORK).map(([n, w]) => [n, w])))}
    const out = []
    for (const name of Object.keys(want)) {
      const row = [...document.querySelectorAll('.lc-teammate')].find(r => new RegExp('^' + name).test(r.innerText.trim()))
      row?.querySelector('.lc-teammate__mission')?.click()
      await new Promise(r => setTimeout(r, 1200))
      const thread = document.querySelector('.lc-thread')?.innerText ?? ''
      const fold = document.querySelector('.lc-activity')
      const trace = fold ? fold.innerText.split(String.fromCharCode(10)).map(t => t.trim()).filter(Boolean).join(' ') : 'no fold'
      const others = Object.keys(want).filter(w => w !== name)
      const stray = others.filter(w => thread.includes(want[w].word))
      out.push(name + ': trace[' + trace.slice(0, 90) + ']'
        + ' own word ' + (thread.includes(want[name].word) ? 'yes' : 'MISSING')
        + (stray.length ? ' STRAY:' + stray.join(',') : ''))
    }
    return out.join('  ||  ')
  })()`))

  // Disk is the only thing that cannot be talked out of the truth.
  await drive.capture('what is actually on disk', async () => {
    const names = await readdir(workspace).catch(() => [])
    const lines = []
    for (const [who, { file, word }] of Object.entries(WORK)) {
      const body = await readFile(join(workspace, file), 'utf8').catch(() => undefined)
      lines.push(`${who}: ${file} ` + (body === undefined ? 'ABSENT' : (body.includes(word) ? 'present and correct' : `present but says ${JSON.stringify(body.slice(0, 40))}`)))
    }
    return lines.join(' || ') + ' || folder: ' + names.filter((n) => n !== '.git').join(', ')
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Two teammates on two different runtimes, writing in one folder at once.' })
}
