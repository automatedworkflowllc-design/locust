// Arena, the RPG round, resumed (2026-10-05): the three runs the machine's memory stopped, carried on.
//
//   node _tools/drive-arena-rpg-resume.mjs --packaged <exe>                       opens the stopped compare; sends nothing
//   LOCUST_SPEND=1 node _tools/drive-arena-rpg-resume.mjs --packaged <exe> --send   one follow-up to all three, no re-rolls
//
// The round (drive-arena-rpg.mjs) was sent at 04:17:46Z; at ~05:08:30Z Claude Code stopped the drive
// because the machine was critically low on memory, and the packaged Locust and its three Claude Code
// runs (Opus 5.5, Fable 5.1, Sonnet 5.5, each Max, Auto, Blind) died with it, none finished. Colin:
// "is there anyway we can salvage or save that? ... lets do it before reset". This relaunches the same
// build on the SAME profile (its ledger, its compares.json) and the same workspace, opens the same Blind
// compare, and sends ONE follow-up to every column through the composer ("Ask all 3"): Locust continues
// each column in its own copy, as the model left it (compare-copies.ts reuses a column's copy for its
// follow-ups), and resumes that column's own Claude Code session. Never "Try again" (that re-rolls the
// first ask from scratch). It sends only if all three columns are there, blind, and none is working.
// Any question is DENIED. Every column is copied out byte for byte, and Locust's record kept, before Keep.

import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const SEND = process.argv.includes('--send')
const OUT = join(recordRoot('arena-rpg-2026-10-05'), SEND ? 'resume' : 'resume-look')
await mkdir(OUT, { recursive: true })
// The stopped round's own profile and workspace, as its drive left them (it never reached finish()).
const PROFILE = join(homedir(), 'locust-scratch', 'locust-drive-arena-rpg-run-CiklvD')
const WORKSPACE = join(homedir(), 'locust-scratch', 'locust-arena-3-PqbCHO')
const COMPARE_ID = 'cmp_cec25436ed244181'
// One follow-up, the same words to every column: what happened, and to carry on. Nothing about the task.
const RESUME = 'Your run was stopped partway through because the computer it was running on ran out of memory. Your folder is exactly as you left it. Continue from where you stopped and finish the task.'

const before = JSON.parse(await readFile(join(PROFILE, 'compares.json'), 'utf8'))
const stopped = (before.compares ?? before).find((one) => one.compareId === COMPARE_ID)
if (stopped === undefined) { say(`no compare ${COMPARE_ID} in the profile: nothing to resume`); process.exit(1) }
const sessionOf = async (missionId) => {
  const text = await readFile(join(PROFILE, 'mission-ledger', `${missionId}.jsonl`), 'utf8').catch(() => '')
  return /"runtimeThreadId":"([^"]+)"/.exec(text)?.[1]
}
const firstSessions = Object.fromEntries(await Promise.all(stopped.slots.map(async (slot) => [slot.slot, await sessionOf(slot.missionIds.at(-1))])))

const drive = await startDrive({
  name: `arena-rpg-${SEND ? 'resume' : 'resume-look'}`, port: 9878, workspace: WORKSPACE, profilePath: PROFILE, outPath: OUT, keep: true,
  ...(packaged === undefined ? {} : { packaged }),
  ...(SEND ? { spends: true } : { sendsNothing: true })
})
const shot = async (file) => {
  const picture = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (picture?.result?.data) await writeFile(join(OUT, file), Buffer.from(picture.result.data, 'base64'))
}
const notes = []
const note = (line) => { notes.push(line); say(`  ${line}`) }
note(`stopped compare: ${JSON.stringify(stopped.slots.map((slot) => ({ slot: slot.slot, label: slot.route.label, missions: slot.missionIds.length, session: firstSessions[slot.slot] })))}`)
const readView = async () => JSON.parse(String(await drive.evaluate(`JSON.stringify({
  heads: [...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
  states: [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim()),
  foot: [...document.querySelectorAll('.lc-compare__foot')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
  bar: document.querySelector('.lc-compare__bar')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
  box: document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? ''
})`)))
let stop
try {
  await drive.ready()
  await drive.resize(1200, 780)
  await sleep(5000)
  // The stopped compare, from its row in the sidebar (the one marked "vs" with the RPG ask).
  const opened = String(await drive.evaluate(`(async () => {
    let row
    for (let i = 0; i < 40 && !row; i += 1) {
      row = [...document.querySelectorAll('.lc-conv')].find((el) => el.querySelector('.lc-conv__vs') && /Make a small browser RPG/.test(el.textContent))
      if (!row) await new Promise((r) => setTimeout(r, 500))
    }
    if (!row) return 'no compare row in the sidebar'
    row.click()
    for (let i = 0; i < 40 && document.querySelectorAll('.lc-compare__state').length < 3; i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 1500))
    return 'opened'
  })()`))
  note(`sidebar: ${opened}`)
  const view = await readView()
  note(`as left: ${JSON.stringify(view)}`)
  await shot('resume-opened.png')
  // Send only to the compare as it was left: three columns, still blind, none working, nobody kept.
  const ok = opened === 'opened' && view.states.length === 3 && view.heads.every((head) => /^Model [ABC]\b/.test(head))
    && !view.states.some((state) => /working|starting|waiting/i.test(state)) && stopped.kept === undefined
    && stopped.slots.every((slot) => slot.missionIds.length === 1 && firstSessions[slot.slot] !== undefined)
  note(ok ? 'AS LEFT: three blind columns, none working, each with its own Claude Code session' : 'NOT AS LEFT: nothing sent')
  if (!ok || !SEND) stop = ok ? 'look only' : 'not as left'
  if (stop === undefined) {
    const sentAt = Date.now()
    await drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, ${JSON.stringify(RESUME)})
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
      document.querySelector('button[aria-label="Send"]')?.click()
    })()`)
    note(`follow-up sent at ${new Date(sentAt).toISOString()}: ${RESUME}`)
    const doneAt = {}
    const denied = []
    let shotRunning = false
    let checkedSessions = false
    for (let second = 0; second < 5400; second += 2) {
      await sleep(2000)
      const now = JSON.parse(String(await drive.evaluate(`JSON.stringify({
        states: [...document.querySelectorAll('.lc-compare__state')].map((el) => el.textContent.trim()),
        asks: [...document.querySelectorAll('.lc-compare__cell')].map((col, at) => ({ at, ask: [...col.querySelectorAll('button')].find((b) => /^(Deny|Decline)$/.test(b.innerText.trim())) ? col.innerText.replace(/\\s+/g, ' ').trim().slice(-300) : null }))
      })`)))
      // Never approve: a question is answered no, and written down.
      for (const one of now.asks.filter((col) => col.ask !== null)) {
        denied.push({ column: one.at + 1, at: Math.round((Date.now() - sentAt) / 1000), asked: one.ask })
        note(`column ${String(one.at + 1)} asked: ${String(one.ask)} -- DENIED`)
        await drive.evaluate(`(() => { const col = [...document.querySelectorAll('.lc-compare__cell')][${String(one.at)}]; [...col.querySelectorAll('button')].find((b) => /^(Deny|Decline)$/.test(b.innerText.trim()))?.click() })()`)
      }
      now.states.forEach((state, at) => {
        if (doneAt[at] === undefined && !/working|waiting|starting/i.test(state) && second > 10) doneAt[at] = { seconds: Math.round((Date.now() - sentAt) / 1000), state }
      })
      // Each follow-up must carry on its column's own session, not start a new one: read it off the ledger.
      if (!checkedSessions && second >= 90) {
        checkedSessions = true
        const after = JSON.parse(await readFile(join(PROFILE, 'compares.json'), 'utf8'))
        const compare = (after.compares ?? after).find((one) => one.compareId === COMPARE_ID)
        for (const slot of compare.slots) {
          const session = slot.missionIds.length > 1 ? await sessionOf(slot.missionIds.at(-1)) : undefined
          note(`column ${slot.slot} (${String(slot.route.label)}): ${slot.missionIds.length > 1 ? (session === firstSessions[slot.slot] ? 'RESUMED its own session ' + String(session) : 'NEW SESSION ' + String(session) + ' (was ' + String(firstSessions[slot.slot]) + ')') : 'no follow-up mission yet'}`)
        }
      }
      if (!shotRunning && second >= 60 && now.states.some((state) => /working/i.test(state))) { await shot('resume-running.png'); shotRunning = true; note(`resume-running.png at ${String(second)}s: ${JSON.stringify(now.states)}`) }
      if (now.states.length === 3 && Object.keys(doneAt).length === 3) break
    }
    note(`done: ${JSON.stringify(doneAt)}`)
    note(`denied: ${JSON.stringify(denied)}`)
    await sleep(3000)
    const blindView = await readView()
    note(`blind view at the end: ${JSON.stringify(blindView)}`)
    if (/usage limit|hit your limit|rate limit|could not be written|failed/i.test(JSON.stringify(blindView))) note('LIMIT OR FAILURE SEEN: stop here and tell Colin; nothing is retried')
    if (!shotRunning) await shot('resume-running.png')
    await shot('blind-done.png')
    const profileCompares = JSON.parse(await readFile(join(drive.profile, 'compares.json'), 'utf8'))
    await writeFile(join(OUT, 'compares.json'), JSON.stringify(profileCompares, null, 2))
    await writeFile(join(OUT, 'timing.json'), JSON.stringify({ firstSentAt: stopped.createdAt, stoppedAt: '2026-10-05T05:08:30Z (approximately; the last ledger event was 05:08:28Z)', resumedAt: new Date(sentAt).toISOString(), doneAt, denied }, null, 2))
    // Every column's folder, byte for byte, BEFORE Keep (which removes the others' copies) and before anything opens a page.
    const compare = (profileCompares.compares ?? profileCompares).find((one) => one.compareId === COMPARE_ID)
    const files = {}
    for (const slot of compare.slots) {
      const from = join(homedir(), '.locust', 'compare', `${compare.compareId}-${slot.slot}`)
      const to = join(OUT, 'columns', slot.slot)
      await cp(from, to, { recursive: true, preserveTimestamps: true })
      const walk = async (dir, base = '') => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async (entry) => entry.isDirectory()
        ? walk(join(dir, entry.name), `${base}${entry.name}/`)
        : [{ name: `${base}${entry.name}`, bytes: (await stat(join(dir, entry.name))).size, sha256: createHash('sha256').update(await readFile(join(dir, entry.name))).digest('hex') }]))).flat()
      files[slot.slot] = { route: slot.route, missionIds: slot.missionIds, from, files: await walk(to) }
    }
    await writeFile(join(OUT, 'columns.json'), JSON.stringify(files, null, 2))
    note(`copied out: ${JSON.stringify(Object.fromEntries(Object.entries(files).map(([slot, one]) => [slot, one.files.filter((file) => !file.name.includes('/')).map((file) => file.name + ' ' + String(file.bytes))])))}`)
    await cp(join(drive.profile, 'mission-ledger'), join(OUT, 'mission-ledger'), { recursive: true }).catch((error) => note(`ledger not copied: ${String(error)}`))
    // The reveal: Keep on the first column (not a choice -- the first), then the named view.
    const revealed = String(await drive.evaluate(`(async () => {
      document.querySelector('.lc-compare__foot .lc-primarybutton')?.click()
      for (let i = 0; i < 60 && document.querySelector('.lc-compare'); i += 1) await new Promise((r) => setTimeout(r, 250))
      await new Promise((r) => setTimeout(r, 1000))
      document.querySelector('.lc-compared__open')?.click()
      await new Promise((r) => setTimeout(r, 1500))
      return JSON.stringify({
        heads: [...document.querySelectorAll('.lc-compare__head')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
        foot: [...document.querySelectorAll('.lc-compare__foot')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim()),
        bar: document.querySelector('.lc-compare__bar')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''
      })
    })()`))
    note(`revealed: ${revealed}`)
    await shot('revealed.png')
    stop = 'done'
  }
} catch (error) {
  note(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(OUT, 'notes.txt'), notes.join('\n') + '\n', 'utf8')
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Arena, the RPG round, resumed after the machine ran out of memory, ${SEND ? 'run' : 'look only'}.`, extra: notes.join('\n') })
}
