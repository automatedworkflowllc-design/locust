// The context ring and a subscription run's cost, through the app.
//
//   LOCUST_SPEND=1 node _tools/drive-ring-reading.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-09-23: "context is showing as 5m/1 and it has a conversation
// cost, which is silly for a subscription plan". Measured the same night off
// his ledger: the ring summed the run's token totals, which count the whole
// conversation once per model call, and his runs were on the subscription's
// usage windows while the receipt showed Claude Code's API price for them.
//
// One Claude Code turn on HAIKU (Colin, 2026-09-22: Claude and Codex allowed
// for testing, cheap models only), asked to read a file so the run makes more
// than one call -- the case the old reading got wrong. Then it reads back the
// ring, its hover, the receipt, and the run's own ledger record, and checks
// the ring against what the ledger says the last call held.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')

const workspace = await scratchRepository('locust-drive-ring-ws-')
await writeFile(join(workspace, 'notes.txt'), ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'].join('\n') + '\n', 'utf8')

const drive = await startDrive({
  name: 'ring-reading',
  port: 9412,
  workspace,
  spends: true,
  outPath: join(recordRoot('ring-reading-2026-09-23'), tag),
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

/** Every run.completed usage in the drive's own ledger. */
async function receipts() {
  const dir = join(drive.profile, 'mission-ledger')
  const found = []
  for (const file of await readdir(dir).catch(() => [])) {
    if (!file.endsWith('.jsonl')) continue
    for (const line of (await readFile(join(dir, file), 'utf8')).split('\n')) {
      if (!line.includes('"run.completed"')) continue
      try {
        const usage = JSON.parse(line)?.event?.payload?.usage
        if (usage !== undefined) found.push(usage)
      } catch { /* a torn line */ }
    }
  }
  return found
}

try {
  await drive.capture('Wren on Claude Code / haiku', async () => {
    await drive.ready()
    await drive.resize(1280, 800)
    await drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 700))
    })()`)
    return drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'haiku', row: '/haiku/i' }))
  })

  // Asserted BEFORE anything is sent: a drive that sends on the wrong route
  // spends first and notices second.
  const route = await drive.evaluate(`(() => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    return control ? control.innerText.replace(/\\s+/g, ' ').trim() : ''
  })()`)
  if (!/haiku/i.test(route)) {
    say(`refusing to send: the composer is on "${route}", not Haiku.`)
    throw new Error('wrong route')
  }
  say(`route: ${route}`)

  await drive.capture('ask for a file read, and settle', () =>
    drive.evaluate(sendAndWaitScript('Read notes.txt with the Read tool and tell me how many lines it has. One short sentence.', { waitSeconds: 240 }))
  )

  const ring = JSON.parse(await drive.evaluate(`JSON.stringify((() => {
    const ring = document.querySelector('.lc-contextring')
    return ring ? { label: ring.getAttribute('aria-label') ?? '', title: ring.getAttribute('title') ?? '' } : null
  })())`))
  say(`ring: ${JSON.stringify(ring)}`)

  const [usage] = (await receipts()).slice(-1)
  say(`ledger receipt: ${JSON.stringify(usage)}`)
  const summed = (usage?.inputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0)
  check('the receipt measures the last call, and it is less than the run added up', typeof usage?.contextTokens === 'number' && usage.contextTokens > 0 && usage.contextTokens < summed, `last call ${String(usage?.contextTokens)} vs added up ${String(summed)}`)
  check('the receipt says the subscription covered the run', usage?.billing === 'subscription', String(usage?.billing))

  const reading = /Context: ([\d.]+)([kM]?) of ([\d.]+)([kM]?) used, (\d+)%/.exec(ring?.label ?? '')
  const tokens = (n, unit) => Number(n) * (unit === 'M' ? 1_000_000 : unit === 'k' ? 1_000 : 1)
  const shown = reading === null ? undefined : tokens(reading[1], reading[2])
  check('the ring is drawn and reads what the last call held', shown !== undefined && typeof usage?.contextTokens === 'number' && Math.abs(shown - usage.contextTokens) <= Math.max(100, usage.contextTokens * 0.01), `ring ${String(shown)} vs ledger ${String(usage?.contextTokens)}`)
  check('the ring never reads more than the window', reading !== null && tokens(reading[1], reading[2]) <= tokens(reading[3], reading[4]), ring?.label)
  check('the ring’s hover carries no dollar figure', ring !== null && !ring.label.includes('$') && !ring.title.includes('$'), ring?.title)

  // A window near its limit puts a warning line in the thread on every turn
  // (it read "seven_day limit allowed_warning · resets 2026-09-28T07:00:00.000Z"
  // on this drive's first pass). Whether one shows depends on the account's
  // windows today, so it is checked where it appears.
  const warnings = JSON.parse(await drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-thread .lc-diagnostic')].map((line) => line.innerText.replace(/\\s+/g, ' ').trim()).filter((text) => /limit|window/i.test(text)))`))
  say(`limit lines: ${JSON.stringify(warnings)}`)
  if (warnings.length > 0) {
    check('a limit warning reads in words, with a local reset time', warnings.every((text) => !/_|\\d{4}-\\d{2}-\\d{2}T/.test(text) && /window/.test(text)), JSON.stringify(warnings))
  }

  // A live run's receipt is the inspector's (the durable receipt card is for
  // a mission restored from the ledger).
  const inspector = await drive.capture('the inspector, opened', () => drive.evaluate(`(async () => {
    const toggle = [...document.querySelectorAll('.lc-workroom__header button')].find((b) => b.innerText.trim() === 'Activity')
    if (toggle && toggle.getAttribute('aria-pressed') !== 'true') toggle.click()
    await new Promise(r => setTimeout(r, 500))
    ;[...document.querySelectorAll('.lc-inspector [role="tab"]')].find((t) => t.innerText.trim() === 'Details')?.click()
    await new Promise(r => setTimeout(r, 400))
    const rows = {}
    for (const term of document.querySelectorAll('.lc-inspector dt')) rows[term.textContent.trim()] = term.nextElementSibling?.textContent.trim() ?? ''
    return JSON.stringify(rows)
  })()`))
  const rows = JSON.parse(inspector ?? '{}')
  check('the inspector says the plan covered the run, with no price', rows.Cost === 'in your plan', JSON.stringify({ Cost: rows.Cost, Usage: rows.Usage }))

  const missions = await drive.capture('the Missions screen', () => drive.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.innerText.replace(/\\s+/g, ' ').trim() === 'Missions')
    tab?.click()
    await new Promise(r => setTimeout(r, 800))
    return JSON.stringify({
      meta: document.querySelector('.lc-screen')?.innerText.split('\\n').slice(0, 4).join(' | ') ?? '',
      cells: [...document.querySelectorAll('.lc-missionrow__cost')].map((cell) => cell.innerText.trim())
    })
  })()`))
  const list = JSON.parse(missions ?? '{}')
  check('the Missions row says the plan covered it', list.cells?.length === 1 && list.cells[0] === 'in your plan', JSON.stringify(list.cells))
  check('the Missions header states no total for a run nobody paid for', typeof list.meta === 'string' && !list.meta.includes('$') && !list.meta.includes('across'), list.meta)
  say(failures === 0 ? '\nCONTEXT RING PASSED' : `\nCONTEXT RING: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'One Claude Code turn on Haiku, reading a file: the context ring, its hover, the receipt, and the ledger record they came from.' })
}
