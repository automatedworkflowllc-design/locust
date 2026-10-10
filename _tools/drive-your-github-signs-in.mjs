// Your GitHub, on Settings > Connectors (0.720).
//
//   node _tools/drive-your-github-signs-in.mjs
//   ... --packaged apps/desktop/release/win-unpacked/Locust.exe      (the installed app)
//   ... --real      read the person's own gh account instead (read only)
//
// Colin, 2026-10-10, of t3code: "a legitimate github connector and their logo
// would be very cool". The card reads who the GitHub CLI is signed in as and
// signs in with `gh auth login --web`, showing gh's one-time code.
//
// By default gh is pointed at a THROWAWAY config folder (GH_CONFIG_DIR), so
// the card starts signed out, the sign-in is started for real -- gh asks
// GitHub for a code -- and then stopped. No code is entered anywhere and no
// browser is opened: "Copy code and open GitHub" is never pressed. The real
// gh config is checked before and after and must not change.
//
// With --real, gh is left as it is and the card must name the account gh
// itself names. Nothing is pressed but Check again.
//
// Spends nothing: no agent turn is sent.

import { execFile } from 'node:child_process'
import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const real = process.argv.includes('--real')

const throwaway = await mkdtemp(join(tmpdir(), 'locust-drive-gh-config-'))
const realConfig = process.env.GH_CONFIG_DIR ?? (process.platform === 'win32' ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'GitHub CLI') : join(homedir(), '.config', 'gh'))
/** Names, sizes and times of the real gh config's files: never their contents. */
const realState = async () => {
  try {
    const names = (await readdir(realConfig)).sort()
    return await Promise.all(names.map(async (name) => `${name} ${String((await stat(join(realConfig, name))).size)} ${String((await stat(join(realConfig, name))).mtimeMs)}`))
  } catch {
    return ['(none)']
  }
}
/** Who gh itself says is signed in, for --real. */
const ghLogin = () =>
  new Promise((resolvePromise) => {
    execFile('gh', ['auth', 'status', '--json', 'hosts', '--hostname', 'github.com'], { windowsHide: true }, (error, stdout) => {
      if (error) return resolvePromise(undefined)
      try {
        const hosts = JSON.parse(String(stdout)).hosts?.['github.com'] ?? []
        resolvePromise((hosts.find((one) => one.active) ?? hosts[0])?.login)
      } catch {
        resolvePromise(undefined)
      }
    })
  })

const realBefore = await realState()
const workspace = await scratchRepository('locust-drive-github-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `your-github-signs-in${real ? '-real' : ''}${packaged === undefined ? '' : '-packaged'}`,
  port: 9884,
  workspace,
  sendsNothing: true,
  env: real ? {} : { GH_CONFIG_DIR: throwaway },
  seed: {
    schemaVersion: 1,
    teammates: [],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const results = []
const check = (name, passed, detail) => {
  results.push({ name, passed, detail })
  say(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const cardScript = `(() => { const c = document.querySelector('.lc-github'); if (!c) return 'null'; return JSON.stringify({
  state: c.getAttribute('data-state'),
  mark: !!c.querySelector('svg.lc-githubmark path'),
  name: c.querySelector('.lc-github__name')?.innerText.trim(),
  line: c.querySelector('.lc-github__line')?.innerText.trim(),
  buttons: [...c.querySelectorAll('button')].map((b) => b.innerText.trim()),
  code: c.querySelector('.lc-github__digits')?.innerText.trim(),
  said: c.querySelector('.lc-github__said')?.innerText.trim()
}) })()`
const card = async (label) => JSON.parse(String(await drive.capture(label, () => drive.evaluate(cardScript))))
const press = (pattern) => `(() => {
  const button = [...document.querySelectorAll('.lc-github button')].find((b) => ${pattern}.test(b.innerText) && !b.disabled)
  if (!button) return 'no button ' + ${JSON.stringify(String(pattern))}
  button.click()
  return button.innerText.trim()
})()`

try {
  await drive.capture('launch', () => drive.ready())
  const headings = await drive.capture('open Settings > Connectors', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    const item = [...document.querySelectorAll('.lc-settings__navitem')].find(n => n.innerText.trim().startsWith('Connectors'))
    if (!item) return 'no Connectors page'
    item.click()
    await new Promise(r => setTimeout(r, 700))
    return [...document.querySelectorAll('.lc-settings__pane .lc-settings__heading')].map(h => h.innerText.trim()).join(' | ')
  })()`))
  check('GitHub is the first thing on the Connectors page', String(headings).startsWith('GitHub'), String(headings))
  await drive.waitFor(`(() => { const c = document.querySelector('.lc-github'); return c && c.getAttribute('data-state') !== 'reading' })()`, { timeoutMs: 30_000, what: 'gh to answer' })
  const first = await card('the card, once gh has answered')
  check('it wears GitHub’s mark', first.mark === true)

  if (real) {
    const login = await ghLogin()
    check('it names the account gh itself names', login !== undefined && first.name === login && first.line === `Signed in as ${login}. Teammates push and open pull requests as you.`, `${String(first.name)} / gh: ${String(login)}`)
    check('it offers Open on GitHub, not a sign-in', first.buttons.includes('Open on GitHub') && !first.buttons.some((b) => /Sign in/.test(b)), first.buttons.join(', '))
    await drive.capture('Check again', () => drive.evaluate(press('/Check again/')))
    await drive.waitFor(`(() => document.querySelector('.lc-github')?.getAttribute('data-state') === 'signed-in')()`, { timeoutMs: 30_000, what: 'gh to answer again' })
    check('Check again asks gh again and still names it', (await card('after Check again')).name === login)
  } else {
    check('a gh with nobody signed in reads as signed out, with a sign-in', first.state === 'signed-out' && first.buttons.includes('Sign in with GitHub'), `${first.state}: ${first.line}`)
    await drive.capture('Sign in with GitHub', () => drive.evaluate(press('/Sign in with GitHub/')))
    await drive.waitFor(`(() => !!document.querySelector('.lc-github__digits'))()`, { timeoutMs: 45_000, what: 'gh to print its one-time code' })
    const waiting = await card('the one-time code, while it waits')
    check('gh’s one-time code is shown, with a way to copy it and a way to stop', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(waiting.code ?? '') && waiting.buttons.includes('Copy code and open GitHub') && waiting.buttons.includes('Stop'), `${waiting.code === undefined ? 'no code' : 'a code'}; ${waiting.buttons.join(', ')}`)
    check('it says it is waiting for GitHub', waiting.state === 'signing-in' && waiting.line === 'Waiting for GitHub to say yes.', waiting.line)
    await drive.capture('Stop', () => drive.evaluate(press('/^Stop$/')))
    await drive.waitFor(`(() => document.querySelector('.lc-github')?.getAttribute('data-state') !== 'signing-in')()`, { timeoutMs: 15_000, what: 'the sign-in to stop' })
    const stopped = await card('after Stop')
    check('Stop ends it, says so, and offers the sign-in again', stopped.said === 'Sign-in stopped.' && stopped.buttons.includes('Sign in with GitHub') && stopped.code === undefined, `${String(stopped.said)}; ${stopped.buttons.join(', ')}`)
    const files = await readdir(throwaway)
    check('nothing was signed in to the throwaway gh', !files.includes('hosts.yml'), files.join(', ') || 'empty')
  }

  // Settings search finds it by the words a person types.
  const found = await drive.capture('search Settings for "pull request"', () => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-settings input[type="search"], .lc-settings__search input, input[placeholder*="Search" i]')
    if (!box) return 'no search box'
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, 'pull request')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 400))
    return document.querySelector('.lc-settings__nav, .lc-settings')?.innerText.slice(0, 600)
  })()`))
  check('a search for "pull request" finds GitHub', /GitHub/.test(String(found)), String(found).replace(/\s+/g, ' ').slice(0, 200))
} catch (error) {
  check('the drive ran to the end', false, String(error?.stack ?? error))
} finally {
  await sleep(500)
  const realAfter = await realState()
  check('the real gh config did not change', JSON.stringify(realBefore) === JSON.stringify(realAfter), realAfter.join(' ; '))
  const failed = results.filter((one) => !one.passed)
  await drive.finish({
    intro: `Your GitHub on Settings > Connectors (0.720)${real ? ', read from the person’s own gh' : ', with gh pointed at a throwaway config'}. Spends nothing.`,
    extra: [
      `${String(results.length - failed.length)}/${String(results.length)} checks passed.`,
      '',
      ...results.map((one) => `- ${one.passed ? 'PASS' : 'FAIL'} ${one.name}${one.detail === undefined ? '' : ` -- ${String(one.detail).slice(0, 300)}`}`)
    ].join('\n')
  })
  process.exitCode = failed.length === 0 ? 0 : 1
}
