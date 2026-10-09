// Does Locust keep Codex current by itself -- and do the new models show up?
//
//   node _tools/drive-agents-kept-current.mjs [--packaged <exe>] [--tag <name>] [--ask]
//
// Colin, 2026-09-23: "new gpt-6 models released we need those added", then
// "is there a way to make it so the models will automatically update without
// messing up load times or interfering with the app". Codex CLI 0.153.0 lists
// GPT-6-Astra; 0.156.1 adds GPT-6-Sol and GPT-6-Luna.
//
// This installs Codex CLI 0.153.0 into a scratch npm folder of its own and
// launches the app with that folder first on its PATH and as npm's prefix, so
// what Locust finds, updates and re-reads is the scratch copy -- the machine's
// own Codex is read before and after, and must not move. A scripted launch
// never updates an agent (mayUpdateAgents); LOCUST_UPDATE_AGENTS=1 lets this
// one. Nothing is sent; nothing is spent.
//
// By default it updates on its own (0.304, as 0.302 did): the drive waits for
// the update to land by itself. With --ask, updating on its own is switched
// off first (0.303's ask-first, now a choice): the drive waits past the first
// look, checks NOTHING was downloaded and that the row offers Update, and
// presses it. Either way it then reads the result where a person would: the
// row, the scratch CLI's own version, and the model picker.

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, sleep, scratchRepository, startDrive, recordRoot } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const ASK = process.argv.includes('--ask')
const tag = arg('--tag') ?? `${packaged === undefined ? 'local' : 'packaged'}${ASK ? '-ask' : ''}`
const OUT = join(recordRoot('beta-fixes-2026-09-23'), `agents-kept-current-${tag}`)
await mkdir(OUT, { recursive: true })

// One line through cmd.exe, passed as written: Node would otherwise escape
// the quotes round a path (\"C:\...\") and cmd would read them as part of it.
const cmd = (line, env = process.env, timeoutMs = 300_000) =>
  new Promise((resolve) => {
    execFile(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { env, windowsHide: true, windowsVerbatimArguments: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: error === null, out: `${stdout}${stderr}`.trim() })
    })
  })

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

// The machine's own Codex, before anything.
const GLOBAL_CODEX = join(process.env.APPDATA ?? '', 'npm', 'codex.cmd')
const globalBefore = (await cmd(`"${GLOBAL_CODEX}" --version`)).out
say(`the machine's own Codex: ${globalBefore}`)

// A scratch npm folder with Codex 0.153.0 in it.
const prefix = await mkdtemp(join(tmpdir(), 'locust-kept-current-npm-'))
const scratchEnv = { ...process.env, npm_config_prefix: prefix }
say(`installing Codex CLI 0.153.0 into ${prefix} ...`)
const installed = await cmd('npm install -g @openai/codex@0.153.0 --no-audit --no-fund', scratchEnv, 600_000)
if (!installed.ok) {
  say(installed.out.slice(-800))
  throw new Error('could not install Codex 0.153.0 into the scratch folder')
}
const scratchVersion = async () => (await cmd(`"${join(prefix, 'codex.cmd')}" --version`)).out
say(`scratch Codex: ${await scratchVersion()}`)

// Where Locust should land: npm's latest Codex on the day -- 0.156.1 when this
// was written, 0.157.1 by 0.367's sweep -- not a number fixed in the drive.
const LATEST = (await cmd('npm view @openai/codex@latest version', process.env, 120_000)).out.split(/\r?\n/).pop()?.trim() ?? ''
if (!/^\d+\.\d+\.\d+$/.test(LATEST)) throw new Error(`could not read npm's latest Codex: ${LATEST}`)
say(`npm's latest Codex: ${LATEST}`)
// A release under 12 hours old is not taken (runtime-updates.ts RELEASE_AGE_MS): on such a day the right answer is
// to wait and download nothing, and that is what is checked (2026-10-08: Codex 0.162.0 was hours old; this read red).
const published = await (async () => {
  try {
    return Date.parse(JSON.parse((await cmd('npm view @openai/codex time --json', process.env, 120_000)).out)[LATEST])
  } catch {
    return Number.NaN
  }
})()
const TOO_NEW = Number.isFinite(published) && Date.now() - published < 12 * 60 * 60 * 1000
if (TOO_NEW) say(`  ${LATEST} came out ${String(Math.round((Date.now() - published) / 3_600_000))} h ago: Locust should wait, and download nothing`)
/** Ends the drive early, on purpose: a release held back leaves nothing after it to read. */
const HELD_BACK = new Error('held back')

const workspace = await scratchRepository('locust-kept-current-ws-')
const drive = await startDrive({
  name: `agents-kept-current-${tag}`,
  port: 9455,
  workspace,
  outPath: OUT,
  sendsNothing: true,
  ...(packaged === undefined ? {} : { packaged }),
  env: { PATH: `${prefix};${process.env.PATH ?? ''}`, npm_config_prefix: prefix, LOCUST_UPDATE_AGENTS: '1' },
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

const shoot = async (file) => {
  const shot = await drive.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.result?.data) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(OUT, file), Buffer.from(shot.result.data, 'base64'))
  }
}

try {
  await drive.ready()
  await drive.resize(1215, 800)

  // A read can come back empty while the main process is still busy on its
  // first look (0.303's control, 2026-09-24: "undefined" after the route was
  // read); retried, and said, rather than ending the drive.
  const read = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const raw = await drive.evaluate(`(async () => {
        if (typeof window.desktop.readRuntimeUpdates !== 'function') return JSON.stringify({ missing: true })
        return JSON.stringify(await window.desktop.readRuntimeUpdates()) ?? 'null'
      })()`)
      if (typeof raw === 'string' && raw !== 'null') return JSON.parse(raw)
      say(`  (the updates read came back ${JSON.stringify(raw)}; again)`)
      await sleep(2000)
    }
    return { unreadable: true }
  }
  const settle = async (limitMs) => {
    let settled
    for (let waited = 0; waited < limitMs; waited += 3000) {
      await sleep(3000)
      settled = await read()
      if (settled.missing) break
      const codex = (settled.agents ?? []).find((agent) => agent.runtime === 'codex')
      if (codex !== undefined && (codex.status.kind === 'updated' || codex.status.kind === 'failed')) break
      if (TOO_NEW && codex?.status.kind === 'waiting' && codex.status.why === 'too new') break
    }
    return settled
  }
  if (TOO_NEW) {
    const held = await settle(180_000)
    const codex = (held?.agents ?? []).find((agent) => agent.runtime === 'codex')
    check(`it found ${LATEST}, too new to take, and is waiting`, codex?.status.kind === 'waiting' && codex.status.why === 'too new' && codex.status.version === LATEST, JSON.stringify(codex?.status ?? held))
    const untouched = await scratchVersion()
    check('and downloaded nothing', /0\.153\.0/.test(untouched), untouched)
    const globalAfter = (await cmd(`"${GLOBAL_CODEX}" --version`)).out
    check("the machine's own Codex was not touched", /^codex-cli \d/.test(globalBefore) && globalAfter === globalBefore, `${globalBefore} -> ${globalAfter}`)
    say(failures === 0 ? '\nAGENTS KEPT CURRENT PASSED (held back: the release is under 12 hours old)' : `\nAGENTS KEPT CURRENT: ${String(failures)} FAILED`)
    throw HELD_BACK
  }
  if (!ASK) {
    // It updates on its own: the first look is 45 s after launch.
    const settled = await settle(360_000)
    const codex = (settled?.agents ?? []).find((agent) => agent.runtime === 'codex')
    check('Locust updated Codex by itself', codex?.status.kind === 'updated' && codex.status.to === LATEST, JSON.stringify(codex?.status ?? settled))
  } else {
    await drive.evaluate(`window.desktop.setRuntimeUpdates(false)`)
    // Past the first look (45 s after launch): it has looked, and downloaded nothing.
    let looked
    for (let waited = 0; waited < 120_000; waited += 3000) {
      await sleep(3000)
      looked = await read()
      if (looked.missing || (looked.agents ?? []).some((agent) => agent.runtime === 'codex')) break
    }
    await sleep(15_000)
    looked = await read()
    say(`after the first look: ${JSON.stringify(looked)}`)
    const waiting = (looked.agents ?? []).find((agent) => agent.runtime === 'codex')
    check(`it looked, found ${LATEST}, and is waiting for the person`, waiting?.status.kind === 'waiting' && waiting.status.why === 'ask' && waiting.status.version === LATEST, JSON.stringify(waiting?.status ?? looked))
    const untouched = await scratchVersion()
    check('and downloaded nothing by itself', /0\.153\.0/.test(untouched), untouched)

    // Where a person would see it: the Codex row, with Update on it. Pressed.
    const offered = await drive.capture('Settings, the Codex row offering Update', () => drive.evaluate(`(async () => {
      const tab = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Settings'))
      tab?.click()
      await new Promise((r) => setTimeout(r, 1200))
      const page = [...document.querySelectorAll('button, a')].find((b) => /^(AI agents|Runtimes)$/.test((b.textContent ?? '').trim()))
      page?.click()
      await new Promise((r) => setTimeout(r, 1200))
      const codexRow = [...document.querySelectorAll('.lc-runtimerow')].find((r) => /Codex/.test(r.textContent ?? ''))
      return codexRow ? codexRow.innerText.replace(/\\s+/g, ' ').trim() : 'no Codex row'
    })()`))
    await shoot('01-update-offered.png')
    check(`the Codex row says ${LATEST} is out and offers Update`, String(offered).includes(`${LATEST} is out.`) && /Update/.test(String(offered)), String(offered))
    const pressed = await drive.evaluate(`(() => {
      const codexRow = [...document.querySelectorAll('.lc-runtimerow')].find((r) => /Codex/.test(r.textContent ?? ''))
      const button = [...(codexRow?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Update')
      button?.click()
      return button ? 'pressed' : 'no Update button'
    })()`)
    say(`Update: ${String(pressed)}`)

    const settled = await settle(300_000)
    const codex = (settled?.agents ?? []).find((agent) => agent.runtime === 'codex')
    check('pressed, it updated Codex', codex?.status.kind === 'updated' && codex.status.to === LATEST, JSON.stringify(codex?.status ?? settled))
  }

  // The new models, in the picker.
  const models = await drive.capture('the model picker', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Home"]')?.click()
    await new Promise((r) => setTimeout(r, 1500))
    for (let tries = 0; tries < 30; tries += 1) {
      const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
      if (control && document.querySelector('.lc-picker') === null) control.click()
      await new Promise((r) => setTimeout(r, 1000))
      // Searched for, as a person would: the picker opens on the box's own runtime (Claude here), and Codex's rows
      // further down are not all drawn until they are scrolled to or searched for (2026-10-06: none were read).
      const search = document.querySelector('.lc-picker__input')
      if (search && search.value !== 'GPT-6') {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'GPT-6')
        search.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 600))
      }
      const rows = [...document.querySelectorAll('.lc-picker__row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())
      if (rows.some((t) => /GPT-6-Sol/.test(t))) return JSON.stringify(rows.filter((t) => /GPT/.test(t)))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    return JSON.stringify([...document.querySelectorAll('.lc-picker__row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).filter((t) => /GPT/.test(t)))
  })()`))
  await shoot('03-the-picker.png')
  // An empty answer (a read that timed out) is no rows, not the end of the drive.
  const rows = (() => {
    try {
      return JSON.parse(String(models))
    } catch {
      return []
    }
  })()
  check('GPT-6-Sol and GPT-6-Luna are in the picker, without a restart', rows.some((t) => /GPT-6-Sol/.test(t)) && rows.some((t) => /GPT-6-Luna/.test(t)), JSON.stringify(rows))

  // The row, after.
  await sleep(1500)
  const row = await drive.capture('Settings, the runtimes', () => drive.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Settings'))
    tab?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const page = [...document.querySelectorAll('button, a')].find((b) => /^(AI agents|Runtimes)$/.test((b.textContent ?? '').trim()))
    page?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const codexRow = [...document.querySelectorAll('.lc-runtimerow')].find((r) => /Codex/.test(r.textContent ?? ''))
    return codexRow ? codexRow.innerText.replace(/\\s+/g, ' ').trim() : 'no Codex row'
  })()`))
  await shoot('02-the-codex-row.png')
  check("the Codex row says it was updated, and shows the new version", String(row).includes(`Updated from 0.153.0 to ${LATEST}`), String(row))
  // The switch, as a person sees it: on unless they turned it off.
  const onItsOwn = await drive.evaluate(`(() => {
    const toggle = document.querySelector('button[role="switch"][aria-label="Update Codex CLI and Copilot CLI on their own"]')
    const note = toggle?.closest('.lc-settingrow')?.querySelector('.lc-settings__note')?.textContent ?? ''
    return JSON.stringify({ checked: toggle?.getAttribute('aria-checked') ?? 'no switch', note })
  })()`)
  const toggle = (() => {
    try {
      return JSON.parse(String(onItsOwn))
    } catch {
      return { checked: 'unreadable', note: '' }
    }
  })()
  check(ASK ? 'the switch reads off: updating when you press Update' : 'the switch reads on: updating on their own', ASK ? toggle.checked === 'false' && /^Updating when you press Update/.test(toggle.note) : toggle.checked === 'true' && /^Updating on their own/.test(toggle.note), String(onItsOwn))

  // The scratch CLI itself.
  const after = await scratchVersion()
  check(`the scratch Codex is ${LATEST} now`, after.includes(LATEST), after)

  const globalAfter = (await cmd(`"${GLOBAL_CODEX}" --version`)).out
  check("the machine's own Codex was not touched", /^codex-cli \d/.test(globalBefore) && globalAfter === globalBefore, `${globalBefore} -> ${globalAfter}`)
  say(failures === 0 ? '\nAGENTS KEPT CURRENT PASSED' : `\nAGENTS KEPT CURRENT: ${String(failures)} FAILED`)
} catch (error) {
  if (error !== HELD_BACK) say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Codex CLI 0.153.0 in a scratch npm folder, the app left to keep it current on its own; then the Codex row, the CLI and the model picker read. Nothing sent, nothing spent.' })
}
