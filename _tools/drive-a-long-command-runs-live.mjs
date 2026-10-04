// A LONG COMMAND RUNS LIVE (0.610): a real Claude Code run whose one command is past the
// ledger's 16,384 characters finishes, and the ledger keeps that command cut to fit.
//
//   LOCUST_SPEND=1 node _tools/drive-a-long-command-runs-live.mjs --packaged <exe>
//
// Fable 5.1 wrote the arena's page through one Bash heredoc of 29,322 characters (2026-10-04).
// Claude Code's adapter passed the command on unbounded, the ledger refused the event, and
// Locust stopped the run before the command ran. a-long-command-does-not-stop-the-run.test.ts
// checks the adapter into a real ledger; this is the live run an adapter change needs before
// anything depends on it -- here, before the arena's paid re-run. On Haiku, the cheapest
// Claude model (Sonnet if Haiku is not offered): the test is about Claude Code's adapter.
//
// Checks, all four or it fails:
//   1. THE CONTROL: Claude Code's own session file holds a Bash command longer than 16,384
//      characters. Without it the run proved nothing (a model that used a loop, say).
//   2. The run ended, and not with "the mission ledger could not be written".
//   3. The file the command writes is in the folder, larger than 16,384 bytes: it ran.
//   4. Locust's ledger holds that command cut to at most 16,384 characters, with the same
//      start and the same end as the original.
//
// The folder is in the drives' scratch root, which has no CLAUDE.md above it since it moved out of
// Documents (scratch-root.mjs, 2026-10-04): Claude Code loads every CLAUDE.md above its folder.

import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { recordRoot, say, sleep, startDrive } from './drive-lib.mjs'
import { SCRATCH_ROOT, instructionFilesAbove } from './scratch-root.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const OUT = join(recordRoot('a-long-command-runs-live'), new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(OUT, { recursive: true })
const LIMIT = 16_384
const PROMPT = `In this folder, create numbers.html with exactly one Bash command: a heredoc that starts with cat > numbers.html <<'EOF' and ends with EOF. Inside it, write an HTML table with one row per whole number from 1 to 700, every row typed out in full on its own line in this form: <tr><td>7</td><td>7 squared is 49</td></tr>

Do not generate the rows with a loop, a script or any other command, and do not run anything else. Then reply with the single word: done`

const workspace = await mkdtemp(join(SCRATCH_ROOT, 'locust-long-command-'))
if (instructionFilesAbove(workspace).length > 0) throw new Error(`an instruction file sits above ${workspace}: ${instructionFilesAbove(workspace).join(', ')}`)
const drive = await startDrive({
  name: 'long-command-run', port: 9876, workspace, outPath: OUT, spends: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
const shot = async (file) => {
  const picture = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (picture?.result?.data) await writeFile(join(OUT, file), Buffer.from(picture.result.data, 'base64'))
}
const notes = []
const note = (line) => { notes.push(line); say(`  ${line}`) }
const checks = {}
let failed = true
try {
  await drive.ready()
  await drive.resize(1200, 780)
  await sleep(5000)
  // The model: Claude Code's Haiku 4.5 row (the pinned version when offered), else Sonnet 5.5.
  let picked = { picked: null }
  for (const [search, label] of [['haiku', 'Haiku 4\\.5'], ['sonnet', 'Sonnet 5\\.5']]) {
    picked = JSON.parse(String(await drive.evaluate(`(async () => {
      const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
      if (!control) return JSON.stringify({ picked: null, why: 'no route control' })
      if (!document.querySelector('.lc-picker')) control.click()
      let box = null
      for (let i = 0; i < 20 && !box; i += 1) { await new Promise((r) => setTimeout(r, 250)); box = document.querySelector('.lc-picker__input') }
      if (!box) return JSON.stringify({ picked: null, why: 'no picker' })
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, ${JSON.stringify(search)})
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 900))
      let group = ''
      const all = []
      for (const el of document.querySelectorAll('.lc-picker__group, .lc-picker__row')) {
        if (el.classList.contains('lc-picker__group')) { group = el.textContent.replace(/\\s+/g, ' ').trim(); continue }
        if (el.classList.contains('is-recent')) continue
        all.push({ el, group, label: el.querySelector('.lc-picker__label')?.textContent.trim() ?? '', detail: el.querySelector('.lc-picker__detail')?.textContent.trim() ?? '', disabled: el.disabled })
      }
      const fits = all.filter((row) => !row.disabled && /^Claude Code/i.test(row.group) && /^${label}$/i.test(row.label))
      const row = fits.find((one) => /This version/i.test(one.detail)) ?? fits[0]
      row?.el.click()
      await new Promise((r) => setTimeout(r, 700))
      if (row === undefined) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return JSON.stringify({ picked: row === undefined ? null : row.group + ' / ' + row.label + ' / ' + row.detail, all: all.map(({ el, ...rest }) => rest.group.slice(0, 14) + ' | ' + rest.label) })
    })()`)))
    note(`model (${search}): picked ${String(picked.picked)}${picked.why ? ' -- ' + picked.why : ''}`)
    if (picked.picked !== null) break
    await sleep(500)
  }
  // Auto, as Fable's run was.
  await drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Permission mode"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
    ;[...document.querySelectorAll('[role="menu"][aria-label="Permission mode"] [role="menuitemradio"]')].find((b) => b.querySelector('.lc-menu__name')?.textContent.trim() === 'Auto')?.click()
    await new Promise((r) => setTimeout(r, 500))
  })()`)
  await drive.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(400)
  const set = JSON.parse(String(await drive.evaluate(`JSON.stringify({
    route: [...document.querySelectorAll('.lc-control')].find((c) => c.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    mode: document.querySelector('button[aria-label="Permission mode"]')?.innerText.trim() ?? '',
    chat: document.querySelector('.lc-control--chatmode')?.getAttribute('aria-label') ?? ''
  })`)))
  note(`as set: ${JSON.stringify(set)}`)
  await shot('set-up.png')
  if (picked.picked === null || !/^Auto$/.test(set.mode) || /compare|blind/i.test(set.chat)) throw new Error('not set up as asked: nothing sent')
  const sentAt = Date.now()
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(PROMPT)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    document.querySelector('button[aria-label="Send"]')?.click()
  })()`)
  note(`sent at ${new Date(sentAt).toISOString()}`)
  let endedAt
  for (let second = 0; second < 900; second += 2) {
    await sleep(2000)
    const running = await drive.evaluate(`Boolean(document.querySelector('button[aria-label^="Stop the running"]'))`)
    if (second > 10 && running !== true) { endedAt = Date.now(); break }
  }
  note(`ended after ${endedAt === undefined ? 'the bound (900 s)' : String(Math.round((endedAt - sentAt) / 1000)) + ' s'}`)
  await sleep(3000)
  const tail = String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-900) ?? ''`))
  note(`tail: ${tail.slice(-400)}`)
  await shot('done.png')
  checks.ended = endedAt !== undefined && !/mission ledger could not be written|not readable by the ledger reader/i.test(tail)

  // 1. The control: Claude Code's own session file, for this folder.
  const slug = workspace.replace(/[^a-zA-Z0-9]/g, '-')
  const projectDir = join(homedir(), '.claude', 'projects', slug)
  const sessions = (await readdir(projectDir).catch(() => [])).filter((name) => name.endsWith('.jsonl'))
  let original = ''
  for (const name of sessions) {
    for (const line of (await readFile(join(projectDir, name), 'utf8')).split('\n').filter(Boolean)) {
      let row
      try { row = JSON.parse(line) } catch { continue }
      for (const part of row.type === 'assistant' ? row.message?.content ?? [] : []) {
        if (part.type === 'tool_use' && part.name === 'Bash' && typeof part.input?.command === 'string' && part.input.command.length > original.length) original = part.input.command
      }
    }
  }
  checks.control = original.length > LIMIT
  note(`control: the longest Bash command in Claude Code's session file is ${String(original.length)} characters (${checks.control ? 'past' : 'NOT past'} the ledger's ${String(LIMIT)})`)

  // 3. It ran: the file is in the folder.
  const written = await stat(join(workspace, 'numbers.html')).catch(() => null)
  checks.ran = written !== null && written.size > LIMIT
  note(`numbers.html: ${written === null ? 'missing' : String(written.size) + ' bytes'}`)

  // 4. The ledger kept it, cut to fit, both ends whole.
  await cp(join(drive.profile, 'mission-ledger'), join(OUT, 'mission-ledger'), { recursive: true })
  const kept = []
  for (const name of (await readdir(join(OUT, 'mission-ledger'))).filter((one) => one.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(OUT, 'mission-ledger', name), 'utf8')).split('\n').filter(Boolean)) {
      const record = JSON.parse(line)
      const command = record.event?.payload?.command
      if (/^tool\./.test(record.event?.type ?? '') && typeof command === 'string') kept.push({ type: record.event.type, length: command.length, command })
    }
  }
  const head = original.slice(0, 40)
  const end = original.trimEnd().slice(-20)
  const bounded = kept.filter((one) => one.command.startsWith(head) && one.command.trimEnd().endsWith(end))
  checks.ledger = original.length > LIMIT && bounded.length > 0 && kept.every((one) => one.length <= LIMIT)
  note(`ledger: ${String(kept.length)} tool event(s) with a command, lengths ${JSON.stringify(kept.map((one) => one.length))}; ${String(bounded.length)} keep the original's start and end`)
  failed = !(checks.control && checks.ended && checks.ran && checks.ledger)
  note(`${failed ? 'FAIL' : 'PASS'}: ${JSON.stringify(checks)}`)
} catch (error) {
  note(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(OUT, 'result.json'), JSON.stringify({ checks, passed: !failed }, null, 2))
  await writeFile(join(OUT, 'notes.txt'), notes.join('\n') + '\n', 'utf8')
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A long command, live.`, extra: notes.join('\n') })
  await rm(workspace, { recursive: true, force: true }).catch(() => {})
  process.exitCode = failed ? 1 : 0
}
