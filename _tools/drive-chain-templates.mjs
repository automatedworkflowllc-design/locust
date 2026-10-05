// A ready-made chain, from the template list to a finished run (2026-10-05).
//
//   node _tools/drive-chain-templates.mjs [--look-before] [--no-run] [--tag <name>]
//
// Spends nothing: all three teammates are on the free OpenCode model
// (LOCUST_FREE_MODEL picks another when one is down). The folder has a bug
// report and the buggy file.
//
// Default: Routines > Start from a template > "Fix a bug, then check the fix".
// It must open in the editor with a teammate proposed for each role (Atlas,
// Research & Briefs, finds the cause; Wren, Code & Migrations, fixes it; Sable,
// Docs & QA, checks), the checker marked, and the run set to change files in a
// copy. Saving it must give a card that names the chain; Run asks what is going
// wrong, hands each step on with the one before's answer, and counts only if
// Sable approves.
//
// `--look-before` is for the BASE build, to put the frames of what a template
// is today beside the new ones: the list, a read-only template's preview, its card.
//
// Frames are kept at 1215x800 and 860x720 in LOCUST_DRIVE_OUT (or docs/).

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, git, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const tag = arg('--tag') ?? 'local'
const lookBefore = process.argv.includes('--look-before')
const noRun = process.argv.includes('--no-run')
const OUT = join(recordRoot('a-chain-template-2026-10-05'), `${lookBefore ? 'before' : 'after'}-${tag}`)
await mkdir(OUT, { recursive: true })

const workspace = await scratchRepository('locust-drive-chain-ws-')
await writeFile(join(workspace, 'issue.md'), '# Bug: the cart total is wrong\n\nA cart with one 10.00 item shows a total of 20.00. Expected 10.00.\n', 'utf8')
await writeFile(join(workspace, 'cart.py'), 'def total(items):\n    subtotal = sum(item["price"] for item in items)\n    return subtotal + sum(item["price"] for item in items)\n', 'utf8')
await git(['add', '.'], workspace)
await git(['commit', '-q', '-m', 'cart'], workspace)

const route = { ...FREE_ROUTE, mode: 'accept-edits' }
const drive = await startDrive({
  name: `chain-templates-${tag}`, port: 9772, workspace, outPath: OUT, spends: false, keep: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-05T01:00:00.000Z', route },
      { teammateId: 'tm_atlas', name: 'Atlas', hue: 'blue', role: 'Research & Briefs', createdAt: '2026-10-05T01:00:01.000Z', route },
      { teammateId: 'tm_sable', name: 'Sable', hue: 'clay', role: 'Docs & QA', createdAt: '2026-10-05T01:00:02.000Z', route }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
/** The same screen at both sizes the look is judged at. */
const both = async (title, action) => {
  await drive.resize(1215, 800)
  const note = await drive.capture(`${title} 1215x800`, action)
  await drive.resize(860, 720)
  await drive.capture(`${title} 860x720`, async () => note)
  await drive.resize(1215, 800)
  return note
}
const openRoutines = `(async () => {
  ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
  await new Promise((r) => setTimeout(r, 1000))
  return (document.querySelector('.lc-routinerow:not(.lc-routineadd)')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
})()`
const clickTemplate = (name) => `(async () => {
  const row = [...document.querySelectorAll('.lc-templates__row')].find((b) => b.innerText.includes(${JSON.stringify(name)}))
  if (!row) return 'no such template row'
  row.click()
  await new Promise((r) => setTimeout(r, 1200))
  return 'opened'
})()`

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(2500)
  const list = JSON.parse(String(await both('Routines, the template list', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-sidebar__nav button')].find((b) => /Routines/.test(b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 1000))
    const rows = [...document.querySelectorAll('.lc-templates__row')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim())
    return JSON.stringify(rows)
  })()`))))
  say(`  templates: ${String(list.length)}`)
  for (const row of list) say(`    ${row}`)

  if (lookBefore) {
    const preview = String(await both('A read-only template, opened', () => drive.evaluate(`(async () => {
      const row = [...document.querySelectorAll('.lc-templates__row')].find((b) => b.innerText.includes('Review a file'))
      row?.click()
      await new Promise((r) => setTimeout(r, 1200))
      return document.querySelector('.lc-dialog')?.innerText.replace(/\\s+/g, ' ').slice(0, 400) ?? 'no dialog'
    })()`)))
    say(`  preview: ${preview}`)
    const added = String(await both('Added: its card', () => drive.evaluate(`(async () => {
      const select = document.querySelector('.lc-dialog select[aria-label="Give routine to"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(select, 'tm_wren')
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      ;[...document.querySelectorAll('.lc-dialog button.lc-primarybutton')].pop()?.click()
      await new Promise((r) => setTimeout(r, 1500))
      return (document.querySelector('.lc-routinerow:not(.lc-routineadd)')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
    })()`)))
    say(`  card: ${added}`)
  } else {
    check('the list offers the three chains, marked as hand-offs', ['Fix a bug', 'Build a feature', 'Make it faster'].every((name) => list.some((row) => row.includes(name) && /hand-offs/.test(row))), list.filter((row) => /hand-offs/.test(row)).join(' | '))

    const opened = JSON.parse(String(await both('Fix a bug, opened in the editor', () => drive.evaluate(`(async () => {
      const row = [...document.querySelectorAll('.lc-templates__row')].find((b) => b.innerText.includes('Fix a bug'))
      row?.click()
      await new Promise((r) => setTimeout(r, 1200))
      const box = document.querySelector('.lc-dialog')
      if (!box) return JSON.stringify({ open: false })
      const picks = [...box.querySelectorAll('select[aria-label^="Who takes step"]')]
      const mode = [...box.querySelectorAll('[role="radio"]')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.innerText.trim())
      return JSON.stringify({
        open: true,
        title: box.querySelector('.lc-dialog__title')?.innerText,
        name: box.querySelector('#routine-name')?.value,
        who: picks.map((p) => p.options[p.selectedIndex]?.innerText),
        values: picks.map((p) => p.value),
        checked: [...box.querySelectorAll('.lc-routinestep__check input')].map((c) => c.checked),
        mode,
        runs: box.querySelector('.lc-dialog__note')?.innerText?.slice(0, 120)
      })
    })()`))))
    say(`  editor: ${JSON.stringify(opened)}`)
    check('a chain opens in the editor, not the preview', opened.open === true && /New routine/.test(opened.title ?? ''), opened.title)
    check('a teammate is proposed for each role: Atlas finds the cause, Wren fixes it, Sable checks', opened.who?.[0] === 'Atlas (runs it)' && opened.values?.[1] === 'tm_wren' && opened.values?.[2] === 'tm_sable', JSON.stringify(opened.who))
    check('the last step is the checker and only the last', JSON.stringify(opened.checked) === '[false,false,true]', JSON.stringify(opened.checked))
    check('it is set to change files, in a copy', opened.mode?.includes('Change files') === true && opened.mode?.includes('In a copy, you keep') === true, JSON.stringify(opened.mode))

    const lower = String(await both('The editor, steps 2 and 3', () => drive.evaluate(`(async () => {
      const steps = document.querySelectorAll('.lc-dialog .lc-routinestep')
      steps[steps.length - 1]?.scrollIntoView({ block: 'end' })
      await new Promise((r) => setTimeout(r, 500))
      return [...document.querySelectorAll('.lc-dialog .lc-routinestep__role')].map((n) => n.innerText).join(' | ')
    })()`)))
    check('each step says the role it was proposed for', /Research & Briefs/.test(lower) && /Code & Migrations/.test(lower) && /Docs & QA/.test(lower), lower)

    const card = String(await both('Saved: the card names the chain', () => drive.evaluate(`(async () => {
      ;[...document.querySelectorAll('.lc-dialog button.lc-primarybutton')].pop()?.click()
      await new Promise((r) => setTimeout(r, 1500))
      return (document.querySelector('.lc-routinerow:not(.lc-routineadd)')?.innerText ?? '').replace(/\\s+/g, ' ').trim()
    })()`)))
    say(`  card: ${card}`)
    check('the card names the chain in step order, the checker marked', /Atlas( \([^)]*\))? → Wren( \([^)]*\))? → Sable( \([^)]*\))? \(checks\)/.test(card) || /Atlas → Wren → Sable \(checks\)/.test(card), card)

    if (!noRun) {
      const asked = String(await drive.capture('Run: what is going wrong', () => drive.evaluate(`(async () => {
        const row = document.querySelector('.lc-routinerow:not(.lc-routineadd)')
        ;[...row.querySelectorAll('button')].find((b) => /run/i.test(b.innerText || b.getAttribute('aria-label') || ''))?.click()
        await new Promise((r) => setTimeout(r, 900))
        const area = document.querySelector('.lc-dialog textarea[aria-label^="Value for"]')
        if (!area) return 'no input dialog'
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(area, 'The cart total is double what it should be: a cart with one 10.00 item shows 20.00. The report is issue.md and the code is cart.py.')
        area.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 400))
        return 'filled'
      })()`)))
      check('Run asks what is going wrong', asked === 'filled', asked)
      await drive.evaluate(`[...document.querySelectorAll('.lc-dialog button.lc-primarybutton')].pop()?.click()`)
      let quiet = 0
      for (let waited = 0; waited < 900_000 && quiet < 3; waited += 5000) {
        await sleep(5000)
        const running = await drive.evaluate(`document.querySelectorAll('.lc-spark').length + (document.querySelector('button[aria-label^="Stop the running"]') ? 1 : 0)`)
        quiet = Number(running) === 0 ? quiet + 1 : 0
      }
      await sleep(2000)
      const steps = JSON.parse(String(await drive.evaluate(`(async () => {
        const rows = [...document.querySelectorAll('.lc-convrow .lc-conv')].slice(0, 3).reverse()
        const out = []
        for (const row of rows) {
          row.click()
          await new Promise((r) => setTimeout(r, 1200))
          const head = document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
          const thread = document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
          out.push({ head: head.slice(0, 80), thread: thread.slice(0, 2500), tail: thread.slice(-500) })
        }
        return JSON.stringify(out)
      })()`)))
      steps.forEach((step, index) => say(`  step ${index + 1}: ${step.head} || ${step.tail.slice(-260)}`))
      await both("The checker's step", () => drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-700) ?? ''`))
      check("step 1 was Atlas's, step 2 Wren's, step 3 Sable's", /Atlas/.test(steps[0]?.head ?? '') && /Wren/.test(steps[1]?.head ?? '') && /Sable/.test(steps[2]?.head ?? ''), steps.map((s) => s.head).join(' | '))
      const all = steps.map((s) => s.thread).join(' ')
      check("the thread says step 2 was handed to Wren with Atlas's answer", /handed to Wren with Atlas's answer/.test(all), all.slice(-200))
      check("and step 3 to Sable with Wren's, to check -- and she gave a verdict", /handed to Sable with Wren's answer to check/.test(all) && /VERDICT: (APPROVED|CHANGES NEEDED)/.test(steps[2]?.thread ?? ''), (steps[2]?.tail ?? '').slice(-240))
      const verdict = /approved by Sable/.test(all) ? 'approved' : /Sable, the checker, (asked for changes|gave no verdict)/.test(all) ? 'not approved' : 'none said'
      check('the thread says whether the checker approved', verdict !== 'none said', verdict)
      const after = String(await both('Routines, after the run', () => drive.evaluate(openRoutines)))
      say(`  card at the end: ${after}`)
      await writeFile(join(OUT, 'checker.txt'), `${steps[2]?.thread ?? ''}\n\nverdict: ${verdict}\ncard: ${after}\n`, 'utf8')
    }
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: out/. Three teammates on OpenCode / ${FREE_ROUTE.model}: Wren (Code & Migrations), Atlas (Research & Briefs), Sable (Docs & QA). ${lookBefore ? 'The base build, for the frames beside the new ones.' : 'A chain template from the list to a finished run.'}`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
