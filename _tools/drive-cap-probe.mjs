// How many missions can actually run at once?
//
//   COUNT=8 node _tools/drive-cap-probe.mjs
//
// MAX_LIVE_MISSIONS has been 4 since P6b (32dd88b, 1 Sep), where it is
// called "a resource bound". Nothing behind that was ever measured. The code
// comment names two costs -- a provider process, and a BOUNDED RECORD QUEUE
// whose filling ends a run as an output-limit failure -- and one judgement,
// that four is already more than a person can follow.
//
// The queue is the only stated failure mode with teeth, so this leans on it
// deliberately: every mission is asked to count to 250, one number per line,
// which is steady high-rate output rather than one word at the end. If a
// bounded queue overflows under concurrency, it overflows here.
//
// A room is the gesture that starts N missions at once, so the probe posts
// to a room of N and then watches. Set COUNT above the cap and the extra
// members are refused rather than queued -- which is the state this whole
// line of work started from, and worth seeing at each N.
//
// FREE: N short runs on the free OpenCode model, read-only. Nothing here
// spends. Note that a free provider may itself rate-limit at high N; every
// failure's own words are recorded so a provider refusal is never read as
// the app breaking.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { FREE_ROUTE, say, scratchRepository, startDrive } from './drive-lib.mjs'

const run = promisify(execFile)
const COUNT = Number(process.env.COUNT ?? '8')
if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 16) {
  throw new Error(`COUNT must be a whole number from 1 to 16, not ${String(process.env.COUNT)}`)
}

const NAMES = ['Wren', 'Booty', 'Gem', 'Fen', 'Otto', 'Pike', 'Ash', 'Bryn', 'Cove', 'Dell', 'Ember', 'Flint', 'Gale', 'Hollis', 'Iver', 'Juno']
const HUES = ['lime', 'blue', 'clay', 'violet']

/**
 * Working set of every process that could belong to this run, in MB.
 *
 * Sampled by NAME against a baseline taken before the app launches, because
 * drive-lib does not hand out the child's pid. Other node processes on the
 * box land in both readings, so the DELTA is the number to read and the
 * absolute is noise.
 */
const memoryMb = async () => {
  const { stdout } = await run(
    'powershell',
    ['-NoProfile', '-Command', "(Get-Process -ErrorAction SilentlyContinue -Name Locust,electron,node,opencode,bun | Measure-Object -Property WorkingSet64 -Sum).Sum"],
    { windowsHide: true }
  ).catch(() => ({ stdout: '0' }))
  return Math.round(Number(stdout.trim() || '0') / 1_048_576)
}

const before = await memoryMb()
say(`  baseline working set: ${String(before)} MB`)

// A brief that does NOT fight the prompt. The default LOCUST.md says "Keep
// answers to one paragraph", Locust carries it to every teammate, and the
// first runs of this probe measured eight agents arguing with that rather
// than eight agents producing output.
const workspace = await scratchRepository(
  'locust-drive-cap-ws-',
  'Answer exactly what you are asked for, at whatever length that takes. Do not shorten or summarise.\n'
)
const drive = await startDrive({
  name: `cap-${String(COUNT)}`,
  port: 9432,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: NAMES.slice(0, COUNT).map((name, i) => ({
      teammateId: `tm_${name.toLowerCase()}`,
      name,
      hue: HUES[i % HUES.length],
      role: 'Code & Migrations',
      createdAt: `2026-09-05T05:00:${String(i).padStart(2, '0')}.000Z`,
      route: { ...FREE_ROUTE, mode: 'ask' }
    })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let peak = before
const watch = setInterval(() => {
  void memoryMb().then((mb) => {
    if (mb > peak) peak = mb
  })
}, 2_000)

try {
  await drive.capture('launch', () => drive.ready())

  await drive.capture(`make a room of ${String(COUNT)}`, () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    const input = document.querySelector('input[aria-label="Room name"]')
    if (!input) return 'no name field'
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'Probe'); input.dispatchEvent(new Event('input', { bubbles: true }))
    const members = [...document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')]
    for (const m of members) if (m.getAttribute('aria-checked') !== 'true') m.click()
    await new Promise(r => setTimeout(r, 300))
    const create = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Create room')
    if (!create || create.disabled) return 'Create room disabled'
    create.click()
    await new Promise(r => setTimeout(r, 1200))
    const ticked = members.filter(m => m.getAttribute('aria-checked') === 'true').length
    const warning = [...document.querySelectorAll('.lc-settings__note')].map(n => n.innerText.trim()).find(t => /run at once/.test(t)) ?? 'none'
    // Whether the room EXISTS, not whether the button was clicked. The
    // composer is the proof: no room, no compose box.
    const made = document.querySelector('.lc-roomcompose__box') !== null
    const refusal = [...document.querySelectorAll('.lc-settings__note')].map(n => n.innerText.trim()).find(t => /needs between|could not/i.test(t)) ?? ''
    return (made ? 'MADE' : 'NOT MADE') + ' · ticked ' + ticked + ' · warning: ' + warning + (refusal ? ' · refused: ' + refusal : '')
  })()`))

  /*
   * The premise, asserted OUTSIDE capture().
   *
   * capture() records a thrown error as the step's note and walks on, so a
   * failed premise reads as the app having nothing to show. COUNT=12 was run
   * with no room at all: the room store refuses more than MAX_ROOM_TEAMMATES
   * (8) with "a room needs between 1 and 8 teammates", the compose box never
   * appeared, and the probe reported 401 seconds and a memory figure for a
   * post that was never made. Third time this session that a drive has
   * reported the app for a premise it never checked.
   */
  const made = await drive.evaluate(`document.querySelector('.lc-roomcompose__box') !== null`)
  if (made !== true) {
    const why = await drive.evaluate(`[...document.querySelectorAll('.lc-settings__note')].map(n => n.innerText.trim()).join(' · ')`)
    throw new Error(`NOT A CAP TEST: no room of ${String(COUNT)} was made, so nothing was posted. The screen said: ${String(why)}`)
  }

  const started = Date.now()
  await drive.capture('one post, counting to 250 each', () => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-roomcompose__box')
    if (!box) return 'no compose box'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Count from 1 to 250. Put each number on its own line, in order, with no other text and no commentary. Do not stop early, do not summarise, and do not edit any files.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    document.querySelector('.lc-roomcompose').requestSubmit()
    for (let i = 0; i < 80; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelectorAll('.lc-roomanswer').length >= ${String(COUNT)}) break
    }
    await new Promise(r => setTimeout(r, 600))
    const phases = [...document.querySelectorAll('.lc-roomanswer__phase')].map(p => p.textContent.trim())
    return 'cards: ' + phases.length + ' · started: ' + phases.filter(p => !/did not start/i.test(p)).length + ' · refused: ' + phases.filter(p => /did not start/i.test(p)).length
  })()`))

  await drive.capture('watch them run to the end', () => drive.evaluate(`(async () => {
    // Waits on what STARTED, never on COUNT: a member the cap refused reads
    // "did not start" forever, and a condition that cannot be met is a
    // broken test rather than a slow one.
    const trail = []
    for (let i = 0; i < 900; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const phases = [...document.querySelectorAll('.lc-roomanswer__phase')].map(p => p.textContent.trim())
      const live = phases.filter(p => !/did not start/i.test(p))
      const running = live.filter(p => !/completed|failed|cancelled/i.test(p)).length
      if (trail[trail.length - 1] !== running) trail.push(running)
      if (live.length > 0 && running === 0) {
        return 'ran ' + live.length + ' · ended: ' + live.join(', ') + ' · concurrency over time: ' + trail.join(' -> ')
      }
    }
    return 'STILL RUNNING after 15 minutes · concurrency over time: ' + trail.join(' -> ')
  })()`))

  const elapsed = Math.round((Date.now() - started) / 1000)

  await drive.capture('what each one actually said, and any failure in its own words', () => drive.evaluate(`(async () => {
    const out = []
    for (const card of document.querySelectorAll('.lc-roomanswer')) {
      const name = card.querySelector('.lc-roomanswer__name')?.textContent.trim() ?? '?'
      const phase = card.querySelector('.lc-roomanswer__phase')?.textContent.trim() ?? '?'
      const text = (card.querySelector('.lc-roomanswer__text')?.textContent ?? '').replace(/\\s+/g, ' ').trim()
      // 250 lines counted correctly is the signal that nothing was dropped;
      // a run that "completed" having said 60 numbers lost the rest.
      const numbers = text.match(/\\b\\d{1,3}\\b/g) ?? []
      const last = numbers.length ? numbers[numbers.length - 1] : 'none'
      out.push(name + ' · ' + phase + ' · counted to ' + last + ' (' + numbers.length + ' numbers) ' + (/fail|error|limit|refus/i.test(phase + ' ' + text) ? '· SAID: ' + text.slice(0, 120) : ''))
    }
    return out.join(' || ')
  })()`))

  await drive.capture('the missions screen, and whether the ledger is intact', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 900))
    return (document.querySelector('.lc-screen__meta')?.innerText.replace(/\\s+/g, ' ') ?? '') + ' || rows: ' + document.querySelectorAll('.lc-missionrow').length
  })()`))

  clearInterval(watch)
  const after = await memoryMb()
  say('')
  say(`  RESULT for COUNT=${String(COUNT)}`)
  say(`    wall clock: ${String(elapsed)}s from post to last run ending`)
  say(`    working set: baseline ${String(before)} MB · peak ${String(peak)} MB · delta ${String(peak - before)} MB (${String(Math.round((peak - before) / COUNT))} MB per mission)`)
  say(`    after settling: ${String(after)} MB`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  clearInterval(watch)
  await drive.finish({ intro: `Build: whatever \`pnpm build\` last wrote to out/. ${String(COUNT)} teammates on the free OpenCode model, read-only, one room, one post asking each to count to 250 -- steady output, to lean on the bounded record queue the cap is justified by.` })
}
