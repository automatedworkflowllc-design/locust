// A new person's first two minutes, photographed (0.358).
//
//   node _tools/drive-first-session.mjs [--packaged <exe>] [--tag <name>]
//        [--team "Write & design"] [--mate Iris] [--starter 1 | --ask "..."]
//        [--plain]
//
// `--plain` works in a folder with no git in it -- which is what someone who
// is not a coder has (0.365): the host must see a file a command made there
// too, and the Artifacts tab must list it.
//
// Locust is for "quite literally ANY ai user" (Colin, 2026-09-26), so this is
// someone who is not a coder: nobody on the team, nothing remembered. They
// start with a team from Home, open one of its teammates, and either press
// one of that teammate's suggestions (--starter N, the real button) or type
// a question (--ask). Then they read the answer, look at what happened, and
// look at any file it made. Every screen is captured at 1440x900 for a
// person to judge.
//
// Defaults are the first run of it: Research & money, Sable, a money
// question. Two things it checks, both found by that run on 0.358: a
// teammate outside Build software offers no code, and the Activity panel
// under a run that searched the web does not say the network was denied.
//
// A starter that asks another teammate for something (Moss's third: "Ask
// Quill for a short piece...") is waited out until the WHOLE team is quiet,
// not just the conversation on screen: the reply comes back after Quill's
// own run.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sendAndWaitScript, sleep, startDrive, teammateFace, teammateRows } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const team = arg('--team') ?? 'Research & money'
const mate = arg('--mate') ?? 'Sable'
const starter = arg('--starter') === undefined ? undefined : Number(arg('--starter'))
const plain = process.argv.includes('--plain')
const ask = arg('--ask') ?? (starter === undefined ? 'I have $12,000 saved and want to use it within three years. How should I think about where to keep it?' : undefined)
const slug = `${team === 'Research & money' && mate === 'Sable' && starter === undefined ? '' : `-${mate.toLowerCase()}${starter === undefined ? '' : `-starter${String(starter)}`}`}${plain ? '-plain' : ''}`
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `first-session${slug}-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = plain ? await mkdtemp(join(tmpdir(), 'locust-drive-first-session-plain-')) : await scratchRepository('locust-drive-first-session-ws-')
if (plain) await writeFile(join(workspace, 'notes.md'), ['# My notes', '', 'A plain folder, no git.', ''].join('\n'), 'utf8')
const drive = await startDrive({
  name: 'first-session',
  port: 9617,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  // The settings a new profile has: teammates may message each other.
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: true, relayHopCap: 2, memoryMode: 'on' } }
})
const verdicts = []

const text = (selector) => `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 220)`
const CODE_WORDS = /\b(code|codebase|repo|repository|pull request|README)\b/i

/** Until nothing on the team is working, and has not been for four seconds. */
const quietScript = (waitSeconds) => `(async () => {
  let calm = 0
  for (let i = 0; i < ${String(waitSeconds * 2)}; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    const busy = document.querySelector('button[aria-label^="Stop the running"]') !== null
      || ${teammateRows()}.some((row) => /working|running|starting|replying|listening|thinking|waiting/i.test(row.innerText))
    calm = busy ? 0 : calm + 1
    if (i > 6 && calm >= 8) break
  }
  return 'quiet: ' + (document.querySelector('.lc-sidebar')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 220)
})()`

try {
  await drive.capture('launch: a new person, nobody on the team', () => drive.ready())
  await drive.resize(1440, 900)
  await sleep(1200)
  await drive.capture('Home, first thing', () => drive.evaluate(text('main')))
  await drive.capture(`press ${team}`, () => drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-teamtemplate')].find((one) => one.textContent.includes(${JSON.stringify(team)}))
    if (!card) return 'no ${team.replace(/'/g, '')} card'
    card.click()
    for (let i = 0; i < 40 && !document.querySelector('.lc-hometeam:not(.lc-teamtemplates)'); i += 1) await new Promise((r) => setTimeout(r, 150))
    await new Promise((r) => setTimeout(r, 800))
    return ${text('.lc-hometeam')}
  })()`))
  await drive.capture(`open ${mate} from Home`, () => drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-hometeam__card')].find((one) => one.textContent.includes(${JSON.stringify(mate)}))
    if (!card) return 'no ${mate} card'
    card.click()
    await new Promise((r) => setTimeout(r, 1300))
    return document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? 'no composer'
  })()`))
  const offered = await drive.evaluate(`JSON.stringify({ starters: [...document.querySelectorAll('.lc-starter')].map((one) => one.textContent), line: document.querySelector('.lc-empty__inner p')?.textContent ?? '' })`)
  const { starters, line } = JSON.parse(offered)
  say(`${mate} offers: ${starters.join(' | ')} || ${line}`)
  if (team !== 'Build software') {
    verdicts.push(`${mate} offers no code: ${starters.length === 3 && !starters.some((one) => CODE_WORDS.test(one)) && !/codebase|reads this workspace/.test(line) ? 'PASS' : 'FAIL'}`)
  }

  const asked = starter === undefined ? ask : starters[starter - 1]
  if (asked === undefined) throw new Error(`no starter ${String(starter)}`)
  say(`asking: ${asked}`)
  await drive.capture(starter === undefined ? `ask ${mate}` : `press starter ${String(starter)}: ${asked.slice(0, 60)}`, () =>
    starter === undefined
      ? drive.evaluate(sendAndWaitScript(asked, { settle: false }))
      : drive.evaluate(`(async () => {
          const button = [...document.querySelectorAll('.lc-starter')][${String(starter - 1)}]
          if (!button || button.disabled) return 'no starter button'
          button.click()
          await new Promise((r) => setTimeout(r, 1500))
          return ${text('.lc-thread')}
        })()`)
  )
  const quiet = await drive.capture('the whole team, once quiet', () => drive.evaluate(quietScript(480)))
  say(quiet.slice(0, 200))
  await drive.capture(`${mate}'s conversation, at its end`, () => drive.evaluate(`(async () => {
    const face = ${teammateFace(mate)}
    face?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const scroller = document.querySelector('.lc-thread')?.closest('[class*="scroll"]') ?? document.querySelector('.lc-thread')
    scroller?.scrollTo?.({ top: 1e9 })
    await new Promise((r) => setTimeout(r, 600))
    return (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-400)
  })()`))
  // The window's own root must never scroll -- everything scrolls inside it.
  // (A scrollIntoView in the 0.363 drive moved the whole window 11px.)
  const rootOverflow = await drive.evaluate(`JSON.stringify({ y: Math.round(document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight), x: Math.round(document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth), top: document.scrollingElement.scrollTop })`)
  say(`root overflow in a conversation: ${rootOverflow}`)
  verdicts.push(`the window root does not scroll: ${/"y":0,"x":0/.test(rootOverflow) ? 'PASS' : 'FAIL'} (${rootOverflow})`)
  // A new document shows in the conversation as the page it is (0.363).
  await drive.capture('the document it wrote, in the conversation', () => drive.evaluate(`(async () => {
    const preview = document.querySelector('.lc-docpreview')
    if (!preview) return 'no document preview'
    // The thread's own scroller only: scrollIntoView moves every scrollable
    // ancestor, the window's root included.
    const card = preview.closest('.lc-card')
    let scroller = card?.parentElement
    while (scroller && scroller !== document.body && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
    if (card && scroller && scroller !== document.body) scroller.scrollTop += card.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
    await new Promise((r) => setTimeout(r, 600))
    return (preview.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 220)
  })()`))
  // What a person does with a file their teammate made: open it. The pill
  // under the answer, or the fold's own open control when there is no pill.
  await drive.capture('open the file it made', () => drive.evaluate(`(async () => {
    const open = document.querySelector('.lc-handedfile__open') ?? document.querySelector('.lc-filerow__view')
    if (!open) return 'no file to open'
    open.click()
    await new Promise((r) => setTimeout(r, 1500))
    return ${text('.lc-viewer')}
  })()`))
  await drive.evaluate(`(() => { document.querySelector('.lc-viewer__close')?.click(); return 'closed' })()`)
  await sleep(600)
  await drive.capture('what happened (Activity)', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Activity')?.click()
    await new Promise((r) => setTimeout(r, 900))
    return ${text('.lc-inspector')}
  })()`))
  const panel = await drive.evaluate(`(document.querySelector('.lc-inspector')?.innerText ?? '').replace(/\\s+/g, ' ')`)
  if (/Searched the web/.test(panel)) {
    verdicts.push(`the panel says the web is allowed (it searched): ${/search the web and open web pages/.test(panel) && !/beyond the model's own/.test(panel) ? 'PASS' : 'FAIL'}`)
  }
  await drive.capture('the files it made (Artifacts)', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-inspector button[role="tab"]')].find((b) => b.textContent.trim() === 'Artifacts')?.click()
    await new Promise((r) => setTimeout(r, 700))
    return ${text('.lc-inspector')}
  })()`))
  await drive.capture('back on Home, with a team and a conversation', () => drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('.lc-inspector__close')].forEach((b) => b.click())
    document.querySelector('.lc-brand__lockup')?.click()
    await new Promise((r) => setTimeout(r, 1200))
    return ${text('main')}
  })()`))
  await drive.capture('the sidebar: who has a conversation now', () => drive.evaluate(`(document.querySelector('.lc-sidebar')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 300)`))
  say(verdicts.join(' | '))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. A new person, nobody on the team: ${team}, then ${mate}${starter === undefined ? `, asked: ${ask ?? ''}` : `'s starter ${String(starter)}`}, on the free model. Screens for a person to judge. Verdicts: ${verdicts.join('; ')}` })
}
