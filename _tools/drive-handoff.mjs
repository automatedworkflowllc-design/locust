// A person hands a running mission to another runtime from the composer.
//
//   node _tools/drive-handoff.mjs
//
// Wren starts on the free OpenCode model with a task that takes a while.
// While it runs, the person opens the route picker (which must say that
// choosing here stops the run), picks a DIFFERENT model, and watches: the run
// stop, the handoff divider appear, and the continuation start from the
// checkpoint.
//
// IT SPENDS, and it cannot be made free. Measured 2026-09-09: handing off to a
// second FREE OpenCode model changes the route and does NOT hand anything over,
// because a handoff is a change of RUNTIME -- the picker's own warning says so
// in as many words, "Choosing another runtime stops it". OpenCode's free models
// are the only free runtime here, so there is no free pair to hand between.
// The attempt produced a run that simply finished where it started, with no
// divider, which reads exactly like the feature being broken.
//
// So the far side is Claude Code again, and this is the riskiest workflow in
// the app -- it KILLS a running mission before it knows the next one will
// start -- which is why it is worth the short run when it is run deliberately.
//
// VERIFIED FOR FREE on the way to learning that: with a live run, the picker
// does show its warning, and the route control stays enabled rather than being
// disabled mid-run:
//
//   "This mission is running. Choosing another runtime stops it, writes a
//    checkpoint, and hands the work over -- it cannot be undone."


import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-handoff-ws-')
const drive = await startDrive({
  name: 'handoff',
  port: 9299,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('start a slow task on the free model', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren')).click(); await new Promise(r => setTimeout(r, 500)) })()`)
    return drive.evaluate(sendAndWaitScript('Count from 1 to 400. Put each number on its own line, in order, with no other text and no commentary. Do not stop early and do not summarise. Do not edit any files.', { settle: false }))
  })
  await drive.capture('the run is live; the picker warns that switching stops it', () => drive.evaluate(`(async () => {
    /*
     * THE PREMISE, asserted rather than assumed.
     *
     * A handoff needs a RUNNING mission. This waited for the Stop button and
     * then carried on regardless of whether it ever appeared -- so on
     * 2026-09-09, against a fast free model that finished the whole task in
     * 16s, the picker was opened after the run had already completed. It
     * reported "NO NOTICE", "no divider in 2 minutes" and "no divider", all of
     * which read as the handoff being broken. Nothing was broken: there was
     * nothing to hand off.
     *
     * Same shape as the crash sweep killing after a run had ended, and the
     * routine card read mid-run. A drive whose premise is not met has to say
     * so instead of reporting the app.
     */
    let live = false
    for (let i = 0; i < 120 && !live; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      // The Stop button IS liveness. This also required the thread marker --
      // the "Started HH:MM" line -- and that appears on its own schedule, so a
      // run could be plainly live with the condition still false. Two signals
      // ANDed together is one more way to miss the state you are waiting for.
      //
      // No backticks in this comment: it sits inside a template literal, so
      // one would END the literal here. That is what happened on the first
      // attempt. node --check cannot catch it -- the file still parses --
      // which is why harness-backticks.test.ts now scans for it instead of
      // this note asking the next author to remember.
      if (document.querySelector('button[aria-label^="Stop the running"]')) live = true
    }
    if (!live) return 'NOT A HANDOFF TEST: no run was live within 30s'
    await new Promise(r => setTimeout(r, 2000))
    if (document.querySelector('button[aria-label^="Stop the running"]') === null) {
      return 'NOT A HANDOFF TEST: the run finished before the picker could be opened -- give it slower work'
    }
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (!control) return 'no route control'
    if (control.disabled) return 'route control disabled while running'
    control.click()
    await new Promise(r => setTimeout(r, 500))
    const picker = document.querySelector('.lc-picker')
    return picker ? 'picker: ' + (picker.querySelector('.lc-picker__notice')?.innerText ?? 'NO NOTICE') : 'picker did not open'
  })()`))
  await drive.capture('pick Claude Code / sonnet while it runs', () => drive.evaluate(`(async () => {
    const picker = document.querySelector('.lc-picker')
    if (!picker) return 'picker gone'
    const box = picker.querySelector('.lc-picker__input')
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setInput.call(box, 'sonnet'); box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    let current = ''
    let target
    for (const node of picker.querySelector('.lc-picker__list').children) {
      const header = node.querySelector('.lc-picker__group')
      if (header) current = header.innerText
      const row = node.querySelector('.lc-picker__row')
      if (row && !row.disabled && /claude/i.test(current) && /^sonnet/i.test(row.innerText.trim())) { target = row; break }
    }
    if (!target) return 'no Claude Code sonnet row: ' + [...picker.querySelectorAll('.lc-picker__row')].map(r => r.innerText.replace(/\\s+/g, ' ')).slice(0, 6).join(' | ')
    target.click()
    await new Promise(r => setTimeout(r, 1500))
    return 'picked; marker: ' + (document.querySelector('.lc-thread__marker')?.innerText.replace(/\\s+/g, ' ') ?? 'none') + ' · route control disabled: ' + ([...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.disabled ?? '?')
  })()`))
  await drive.capture('the handoff divider appears', () => drive.evaluate(`(async () => {
    const trail = []
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const marker = document.querySelector('.lc-thread__marker')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'no marker'
      if (trail[trail.length - 1] !== marker) trail.push(marker)
      const divider = document.querySelector('.lc-handoff')
      if (divider) return 'divider: ' + divider.innerText.replace(/\\s+/g, ' ').slice(0, 200) + ' || trail: ' + trail.join(' -> ')
    }
    return 'no divider in 2 minutes; trail: ' + trail.join(' -> ')
  })()`))
  await drive.capture('the continuation runs on Claude Code, then finishes', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 480; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 10 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 800))
    return (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? '') + ' || ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-300) ?? '')
  })()`))
  await drive.capture('open the activity fold: what the two runs did', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-activity')
    if (!fold) return 'no activity fold'
    // Only when it is not already open. Since 0.49.0 a finished turn's fold
    // opens itself, so an unconditional click CLOSES it and every row below
    // then reads as absent -- a harness reporting a bare screen at an app
    // that is fine.
    if (fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 300))
    return fold.innerText.replace(/\\s+/g, ' ').slice(0, 80) + ' || ' + [...document.querySelectorAll('.lc-filerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim()).join(' | ').slice(0, 400)
  })()`))
  await drive.capture('the sidebar after the handoff', () => drive.evaluate(`document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 260)`))
  await drive.capture('scroll the thread to the divider', () => drive.evaluate(`(async () => {
    document.querySelector('.lc-handoff')?.scrollIntoView({ block: 'center' })
    await new Promise(r => setTimeout(r, 400))
    return document.querySelector('.lc-handoff')?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'no divider'
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on the free OpenCode model; the running mission handed to Claude Code / sonnet from the composer.' })
}
