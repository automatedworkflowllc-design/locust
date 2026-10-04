// Home with a conversation open beside it (fresh-eyes check; the 0.402 beta
// retest: at 1215x800 Home's team cards squashed to "Res..." and tiny text).
//
//   node _tools/drive-home-beside.mjs [--packaged <exe>] [--tag <name>]
//
// Free model. Three teammates; Wren answers one word so there is a
// conversation; it is opened BESIDE, and the middle goes to Home. At three
// window widths, every team card's name and role must be whole (not cut
// with an ellipsis) and at least 12px text.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const OUT = join(recordRoot('home-beside-2026-09-27'), `home-beside-${tag}`)
await mkdir(OUT, { recursive: true })
const T0 = '2026-09-27T05:00:00.000Z'
const drive = await startDrive({
  name: `home-beside-${tag}`,
  port: 9719,
  workspace: await scratchRepository('locust-home-beside-ws-'),
  outPath: OUT,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: FREE_ROUTE },
      { teammateId: 'tm_sable', name: 'Sable', hue: 'blue', role: 'Data & Reporting', createdAt: T0, route: FREE_ROUTE },
      { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Research & Briefs', createdAt: T0, route: FREE_ROUTE }
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
const CARDS = `JSON.stringify((() => {
  const cards = [...document.querySelectorAll('.lc-empty .lc-hometeam__card')]
  const pane = document.querySelector('.lc-empty')?.getBoundingClientRect()
  const box = (el) => el?.getBoundingClientRect()
  const inside = (inner, outer) => inner && outer && inner.left >= outer.left - 1 && inner.right <= outer.right + 1
  // What is actually SEEN of an element: its box cut by every clipping
  // ancestor up to the cover. The glass's own box is wider than what shows
  // (the first version of this check measured it and passed on the build
  // that read "LOC").
  const seenOf = (el) => {
    let r = el?.getBoundingClientRect()
    if (!r) return undefined
    let left = r.left; let right = r.right
    for (let up = el.parentElement; up && !up.classList.contains('lc-empty'); up = up.parentElement) {
      const style = getComputedStyle(up)
      if (style.overflowX !== 'visible' || style.overflow === 'hidden' || style.clipPath !== 'none') {
        const u = up.getBoundingClientRect(); left = Math.max(left, u.left); right = Math.min(right, u.right)
      }
    }
    return { left, right, width: right - left, full: r.width }
  }
  const whole = (el) => { const s = seenOf(el); return s !== undefined && s.width >= s.full - 1 }
  const glass = box(document.querySelector('.lc-empty .lc-cover__glass'))
  const claimEl = document.querySelector('.lc-empty .lc-cover__claim')
  const claimShown = claimEl !== null && getComputedStyle(claimEl).visibility !== 'hidden'
  const more = box(document.querySelector('.lc-empty .lc-agenthead__more'))
  const marks = [...document.querySelectorAll('.lc-empty .lc-agenthead__marks .lc-agentmark')].map(box)
  const overlaps = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
  const composer = box(document.querySelector('.lc-empty ~ * .lc-composer__inner, .lc-composer__inner'))
  const outside = [...document.querySelectorAll('.lc-composer__inner button')].filter((b) => b.offsetParent !== null && !inside(box(b), composer)).map((b) => (b.getAttribute('aria-label') || b.innerText || '?').trim().slice(0, 30))
  const sign = {
    lockupWhole: whole(document.querySelector('.lc-empty .lc-lockup__name')) && whole(document.querySelector('.lc-empty .lc-lockup__mark')),
    claim: claimShown ? (whole(claimEl) ? 'shown, whole' : 'shown, cut') : 'set aside',
    glassSeen: Math.round(seenOf(document.querySelector('.lc-empty .lc-cover__glass'))?.width ?? 0)
  }
  return { sign, marksUnderShowAll: marks.filter((m) => overlaps(m, more)).length, outside, pane: Math.round(pane?.width ?? 0), beside: document.querySelector('.lc-beside') !== null, cards: cards.map((card) => {
    const texts = [...card.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.textContent.trim().length > 0)
    return {
      w: Math.round(card.getBoundingClientRect().width),
      cut: [...card.querySelectorAll('.lc-hometeam__name, .lc-hometeam__role')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim()),
      smallest: Math.min(...texts.map((el) => parseFloat(getComputedStyle(el).fontSize))),
      text: card.innerText.replace(/\\s+/g, ' ').trim()
    }
  }) }
})())`

try {
  await drive.ready()
  await drive.resize(1440, 900)
  await drive.evaluate(`${teammateFace('Wren')}?.click()`)
  await sleep(500)
  const sent = String(await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly the word: ready.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); break }
    }
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 400))
      if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
    }
    return 'timed out'
  })()`))
  check('Wren answered, so there is a conversation', sent === 'ended', sent)
  const opened = String(await drive.evaluate(`(async () => {
    const target = [...document.querySelectorAll('.lc-conv')].find((entry) => entry.querySelector('[data-teammate="tm_wren"]'))
    if (!target) return 'no Wren row'
    const box = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 40, clientY: box.top + 10 }))
    await new Promise((r) => setTimeout(r, 400))
    const item = [...document.querySelectorAll('[role=menuitem], .lc-menu button, .lc-contextmenu button')].find((entry) => /^Open beside/.test(entry.innerText.trim()))
    if (!item) return 'no Open beside item'
    item.click()
    await new Promise((r) => setTimeout(r, 900))
    document.querySelector('.lc-brand__lockup')?.click()
    await new Promise((r) => setTimeout(r, 900))
    return document.querySelector('.lc-beside') !== null && document.querySelector('.lc-empty') !== null ? 'home beside' : 'not both'
  })()`))
  check('Home in the middle, Wren beside it', opened === 'home beside', opened)
  for (const [width, height] of [[1920, 1080], [1440, 900], [1215, 800]]) {
    await drive.resize(width, height)
    await sleep(1200)
    const seen = JSON.parse(String(await drive.capture(`Home beside a conversation at ${String(width)}x${String(height)}`, () => drive.evaluate(CARDS))))
    say(`  ${String(width)}x${String(height)}: pane ${String(seen.pane)}px, cards ${JSON.stringify(seen.cards.map((card) => card.w))}`)
    check(`${String(width)}x${String(height)}: the team cards are there`, seen.cards.length === 3, String(seen.cards.length))
    check(`${String(width)}x${String(height)}: no card's name or role is cut off`, seen.cards.every((card) => card.cut.length === 0), JSON.stringify(seen.cards.map((card) => card.cut)))
    check(`${String(width)}x${String(height)}: no card text under 12px`, seen.cards.every((card) => card.smallest >= 12), JSON.stringify(seen.cards.map((card) => card.smallest)))
    // 0.405, seen in this drive's own capture: three more things a narrow Home cut.
    check(`${String(width)}x${String(height)}: the sign is whole -- LOCUST inside its glass, the claim inside or set aside`, seen.sign.lockupWhole && seen.sign.claim !== 'shown, cut', JSON.stringify(seen.sign))
    check(`${String(width)}x${String(height)}: no agent mark under Show all`, seen.marksUnderShowAll === 0, String(seen.marksUnderShowAll))
    check(`${String(width)}x${String(height)}: every chat box button inside the chat box`, seen.outside.length === 0, JSON.stringify(seen.outside))
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged === undefined ? 'out/' : 'the packaged build'}. Three teammates on a free model; Wren's conversation open beside Home.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
