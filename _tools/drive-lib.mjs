// The shared half of every "drive the app like a person" script.
//
// A drive is not a smoke: nothing here asserts. It launches the BUILT app
// on a throwaway profile, does what a person does, and keeps what the
// screen showed at each step -- the text, a screenshot, and the renderer's
// error count -- under docs/user-session/<stamp>-<name>/. The judging is
// done afterwards by reading the record (Colin, 2026-09-05: "start taking
// screenshots when you drive the app and test so you can get a user
// experience"), so a hitch is a thing that was seen, not a thing the script
// was told to look for.
//
// Every drive picks its own debugging port and refuses to start when that
// port already answers: two drives on one port both bind it, and the second
// silently drives the first app.

// FIRST, for its side effect: it points tmpdir() outside AppData, which is
// where `~/.cursorignore` makes every Cursor run blind. See the file.
import './scratch-root.mjs'

import { spawn, execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const APP_DIR = new URL('../apps/desktop/', import.meta.url).pathname.slice(1)
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const NPM_DIR = 'C:\\Users\\<home>\\AppData\\Roaming\\npm'
export const FREE_ROUTE = { runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', mode: 'accept-edits' }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const say = (line) => console.error(line)
export const git = (args, cwd) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, windowsHide: true }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
})

/**
 * A scratch git repository with a README and a LOCUST.md, committed.
 *
 * `brief` is that LOCUST.md, and Locust carries it to EVERY teammate started
 * in this folder -- it is not decoration. The default says only what the
 * folder is.
 *
 * It USED to say "Keep answers to one paragraph." That was there to keep
 * drive output short, and it kept confounding the drives instead: the cap
 * probe asked eight teammates to count to 250 and watched them answer "Your
 * 1-to-250 count conflicts with the one-paragraph rule" (2026-09-09); the
 * measure probe asked for three paragraphs and got a decision card asking
 * which instruction to follow (2026-09-10). Colin, the same day: "remove the
 * portion of keeps answers to one paragraph, thats a bit arbitrary." A
 * fixture that argues with the prompt is a silent confound, and one that
 * argues with the prompt by DEFAULT is a confound in every drive at once. A
 * drive that wants short answers can ask for them in its own prompt.
 */
export async function scratchRepository(prefix = 'locust-drive-ws-', brief = 'A scratch project for a user session.\n') {
  const workspace = await mkdtemp(join(tmpdir(), prefix))
  await git(['init', '-q', '-b', 'main'], workspace)
  await git(['config', 'user.email', 'drive@locust.test'], workspace)
  await git(['config', 'user.name', 'Locust drive'], workspace)
  await writeFile(join(workspace, 'README.md'), '# scratch\n\nA scratch project for a user session.\n', 'utf8')
  await writeFile(join(workspace, 'LOCUST.md'), brief, 'utf8')
  await git(['add', '.'], workspace)
  await git(['commit', '-q', '-m', 'first'], workspace)
  return workspace
}

/**
 * Launch the app and hand back the step recorder.
 *
 * `seed` is the teammates.json to start from (undefined = a fresh profile
 * and the first-launch screen). `env` is merged over the process
 * environment. `keep` leaves the profile and workspace on disk afterwards.
 */
/**
 * Drives that spend a PAID account, and therefore do not run by default.
 *
 * Colin, 2026-09-08: "u r why we have zero codex usage, why we cn run zero
 * tests on astra -- cause ur asking it to say pineapple." He is right. These
 * drives run on `codex / account-default`, which is his own Codex quota, and
 * they were being run dozens of times a night on one-word prompts to check a
 * button. The quota that paid for it was the quota an outside QA pass needed.
 *
 * A drive that spends real money is now opt-in: set LOCUST_SPEND=1 to allow
 * it. Everything else must run on a free model. This is a gate rather than a
 * note in a comment because a note does not stop anything.
 */
export function assertMaySpend(name) {
  if (process.env.LOCUST_SPEND === '1') return
  say(`refusing to run "${name}": it spends a paid account.`)
  say('This drive uses a real account quota. Re-run with LOCUST_SPEND=1 if you mean to spend it.')
  process.exit(1)
}

export async function startDrive({ name, port, workspace, seed, files = {}, env = {}, keep = false, profilePath, outPath, stepFrom = 0, spends = false, packaged }) {
  if (spends) assertMaySpend(name)
  try {
    const already = await fetch(`http://127.0.0.1:${String(port)}/json/list`, { signal: AbortSignal.timeout(1500) })
    if (already.ok) { say(`something is already debugging on port ${String(port)}`); process.exit(1) }
  } catch { /* free */ }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  // A relaunch on the same profile (a scheduled routine after a quit) keeps
  // writing into the same record, numbering its steps after the first run's.
  const out = outPath ?? join(new URL('../docs/user-session/', import.meta.url).pathname.slice(1), `${stamp}-${name}`)
  await mkdir(out, { recursive: true })
  const profile = profilePath ?? await mkdtemp(join(tmpdir(), `locust-drive-${name}-`))
  if (seed !== undefined) {
    // The seed used to be skipped whenever a drive supplied its own
    // `profilePath` -- the two options were written for different reasons and
    // nobody had used them together. The result was silent: the app launched
    // with an EMPTY roster and the drive read that as the product's own
    // behaviour. Two drives on 2026-09-07 lost time to it, one of them
    // concluding the compact avatar rail was unimplemented when the rail had
    // simply been given nobody to draw.
    //
    // A drive must be able to assert its own premise, so the seed is written
    // wherever the profile is, and a profile that cannot take it says so
    // rather than starting a run whose setup is not what the script says.
    await mkdir(join(profile, 'mission-ledger'), { recursive: true }).catch(() => undefined)
    await writeFile(join(profile, 'teammates.json'), JSON.stringify(seed), 'utf8')
    const written = JSON.parse(await readFile(join(profile, 'teammates.json'), 'utf8'))
    const wanted = seed.teammates?.length ?? 0
    if ((written.teammates?.length ?? 0) !== wanted) {
      say(`seed did not land: wanted ${String(wanted)} teammates`)
      process.exit(1)
    }
    // NOTE: this proves the file was WRITTEN, nothing more -- it reads back
    // what it just wrote and compares it to itself, so it can only catch a
    // disk failure. Whether the APP accepts those records is a different
    // question and is checked after launch, in `ready`.
  }
  // Other profile files a drive wants in place BEFORE the app reads them
  // (memories.json, rooms.json, routines.json): written before launch, so
  // nothing the app writes at boot can race them.
  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(profile, file), typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  }
  /*
   * The dev build by default, the PACKAGED binary when asked.
   *
   * `app.isPackaged` is false under `electron .`, so the version line, the
   * window title and the update section all read differently from what a
   * person who ran the installer sees. A drive that walks the ordinary path
   * has to walk it through the same bytes the installer lays down, or it is
   * reading a screen nobody has.
   *
   * Same profile handling, same capture machinery, same everything else --
   * only the argv differs, because the packaged exe IS the app and takes no
   * directory argument.
   */
  const launch = packaged === undefined ? [ELECTRON, [APP_DIR]] : [packaged, []]
  const child = spawn(launch[0], [...launch[1], `--remote-debugging-port=${String(port)}`, `--user-data-dir=${profile}`], {
    cwd: workspace,
    env: { ...process.env, PATH: `${NPM_DIR};${process.env.PATH ?? ''}`, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const appOutput = []
  child.stdout.on('data', (d) => appOutput.push(String(d)))
  child.stderr.on('data', (d) => appOutput.push(String(d)))
  const record = []
  let step = stepFrom

  let page
  for (let i = 0; i < 80 && page === undefined; i += 1) {
    await sleep(500)
    if (child.exitCode !== null) throw new Error(`app exited ${String(child.exitCode)}\n${appOutput.join('').slice(-800)}`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch { /* not up */ }
  }
  if (page === undefined) { try { child.kill() } catch { /* gone */ } throw new Error('renderer never came up') }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', rej, { once: true }) })
  let id = 0
  const pending = new Map()
  const consoleErrors = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params?.exceptionDetails?.text ?? 'exception')
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') consoleErrors.push(String(message.params.args?.[0]?.value ?? 'console.error'))
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter(message) }
  })
  const send = (method, params = {}) => new Promise((resolve_) => {
    const next = ++id
    const gaveUp = setTimeout(() => { if (pending.delete(next)) resolve_(undefined) }, 400_000)
    pending.set(next, (message) => { clearTimeout(gaveUp); resolve_(message) })
    socket.send(JSON.stringify({ id: next, method, params }))
  })
  const evaluate = async (expression) => {
    let message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    // Right after launch the page can still be finishing its first
    // navigation, and an evaluate that lands in the old context dies with
    // "Execution context was destroyed". Seen at the first step of several
    // smokes on 2026-09-05; the app itself never reloads. One retry.
    if (/Execution context was destroyed/.test(String(message?.error?.message ?? ''))) {
      await sleep(1500)
      message = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    }
    const thrown = message?.result?.exceptionDetails
    if (thrown !== undefined) say(`  eval threw: ${thrown.exception?.description ?? ''}`.slice(0, 200))
    return message?.result?.result?.value
  }
  await send('Runtime.enable')

  /** One step: do it, then keep the screen's text and picture. */
  const capture = async (title, action) => {
    step += 1
    let note
    try {
      note = await action()
    } catch (error) {
      note = `threw: ${error instanceof Error ? error.message : String(error)}`
    }
    await sleep(600)
    const text = await evaluate(`document.body.innerText`)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const file = `${String(step).padStart(2, '0')}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    if (shot?.result?.data) await writeFile(join(out, `${file}.png`), Buffer.from(shot.result.data, 'base64'))
    await writeFile(join(out, `${file}.txt`), String(text ?? ''), 'utf8')
    const errors = consoleErrors.splice(0)
    // A COUNT of renderer errors is not actionable. This drive reported "2"
    // on a step and the two sentences existed nowhere on disk, so the only
    // way to read them was to spend another run (2026-09-11).
    if (errors.length > 0) await writeFile(join(out, `${file}.errors.txt`), errors.map(String).join('\n'), 'utf8')
    record.push({ step, title, note: note ?? '', errors })
    say(`${String(step).padStart(2, '0')}. ${title}${note ? ` -- ${String(note).slice(0, 160)}` : ''}`)
    return note
  }

  /** Wait until discovery has finished, so the first step is the real first screen. */
  const ready = async () => {
    const settled = await evaluate(`(async () => {
      for (let i = 0; i < 240; i += 1) {
        const field = document.querySelector('form.command-dock textarea')
        if (field && !/Checking local runtimes/.test(field.placeholder)) break
        await new Promise(r => setTimeout(r, 250))
        if (i === 239) return 'discovery never finished'
      }
      /*
       * And then until the COUNT stops moving.
       *
       * The placeholder changes when the first runtime is ready, not when the
       * sweep is done, and the composer's route is still settling behind it.
       * A probe that sent at that moment started its mission on whichever
       * runtime happened to be ready first: measured 2026-09-10, a teammate
       * routed to Codex CLI ran on OpenCode and failed with "OpenCode is not
       * ready", with the footer still reading "4 runtimes connected". The
       * drive reported it as the teammate saying nothing.
       */
      let seen = ''
      let stable = 0
      for (let i = 0; i < 240; i += 1) {
        const now = document.querySelector('.lc-connected')?.innerText ?? ''
        stable = now === seen ? stable + 1 : 0
        seen = now
        // Six quarter-seconds of no change: long enough that a sweep still
        // arriving is caught, short enough not to pad every drive.
        if (stable >= 6) return 'discovery finished; ' + seen
        await new Promise(r => setTimeout(r, 250))
      }
      return 'discovery never settled; ' + seen
    })()`)

    /*
     * Did the app ACCEPT the roster it was seeded with?
     *
     * The write-back check above cannot answer this: it compares the file to
     * itself. The app parses each record on load and DROPS any it cannot read
     * -- a hue outside `lime|blue|violet|clay`, a role outside its own list --
     * and says so only to the main-process console, which nothing here reads.
     *
     * So a drive seeded with three teammates could run with one, address two
     * chips that were never drawn, and report the results as though its own
     * premise had held. That cost a session an hour in 0.36.3, was written up,
     * and then cost another one today: `sky` and `amber` are not hues and
     * `Tests & Review` is not a role, so two of three teammates were dropped
     * and a twenty-minute drive measured the wrong thing.
     *
     * A drive must be able to assert its own premise. This is that assertion.
     */
    if (seed?.teammates?.length) {
      const names = seed.teammates.map((member) => member.name)
      const drawn = JSON.parse(await evaluate(`JSON.stringify(
        [...document.querySelectorAll('button')]
          .map((b) => b.getAttribute('title') ?? '')
          .filter((t) => t.startsWith('Message '))
          .map((t) => t.slice('Message '.length).split(' ')[0])
      )`))
      const missing = names.filter((name) => !drawn.includes(name))
      if (missing.length > 0) {
        say(`the app did not accept ${String(missing.length)} seeded teammate(s): ${missing.join(', ')}`)
        say('a record is dropped when its hue or role is not one the roster knows.')
        say(`hues: lime, blue, violet, clay -- roles: Code & Migrations, Research & Briefs, Ops & Scheduling, Docs & QA, Data & Reporting, Custom`)
        process.exit(1)
      }
    }
    return settled
  }

  /** Write SESSION.md with the step table and close the app. */
  const finish = async ({ intro, extra = '', last = true }) => {
    const rows = record.map((r) => `| ${String(r.step)} | ${r.title} | ${String(r.note).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 220)} | ${r.errors.length === 0 ? '0' : `${String(r.errors.length)} — ${String(r.errors[0]).replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 120)}`} |`)
    const session = join(out, 'SESSION.md')
    const { readFile } = await import('node:fs/promises')
    const existing = await readFile(session, 'utf8').catch(() => undefined)
    const table = ['| # | Step | What was seen | Renderer errors |', '|---|---|---|---|', ...rows]
    const tail = last ? ['', extra, '## Judgement', '', '(filled in after reading the captures)', ''] : ['']
    const body = existing === undefined
      ? [`# User session ${stamp} — ${name}`, '', intro, '', ...table, ...tail]
      : [existing.replace(/\n## Judgement[\s\S]*$/, '\n'), `## Continued: ${intro}`, '', ...table, ...tail]
    await writeFile(session, body.join('\n'), 'utf8')
    /*
     * What the MAIN process said, kept beside the screenshots.
     *
     * A drive could read the renderer and the disk but never the host's own
     * words, so a relay that refused to start a run was invisible: the screen
     * showed a room with two answers and no argument, and the only place the
     * reason existed was a stream nobody wrote down (2026-09-11).
     */
    await writeFile(join(out, 'main.log'), appOutput.join(''), 'utf8').catch(() => undefined)
    try { socket.close() } catch { /* gone */ }
    try { child.kill() } catch { /* gone */ }
    await sleep(1500)
    if (!keep && last) await rm(profile, { recursive: true, force: true }).catch(() => undefined)
    if (last) say(`\nrecord: ${out}`)
    return { out, profile, step }
  }

  /**
   * Resize the window, so a claim about how the layout answers the window can
   * be measured at more than one size rather than asserted at one.
   *
   * `Emulation.setDeviceMetricsOverride` is what CDP gives a page; the OS
   * window around it does not move, which is fine -- everything measured here
   * is inside the page.
   */
  const resize = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    })
    return { width, height }
  }

  return { evaluate, send, capture, ready, finish, profile, out, record, resize }
}

/**
 * Pick a route from the composer's picker the way a person does: open it,
 * type a search, click the first enabled row under the runtime's group.
 * Returns what the controls read afterwards, or why nothing was picked.
 */
export function pickRouteScript({ group, search, row }) {
  return `(async () => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    if (!control) return 'no route control'
    if (control.disabled) return 'route control disabled'
    /*
     * Open it only if it is CLOSED. This used to click unconditionally, which
     * on an already-open picker closes it -- and the selection then does not
     * apply, while the helper still returns its success line naming whatever
     * route was there before.
     *
     * Measured 2026-09-09, both builds: called as the first thing to touch the
     * picker it moves the chip Codex -> OpenCode -> Cursor first try; called
     * after anything else had opened the picker, it reported success and left
     * the chip untouched. That difference cost two walkthroughs and a false
     * alarm about sixty drives being in doubt -- they were not, because they
     * all happen to call this first.
     *
     * One line, so no drive has to know that rule.
     */
    if (!document.querySelector('.lc-picker')) control.click()
    let target
    let notice = null
    for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
      const picker = document.querySelector('.lc-picker')
      if (!picker) { control.click(); await new Promise(r => setTimeout(r, 500)); continue }
      notice = picker.querySelector('.lc-picker__notice')?.innerText ?? null
      const box = picker.querySelector('.lc-picker__input')
      if (box && ${JSON.stringify(search ?? '')}) {
        const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setInput.call(box, ${JSON.stringify(search ?? '')})
        box.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise(r => setTimeout(r, 500))
      }
      let current = ''
      for (const node of picker.querySelector('.lc-picker__list').children) {
        const header = node.querySelector('.lc-picker__group')
        if (header) current = header.innerText
        const candidate = node.querySelector('.lc-picker__row')
        if (candidate && !candidate.disabled && ${group}.test(current) && ${row ?? '/./'}.test(candidate.innerText)) { target = candidate; break }
      }
      if (!target) await new Promise(r => setTimeout(r, 500))
    }
    if (!target) return 'no matching route; rows: ' + [...document.querySelectorAll('.lc-picker__row')].map(r => r.innerText.replace(/\\s+/g, ' ')).slice(0, 6).join(' | ')
    target.click()
    await new Promise(r => setTimeout(r, 500))
    return (notice ? 'picker said: ' + notice + ' || ' : '') + [...document.querySelectorAll('.lc-control')].map(c => c.innerText.replace(/\\s+/g, ' ').trim()).filter(Boolean).join(' · ')
  })()`
}

/** Type a message, press send, and wait for the run to end (or not, within the bound). */
export function sendAndWaitScript(text, { waitSeconds = 360, settle = true } = {}) {
  return `(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify(text)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    let sent = false
    for (let i = 0; i < 120 && !sent; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Start mission"]')
      if (button && !button.disabled) { button.click(); sent = true }
    }
    if (!sent) return 'no send'
    if (!${settle ? 'true' : 'false'}) return 'sent'
    for (let i = 0; i < ${String(waitSeconds * 2)}; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 800))
    return 'finished: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-300) ?? '')
  })()`
}
