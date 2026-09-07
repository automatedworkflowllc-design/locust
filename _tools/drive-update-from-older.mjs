// Does an older install actually see the new one?
//
//   1. set apps/desktop/package.json to an OLDER version
//   2. pnpm build && pnpm --filter @teammate/desktop package
//   3. node _tools/drive-update-from-older.mjs
//   4. put the version back and repackage
//
// Every release so far has been checked with `_smoke/update-smoke.mjs`, which
// runs the CURRENT build and confirms the channel answers "Up to date". That
// proves the feed is reachable and well-formed. It cannot prove the thing
// anyone actually cares about -- that a person on an older build is offered
// the newer one -- because the build under test is always the newest.
//
// So this runs a deliberately older PACKAGED build against the real feed and
// reads what the app says. `supported` is `app.isPackaged`, so this has to be
// the packaged binary in release/win-unpacked, not a dev launch: a dev launch
// answers `unsupported` and would look like a pass to a careless reader.
//
// The app installs an update ON QUIT. This process is KILLED rather than
// quit, deliberately, so the test cannot overwrite the Locust the person at
// this machine is using.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APP_DIR, say } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!existsSync(EXE)) {
  say(`no packaged build at ${EXE}`)
  process.exit(1)
}

const PORT = 9359
const profile = await mkdtemp(join(tmpdir(), 'locust-update-profile-'))
const child = spawn(EXE, [`--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  stdio: 'ignore'
})

const pageTarget = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      const targets = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      const page = targets.find((target) => target.type === 'page')
      if (page !== undefined) return page
    } catch {
      // not listening yet
    }
  }
  return undefined
}

try {
  const page = await pageTarget()
  if (page === undefined) throw new Error('the packaged app never opened a debuggable page')

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const evaluate = (expression) =>
    new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9)
      const onMessage = (event) => {
        const message = JSON.parse(String(event.data))
        if (message.id !== id) return
        socket.removeEventListener('message', onMessage)
        resolve(message.result?.result?.value)
      }
      socket.addEventListener('message', onMessage)
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })

  // Settings carries the build line and whatever the updater has concluded.
  const seen = await evaluate(`(async () => {
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const button = [...document.querySelectorAll('button')].find((b) => /settings/i.test(b.getAttribute('title') ?? b.innerText ?? ''))
      if (button) { button.click(); break }
    }
    // The check runs on launch; give it room to answer over the network.
    let best = ''
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 1000))
      const text = document.body.innerText
      // The updater's OWN sentences, not any line containing "update" -- a
      // note about Antigravity's unpublished interface matched that and made
      // the first run of this read as inconclusive.
      const line = text.split(String.fromCharCode(10)).map((t) => t.trim()).find((t) =>
        /^Up to date\.$/.test(t)
        || /^Checking/.test(t)
        || /^Not checked yet\.$/.test(t)
        || /^Version .* is available/.test(t)
        || /^Downloading /.test(t)
        || /is downloaded and ready to install/.test(t)
        || /^This build cannot update itself/.test(t))
      if (line) { best = line }
      if (best && /available|ready to install|Downloading/i.test(best)) break
    }
    const build = document.body.innerText.split(String.fromCharCode(10)).map((t) => t.trim())
      .find((t) => /^Locust /.test(t) && /local only/.test(t))
    return JSON.stringify({ build: build ?? '(no build line)', update: best === '' ? '(nothing said about updates)' : best })
  })()`)

  const parsed = JSON.parse(String(seen))
  say(`build under test : ${parsed.build}`)
  say(`what it says     : ${parsed.update}`)
  say(
    /available|ready|restart|download/i.test(parsed.update)
      ? 'AN OLDER BUILD IS OFFERED THE NEWER ONE'
      : /up to date/i.test(parsed.update)
        ? 'WRONG: an older build believes it is current'
        : 'inconclusive -- nothing was said about updates'
  )
  socket.close()
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  // KILLED, never quit: quitting is what triggers the install, and this
  // machine has a real Locust on it.
  child.kill('SIGKILL')
  await new Promise((resolve) => setTimeout(resolve, 1500))
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}
