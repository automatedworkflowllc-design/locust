// The orb on a runtime that STREAMS its tool calls, photographed.
//
//   LOCUST_SPEND=1 node _tools/orb-paid-drive.mjs codex
//   LOCUST_SPEND=1 node _tools/orb-paid-drive.mjs claude
//
// SPENDS. Colin's explicit go, 2026-09-20: "yes you can run those turns and
// photograph them, try and use cheaper codex/claude models if possible".
//
// Why it has to cost something: the free OpenCode models report their tool
// calls when the tool FINISHES, so no tool is ever open and the orb never
// leaves its floor. `searching` and `connecting` -- the two states that say
// the most -- have therefore never been seen. Codex and Claude Code stream
// `tool.started`, so they are the only way to look at them.
//
// The cheapest model each runtime offers, by the picker's own words:
//   Codex        GPT-5.6-Luna   "Fast and affordable agentic coding model."
//   Claude Code  Sonnet         the cheapest of fable / opus / sonnet
// Both at `low` effort, and one short turn each.

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const WHICH = (process.argv[2] ?? '').toLowerCase()
const ROUTES = {
  codex: { group: '/codex/i', search: 'luna', row: '/luna/i', port: 9524, expect: /luna/i },
  claude: { group: '/claude/i', search: 'sonnet', row: '/sonnet/i', port: 9525, expect: /sonnet/i }
}
const route = ROUTES[WHICH]
if (route === undefined) {
  say('say which: codex | claude')
  process.exit(1)
}

let failures = 0
let sending
const check = (label, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 200)}`}`)
}

const workspace = await scratchRepository(`locust-orb-${WHICH}-ws-`)
const drive = await startDrive({
  name: `orb-${WHICH}`,
  port: route.port,
  workspace,
  // The gate. Nothing here runs without LOCUST_SPEND=1.
  spends: true
})

/** Keep every distinct (orb, register, words) the live step passes through. */
const WATCH = `(async () => {
  window.__orbSeen = []
  const tick = () => {
    const step = document.querySelector('.lc-livestep')
    if (step) {
      const orb = step.querySelector('.lc-livestep__orb canvas')
      const words = (step.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90)
      const register = step.getAttribute('data-register')
      const seen = orb === null ? 'none' : (orb.getAttribute('aria-label') || 'orb')
      const key = seen + '|' + register + '|' + words
      if (!window.__orbSeen.some(r => r.key === key)) {
        window.__orbSeen.push({ key, orb: seen, register, words })
      }
    }
    window.__orbTimer = setTimeout(tick, 100)
  }
  tick()
  return 'watching'
})()`

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture(`pick the cheap ${WHICH} model at low effort`, async () => {
    const picked = await drive.evaluate(pickRouteScript(route))
    check('the route is the cheap model', route.expect.test(String(picked)), picked)
    /*
     * EFFORT IS A SLIDER, NOT BUTTONS. The first version of this step looked
     * for a button labelled "low", found none, and left the panel open on
     * `medium` -- so the first two paid runs cost more than they were meant
     * to and the frame shows the open panel reading "medium". An input of
     * `type=range` has to be driven through its value setter and an `input`
     * event, the way React reads it.
     */
    const effort = await drive.evaluate(`(async () => {
      const control = [...document.querySelectorAll('.lc-control')].find(b => /effort/i.test(b.getAttribute('aria-label') ?? b.innerText))
      if (!control) return 'no effort control'
      if (!document.querySelector('.lc-effortpanel')) control.click()
      for (let i = 0; i < 20 && !document.querySelector('.lc-effortpanel__slider'); i += 1) await new Promise(r => setTimeout(r, 150))
      const slider = document.querySelector('.lc-effortpanel__slider')
      if (!slider) return 'no slider'
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(slider, slider.min)
      slider.dispatchEvent(new Event('input', { bubbles: true }))
      slider.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(r => setTimeout(r, 400))
      const now = document.querySelector('.lc-effortpanel__now')?.innerText.trim()
      // Close it, so it is not sitting over the thread in every frame.
      control.click()
      await new Promise(r => setTimeout(r, 300))
      return now ?? control.innerText.replace(/\\s+/g, ' ').trim()
    })()`)
    check('the turn runs at the lowest effort offered', /low/i.test(String(effort)), effort)
    return `${String(picked)} | effort ${String(effort)}`
  })

  await drive.capture('send one short turn that reads then shells', async () => {
    await drive.evaluate(WATCH)
    /*
     * A read and then a command, named explicitly, because those are the two
     * states that have never been seen. Kept tiny on purpose -- this is a
     * photograph, not a benchmark.
     */
    sending = drive.evaluate(
      sendAndWaitScript('Read README.md. Then run the command: echo orb. Then reply with the single word DONE. Do nothing else.', { waitSeconds: 300 })
    )
    return 'sent'
  })

  await drive.capture('the orb mid-run', async () => {
    const seen = await drive.waitFor(
      `(() => { const c = document.querySelector('.lc-livestep__orb canvas'); return c ? (c.getAttribute('aria-label') || 'orb') : false })()`,
      { what: 'an orb on the live step', timeoutMs: 60_000 }
    )
    return String(seen)
  })

  await drive.capture('the turn finishes', async () => String(await sending).slice(0, 150))

  await drive.capture('every orb this run passed through', async () => {
    await drive.evaluate(`clearTimeout(window.__orbTimer)`)
    const seen = JSON.parse(await drive.evaluate(`JSON.stringify(window.__orbSeen ?? [])`))
    for (const row of seen) say(`     ${String(row.orb).padEnd(13)} register=${String(row.register).padEnd(10)} ${String(row.words).slice(0, 62)}`)
    const withOrb = seen.filter((row) => row.orb !== 'none')
    check('an orb was on screen', withOrb.length > 0, `${String(seen.length)} states`)
    const kinds = new Set(withOrb.map((row) => row.orb))
    check('the orb changed at least once during the run', kinds.size > 1, [...kinds].join(', '))
    const wrong = withOrb.filter((row) => {
      const label = String(row.orb).toLowerCase()
      if (/searching/.test(label) && /shell|echo/i.test(String(row.words))) return true
      if (/working/.test(label) && /\bread\b|README/i.test(String(row.words))) return true
      return false
    })
    if (withOrb.length > 0) check('no orb contradicted the words beside it', wrong.length === 0, wrong.map((r) => r.key).join(' || '))
    return [...kinds].join(' → ')
  })
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  const threw = drive.record.filter((row) => /^threw: /.test(String(row.note)))
  threw.forEach((row) => check(`step ${String(row.step)} (${row.title}) completed`, false, row.note))
  say(failures === 0 ? '\nall checks passed' : `\n${String(failures)} check(s) failed`)
  await drive.finish({ intro: `One short turn on the cheapest ${WHICH} model, at low effort, to photograph the orbs a streaming runtime produces.` })
  process.exitCode = failures === 0 ? 0 : 1
}
