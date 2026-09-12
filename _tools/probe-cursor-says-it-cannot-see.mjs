// Does a Cursor teammate SAY when it has been told not to read the folder?
//
//   LOCUST_SPEND=1 node _tools/probe-cursor-says-it-cannot-see.mjs
//
// Three times on this machine a `.cursorignore` rule has blinded a Cursor run
// and the run has explained itself by inventing a cause. The last was
// Colin's, 2026-09-12, on a screenshot Locust had written into the workspace
// it then handed over: "this worker cannot open them -- Read returns
// permission denied even after copying to temp", then a paragraph of fiction.
//
// 0.87.0 reads the rule before the run and names it. This drives that.
//
// The workspace is put under `~/.gemini/`, which is a REAL rule in Colin's
// real `~/.cursorignore` and a folder nothing here uses -- so the premise is
// the machine's own configuration rather than a file this probe wrote to make
// itself pass. If that rule is ever removed the probe says NOT THE TEST
// rather than reporting a failure.
//
// SPENDS one Cursor turn on the free composer quota.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { say, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Cursor turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

// The premise, asserted against the machine rather than assumed.
const rules = await readFile(join(homedir(), '.cursorignore'), 'utf8').catch(() => '')
if (!/^\.gemini\/\*?$/m.test(rules)) {
  say('NOT THE TEST: ~/.cursorignore no longer carries a `.gemini/` rule, so nothing would hide the workspace')
  process.exit(1)
}

const workspace = join(homedir(), '.gemini', 'locust-cannot-see-probe')
await rm(workspace, { recursive: true, force: true })
await mkdir(workspace, { recursive: true })
await writeFile(join(workspace, 'notes.txt'), 'the teammate should not be able to read this', 'utf8')

const now = '2026-09-12T00:00:00.000Z'
const drive = await startDrive({
  name: 'cursor-says-it-cannot-see',
  port: 9510,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_jim',
        name: 'Jim',
        hue: 'lime',
        role: 'Data & Reporting',
        createdAt: now,
        route: { runtime: 'cursor', model: 'composer-2.5', mode: 'auto' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 12, interrupt: false, memoryMode: 'off', autoMode: false }
  }
})

// No backticks inside these template literals.
const ask = `(async () => {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  const row = [...document.querySelectorAll('.lc-row')].find(r => /Jim/.test(r.innerText))
  if (row === undefined) return 'no teammate row'
  row.click()
  await new Promise(r => setTimeout(r, 800))
  const box = document.querySelector('.lc-composer__box textarea')
  if (box === null) return 'no composer'
  setter.call(box, 'Read notes.txt and tell me the one line it contains.')
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  document.querySelector('.lc-composer__form').requestSubmit()
  return 'asked'
})()`

const watch = `(async () => {
  for (let i = 0; i < 240; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (/Cursor cannot read files here/.test(document.body.innerText)) break
  }
  const text = document.body.innerText
  const line = (text.split(String.fromCharCode(10)).find(l => /Cursor cannot read files here/.test(l)) ?? '')
  return JSON.stringify({
    saidIt: /Cursor cannot read files here/.test(text),
    // It has to be USEFUL, not merely present: the rule, the file, and the fix.
    namesTheFile: /cursorignore/.test(line),
    namesTheRule: /gemini/.test(line),
    saysWhatToChangeItTo: line.indexOf('gemini/*') >= 0,
    line: line.slice(0, 300)
  }, null, 1)
})()`

try {
  await drive.capture('a teammate is asked to read a file in a folder the rules hide', async () => {
    await drive.ready()
    return drive.evaluate(ask)
  })
  const seen = await drive.capture('the thread names the rule instead of leaving it to guess', () => drive.evaluate(watch))
  const measured = JSON.parse(seen)
  if (measured.saidIt !== true) say('NOT SAID: the run was blinded and the thread did not explain why')
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: "A Cursor teammate whose workspace sits under `~/.gemini/`, a real rule in this machine's real `~/.cursorignore`. Locust should name the rule before the run rather than let the teammate invent a cause."
  })
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}
