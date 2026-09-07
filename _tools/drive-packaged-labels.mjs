// What does the PACKAGED build call itself?
//
//   node _tools/drive-packaged-labels.mjs
//
// A first outside tester, 0.38.7 finding 6: 'Settings header on this GitHub
// release: "Locust 0.38.7 - development build - local only."' And finding 7:
// "Window title is the folder basename (`tmp`, then `locust-sample`), not
// Locust."
//
// Every other drive here launches `electron.exe <app dir>`, where
// `app.isPackaged` is FALSE by definition -- so none of them can see either
// label the way a person who installed the app does. This one launches
// `release/win-unpacked/Locust.exe`, which is the same binary the installer
// lays down, on a throwaway profile of its own.
//
// It installs nothing and touches no existing Locust profile.
//
// Costs no quota: nothing is sent to a model.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APP_DIR, say, scratchRepository } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!existsSync(EXE)) {
  say(`no packaged build at ${EXE} -- run \`pnpm --filter @teammate/desktop package\` first`)
  process.exit(1)
}

const PORT = 9354
const workspace = await scratchRepository('locust-packaged-ws-')
const profile = await mkdtemp(join(tmpdir(), 'locust-packaged-profile-'))

const child = spawn(EXE, [`--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  stdio: 'ignore',
  env: { ...process.env, LOCUST_WORKSPACE: workspace }
})

/** Poll the CDP list endpoint until the page shows up. */
const pageTarget = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      const response = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page')
      if (page !== undefined) return page
    } catch {
      // Not listening yet.
    }
  }
  return undefined
}

try {
  const page = await pageTarget()
  if (page === undefined) throw new Error('the packaged app never opened a debuggable page')

  // The window title is on the target itself, which is exactly what the
  // taskbar and the window chrome show.
  say(`window title: ${JSON.stringify(page.title)}`)
  say(`title is the app name: ${/^Locust/.test(page.title) ? 'YES' : `NO -- it reads ${JSON.stringify(page.title)}`}`)

  // Node's own WebSocket, the way drive-lib does it -- `ws` is not a
  // dependency of this workspace.
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

  const header = await evaluate(`(async () => {
    // Settings is where the build line lives.
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500))
      const button = [...document.querySelectorAll('button')].find((b) => /settings/i.test(b.getAttribute('title') ?? b.innerText ?? ''))
      if (button) { button.click(); break }
    }
    await new Promise((r) => setTimeout(r, 1200))
    const text = document.body.innerText
    const line = text.split(String.fromCharCode(10)).map((t) => t.trim()).find((t) => /^Locust /.test(t) && /local only/.test(t))
    return line === undefined ? 'no build line found on the Settings screen' : line
  })()`)
  say(`settings build line: ${JSON.stringify(header)}`)
  say(
    typeof header === 'string' && /development build/.test(header)
      ? 'STILL WRONG: a packaged build calls itself a development build'
      : 'the packaged build does not call itself a development build'
  )
  socket.close()
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  child.kill()
  await new Promise((resolve) => setTimeout(resolve, 1500))
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
}
