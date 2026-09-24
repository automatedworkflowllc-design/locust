// Does a Codex teammate's plan land in the plan card, or get typed into the reply?
//
//   LOCUST_SPEND=1 node _tools/drive-codex-plan-card.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-23, on a Codex reply that opened with a typed "TODO" list --
// "In progress: Read the relevant project guidance..." then four "Pending:"
// lines: "planui looks like its failing in here in a codex chart". Codex 0.153
// offers its update_plan tool only when its config says so, and until 0.304
// Locust never said so. The model, briefed by Locust to keep a todo list with
// its own tool, had none -- so it typed one, and the plan card had nothing to
// draw. 0.304 starts Codex's server with the tool on.
//
// One short turn on the cheapest Codex route (GPT-5.6-Luna, low effort), in a
// scratch folder, asking for a small read-only job of three steps. Then it
// reads the thread the way a person would: is there a plan card with the
// steps in it, and is the reply free of a typed list?

import { say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const OUT = join(new URL('../docs/beta-fixes-2026-09-23/', import.meta.url).pathname.slice(1), `codex-plan-card-${tag}`)
await mkdir(OUT, { recursive: true })
const workspace = await scratchRepository('locust-drive-plancard-ws-')
await writeFile(join(workspace, 'notes.txt'), 'alpha\nbeta\ngamma\ndelta\n')
await writeFile(join(workspace, 'todo.md'), '# Things\n- one\n- two\n')
await writeFile(join(workspace, 'data.csv'), 'a,b\n1,2\n3,4\n5,6\n7,8\n')

const drive = await startDrive({
  spends: true,
  name: `codex-plan-card-${tag}`,
  port: 9463,
  workspace,
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{
      teammateId: 'tm_wren',
      name: 'Wren',
      hue: 'lime',
      role: 'Code & Migrations',
      createdAt: '2026-09-05T05:00:00.000Z',
      route: { runtime: 'codex', model: 'gpt-5.6-luna', mode: 'accept-edits', effort: 'low' }
    }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

try {
  await drive.capture('Wren, on Codex at the cheapest effort', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise(r => setTimeout(r, 700)) })()`)
    return drive.evaluate(`[...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' · ')`)
  })

  const ran = await drive.capture('a small job of three steps', () => drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Mission instruction"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'In this folder: list the files, count the lines in each, then say which file has the most lines. Change nothing.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 250))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      if (i > 3 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'finished after ' + i + 's'
    }
    return 'STILL RUNNING after four minutes'
  })()`))
  check('the turn finished', /^finished/.test(String(ran)), String(ran))

  const seen = await drive.capture('THE QUESTION: the plan card, and the reply', () => drive.evaluate(`(async () => {
    await new Promise(r => setTimeout(r, 1500))
    const card = document.querySelector('.lc-plancard')
    const steps = card === null ? [] : [...card.querySelectorAll('ul.lc-plan > li')].map(li => (li.textContent ?? '').replace(/\\s+/g, ' ').trim())
    // The reply: every line the teammate wrote, outside the plan card.
    const prose = [...document.querySelectorAll('.lc-agentline')]
      .map(line => {
        const copy = line.cloneNode(true)
        copy.querySelectorAll('.lc-plancard').forEach(el => el.remove())
        return copy.innerText ?? ''
      })
      .join(String.fromCharCode(10))
    return JSON.stringify({
      card: card !== null,
      counts: card === null ? null : (card.querySelector('.lc-plancard__counts')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
      steps,
      prose: prose.slice(0, 900)
    })
  })()`))
  const view = JSON.parse(String(seen))
  check('a plan card is drawn, with the steps in it', view.card === true && view.steps.length >= 2, `${String(view.steps.length)} steps: ${JSON.stringify(view.steps)}`)
  const typed = /^\s*TODO\b/m.test(view.prose) || /^\s*[-*•]?\s*(In progress|Pending)\s*:/m.test(view.prose)
  check('and the reply does not type the list out', !typed, typed ? JSON.stringify(view.prose.slice(0, 300)) : undefined)
  // 0.308: Codex's remarks about its own setup stay out of the conversation...
  const fold = String(await drive.evaluate(`(() => [...document.querySelectorAll('.lc-activity, .lc-fold, .lc-thread')].map((el) => el.innerText ?? '').join(' '))()`))
  const setupSaid = /Skill descriptions were shortened|unrecognized configuration setting/i.exec(fold)
  check("the run carries none of Codex's remarks about its own setup", setupSaid === null, setupSaid === null ? undefined : setupSaid[0])
  // ...and the folder sits as text, not a chip.
  const folder = JSON.parse(String(await drive.evaluate(`(() => { const el = document.querySelector('.lc-composer__controls .lc-control--folder'); if (!el) return JSON.stringify(null); const style = getComputedStyle(el); return JSON.stringify({ background: style.backgroundColor, shadow: style.boxShadow }) })()`)))
  check('the folder sits as text on the composer row (no pill, no ring)', folder !== null && (folder.background === 'rgba(0, 0, 0, 0)' || folder.background === 'transparent') && folder.shadow === 'none', JSON.stringify(folder))
  const notes = await drive.capture("Settings, Runtimes: Codex's setup notes on its row", () => drive.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Settings'))
    tab?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const page = [...document.querySelectorAll('button, a')].find((b) => /^Runtimes$/.test((b.textContent ?? '').trim()))
    page?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const row = [...document.querySelectorAll('.lc-runtimerow')].find((r) => /Codex/.test(r.textContent ?? ''))
    return JSON.stringify([...(row?.querySelectorAll('.lc-runtimerow__setupnote') ?? [])].map((n) => (n.textContent ?? '').trim()))
  })()`))
  const said = JSON.parse(String(notes))
  check("Codex's row in Settings says them instead", said.length > 0 && said.every((line) => line.startsWith('Codex CLI says: ')), JSON.stringify(said))
  say(failures === 0 ? '\nCODEX PLAN CARD PASSED' : `\nCODEX PLAN CARD: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'One short Codex turn at low effort, asked for three read-only steps: does its plan land in the plan card, or get typed into the reply?'
  })
}
