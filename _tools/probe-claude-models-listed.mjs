// Claude's models in the packaged picker: named the way Claude Code's own list names them (0.697).
//
//   node _tools/probe-claude-models-listed.mjs
//
// Colin, 2026-10-07: "haiku 5.5 is appearing on cursor but not claude on
// locust". 0.697 takes Claude's models from Claude Code's handshake, with the
// copied table as the fallback -- and both now say Haiku 5.5, so the alias row
// cannot tell them apart. The older versions can: Claude Code lists Haiku 4.5
// first, under `claude-haiku-4-5-20251001`, and the copied table puts it last.
// So this opens the picker, waits for the handshake, opens Claude's fold and
// reads its order. Costs nothing: no turn is started.

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { APP_DIR, say, scratchRepository, startDrive } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!existsSync(EXE)) {
  say(`no packaged build at ${EXE}`)
  process.exit(1)
}
const workspace = await scratchRepository('locust-probe-claude-models-ws-')
const drive = await startDrive({
  name: 'claude-models-listed',
  port: 9425,
  packaged: EXE,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const READ_CLAUDE = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
  if (!control) return JSON.stringify({ error: 'no route control' })
  if (document.querySelector('.lc-picker') !== null) { control.click(); await new Promise((r) => setTimeout(r, 500)) }
  control.click()
  await new Promise((r) => setTimeout(r, 900))
  const picker = document.querySelector('.lc-picker')
  if (picker === null) return JSON.stringify({ error: 'picker would not open' })
  // The list is flat: one wrapper per row, a group's header inside its first row's wrapper.
  const inClaude = () => {
    const out = []
    let current = ''
    for (const wrapper of picker.querySelectorAll('.lc-picker__list > div')) {
      const header = wrapper.querySelector('.lc-picker__group')
      if (header) current = (header.textContent ?? '').trim()
      if (/^Claude Code/.test(current)) out.push(wrapper)
    }
    return out
  }
  const fold = inClaude().map((wrapper) => wrapper.querySelector('.lc-picker__fold')).find((button) => button)
  if (fold && fold.getAttribute('aria-expanded') !== 'true') { fold.click(); await new Promise((r) => setTimeout(r, 400)) }
  const rows = inClaude().flatMap((wrapper) => [...wrapper.querySelectorAll('.lc-picker__row')]).map((el) => (el.innerText ?? '').split('\\n')[0].trim())
  return JSON.stringify({ fold: fold == null ? null : (fold.textContent ?? '').trim(), rows })
})()`

let failures = 0
try {
  await drive.capture('Claude in the picker, once its handshake has answered', async () => {
    await drive.ready()
    await new Promise((resolve) => setTimeout(resolve, 20_000))
    const read = JSON.parse(await drive.evaluate(READ_CLAUDE))
    const rows = read.rows ?? []
    // The picker sorts the fold for show, so the catalog's own order is read
    // too: Claude Code's list starts the older versions with Haiku 4.5, the
    // copied table with Opus 5.
    const older = JSON.parse(await drive.evaluate(`window.desktop.listModels().then((answer) => JSON.stringify(answer.ok ? answer.data.models.filter((m) => m.runtime === 'claude' && m.older === true).map((m) => m.id) : []))`))
    read.catalogOlder = older
    const checks = [
      ['the haiku alias reads Haiku 5.5', rows.includes('Haiku 5.5')],
      ["the catalog's older versions are Claude Code's own list first", older[0] === 'claude-haiku-4-5-20251001'],
      ['Haiku 4.5 is offered once', rows.filter((row) => row === 'Haiku 4.5').length === 1]
    ]
    for (const [what, ok] of checks) {
      say(`[${ok ? 'PASS' : 'FAIL'}] ${what}`)
      if (!ok) failures += 1
    }
    return JSON.stringify(read)
  })
} finally {
  await drive.finish({ intro: `Build: ${EXE}. Claude's rows and its older versions, read from the picker.`, extra: `Checks failed: ${String(failures)}` })
}
process.exit(failures === 0 ? 0 : 1)
