// Does Locust keep Codex current by itself -- and do the new models show up?
//
//   node _tools/drive-agents-kept-current.mjs [--packaged <exe>] [--tag <name>]
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
// ASK FIRST (0.303): Codex's update is a 159 MB download, and 0.302 started it
// by itself -- a beta tester's whole connection went, mid-call. So first the
// drive waits past the first look and checks NOTHING was downloaded: the row
// says a newer version is out and offers Update. Then it presses Update, the
// way a person would, and reads the result where a person would: the row, the
// scratch CLI's own version, and the model picker.

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, sleep, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const OUT = join(new URL('../docs/beta-fixes-2026-09-23/', import.meta.url).pathname.slice(1), `agents-kept-current-${tag}`)
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

  // Past the first look (45 s after launch): it has looked, and downloaded nothing.
  const read = async () => JSON.parse(String(await drive.evaluate(`(async () => {
    if (typeof window.desktop.readRuntimeUpdates !== 'function') return JSON.stringify({ missing: true })
    return JSON.stringify(await window.desktop.readRuntimeUpdates())
  })()`)))
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
  check('it looked, found 0.156.1, and is waiting for the person', waiting?.status.kind === 'waiting' && waiting.status.why === 'ask' && waiting.status.version === '0.156.1', JSON.stringify(waiting?.status ?? looked))
  const untouched = await scratchVersion()
  check('and downloaded nothing by itself', /0\.153\.0/.test(untouched), untouched)

  // Where a person would see it: the Codex row, with Update on it. Pressed.
  const offered = await drive.capture('Settings, the Codex row offering Update', () => drive.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Settings'))
    tab?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const page = [...document.querySelectorAll('button, a')].find((b) => /^Runtimes$/.test((b.textContent ?? '').trim()))
    page?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const codexRow = [...document.querySelectorAll('.lc-runtimerow')].find((r) => /Codex/.test(r.textContent ?? ''))
    return codexRow ? codexRow.innerText.replace(/\\s+/g, ' ').trim() : 'no Codex row'
  })()`))
  await shoot('01-update-offered.png')
  check('the Codex row says 0.156.1 is out and offers Update', /0\.156\.1 is out\./.test(String(offered)) && /Update/.test(String(offered)), String(offered))
  const pressed = await drive.evaluate(`(() => {
    const codexRow = [...document.querySelectorAll('.lc-runtimerow')].find((r) => /Codex/.test(r.textContent ?? ''))
    const button = [...(codexRow?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Update')
    button?.click()
    return button ? 'pressed' : 'no Update button'
  })()`)
  say(`Update: ${String(pressed)}`)

  let settled
  for (let waited = 0; waited < 300_000; waited += 3000) {
    await sleep(3000)
    settled = await read()
    const codex = (settled.agents ?? []).find((agent) => agent.runtime === 'codex')
    if (codex !== undefined && (codex.status.kind === 'updated' || codex.status.kind === 'failed')) break
  }
  const codex = (settled?.agents ?? []).find((agent) => agent.runtime === 'codex')
  check('pressed, it updated Codex', codex?.status.kind === 'updated' && codex.status.to === '0.156.1', JSON.stringify(codex?.status ?? settled))

  // The new models, in the picker.
  const models = await drive.capture('the model picker', () => drive.evaluate(`(async () => {
    document.querySelector('button[aria-label="Home"]')?.click()
    await new Promise((r) => setTimeout(r, 1500))
    for (let tries = 0; tries < 30; tries += 1) {
      const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
      if (control && document.querySelector('.lc-picker') === null) control.click()
      await new Promise((r) => setTimeout(r, 1000))
      const rows = [...document.querySelectorAll('.lc-picker__row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())
      if (rows.some((t) => /GPT-6-Sol/.test(t))) return JSON.stringify(rows.filter((t) => /GPT/.test(t)))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    return JSON.stringify([...document.querySelectorAll('.lc-picker__row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()).filter((t) => /GPT/.test(t)))
  })()`))
  await shoot('03-the-picker.png')
  const rows = JSON.parse(String(models))
  check('GPT-6-Sol and GPT-6-Luna are in the picker, without a restart', rows.some((t) => /GPT-6-Sol/.test(t)) && rows.some((t) => /GPT-6-Luna/.test(t)), JSON.stringify(rows))

  // The row, after.
  await sleep(1500)
  const row = await drive.capture('Settings, the runtimes', () => drive.evaluate(`(async () => {
    const tab = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') ?? '').startsWith('Settings'))
    tab?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const page = [...document.querySelectorAll('button, a')].find((b) => /^Runtimes$/.test((b.textContent ?? '').trim()))
    page?.click()
    await new Promise((r) => setTimeout(r, 1200))
    const codexRow = [...document.querySelectorAll('.lc-runtimerow')].find((r) => /Codex/.test(r.textContent ?? ''))
    return codexRow ? codexRow.innerText.replace(/\\s+/g, ' ').trim() : 'no Codex row'
  })()`))
  await shoot('02-the-codex-row.png')
  check("the Codex row says it was updated, and shows the new version", /Updated from 0\.153\.0 to 0\.156\.1/.test(String(row)) && /0\.156\.1/.test(String(row)), String(row))

  // The scratch CLI itself.
  const after = await scratchVersion()
  check("the scratch Codex is 0.156.1 now", /0\.156\.1/.test(after), after)

  const globalAfter = (await cmd(`"${GLOBAL_CODEX}" --version`)).out
  check("the machine's own Codex was not touched", /^codex-cli \d/.test(globalBefore) && globalAfter === globalBefore, `${globalBefore} -> ${globalAfter}`)
  say(failures === 0 ? '\nAGENTS KEPT CURRENT PASSED' : `\nAGENTS KEPT CURRENT: ${String(failures)} FAILED`)
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Codex CLI 0.153.0 in a scratch npm folder, the app left to keep it current on its own; then the Codex row, the CLI and the model picker read. Nothing sent, nothing spent.' })
}
