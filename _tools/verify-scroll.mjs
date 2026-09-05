// Can a long thread be scrolled to its top?
//
//   node _tools/verify-scroll.mjs
//
// The defect was a stylesheet rule, so the proof has to be geometry read from
// a live renderer: a screenshot cannot show what is UNREACHABLE. Colin, on a
// long Codex run, 2026-09-05: "no ability to scroll on mouse through
// messages, just keeps going down and cant scroll up."
//
// `justify-content: flex-end` on a scrolling flex column pushes content out
// of the TOP, and an overflowed top is not part of the scroll range. This
// builds the app's real .lc-thread rules in a bounded box, fills it past a
// screenful, and asks two questions: can scrollTop reach 0 with the first
// message inside the box, and -- the control -- does the exact pre-0.21.0
// rule fail that same question. Measured 2026-09-05:
//
//   fixed:       { overflows: true,  reachedTop: true,  gap:  -24 }
//   withOldRule: { overflows: false, reachedTop: false, gap: 2319 }
//
// The old rule's `overflows: false` is the bug in one number: the container
// reported nothing to scroll while 2319px of conversation sat above it.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = 'C:/Users/<home>/Documents/Codex/ai-teammate-platform/apps/desktop/'
const ELECTRON = join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
const PORT = 9301
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = await mkdtemp(join(tmpdir(), 'locust-scroll-'))
const workspace = await mkdtemp(join(tmpdir(), 'locust-scroll-ws-'))
await mkdir(profile, { recursive: true })
await writeFile(join(workspace, 'status.ts'), 'export const status = "draft";\n', 'utf8')

const child = spawn(ELECTRON, [APP_DIR, `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${profile}`], {
  cwd: workspace,
  env: { ...process.env, PATH: `C:\Users\<home>\AppData\Roaming\npm;${process.env.PATH ?? ''}` },
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', () => undefined)
child.stderr.on('data', () => undefined)
try {
  let page
  for (let i = 0; i < 80 && page === undefined; i += 1) {
    await sleep(500)
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    } catch { /* not up */ }
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res) => socket.addEventListener('open', res, { once: true }))
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (e) => { const m = JSON.parse(e.data); const w = pending.get(m.id); if (w) { pending.delete(m.id); w(m) } })
  const evaluate = (expression) => new Promise((res) => {
    const n = ++id
    pending.set(n, (m) => res(m.result?.result?.value))
    socket.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
  await evaluate(`(async () => {
    for (let i = 0; i < 240; i += 1) {
      const f = document.querySelector('form.command-dock textarea')
      if (f && !/Checking local runtimes/.test(f.placeholder)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  })()`)
  // Fill the thread past a screenful with real bubbles, then measure.
  const result = await evaluate(`(async () => {
    // Build the real box: a bounded flex column with the app's own
    // .lc-thread rules on the scroller. No mission needed -- the bug was the
    // stylesheet, so the stylesheet is what gets measured.
    const outer = document.createElement('div')
    outer.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:400px;display:flex;flex-direction:column;z-index:99999'
    const thread = document.createElement('div')
    thread.className = 'lc-thread'
    outer.appendChild(thread)
    document.body.appendChild(outer)
    const fill = () => {
      thread.innerHTML = ''
      const made = []
      for (let i = 0; i < 60; i += 1) {
        const d = document.createElement('div')
        d.className = 'lc-bubble'
        d.textContent = 'line ' + String(i)
        thread.appendChild(d)
        made.push(d)
      }
      return made
    }
    const measure = async (oldRule) => {
      const made = fill()
      // The exact pre-0.21.0 stylesheet: flex-end alignment and NO auto
      // margin on the first child. Anything less is not the old rule.
      if (oldRule) made[0].style.marginTop = '0'
      await new Promise(r => setTimeout(r, 120))
      const overflows = thread.scrollHeight > thread.clientHeight + 4
      thread.scrollTop = 0
      await new Promise(r => setTimeout(r, 120))
      const first = made[0].getBoundingClientRect()
      const box = thread.getBoundingClientRect()
      return { overflows, reachedTop: first.top >= box.top - 2 && first.bottom <= box.bottom + 2, gap: Math.round(box.top - first.top) }
    }
    const now = await measure(false)
    // NEGATIVE CONTROL: put the old rule back and the same check must fail.
    thread.style.justifyContent = 'flex-end'
    thread.style.setProperty('--none', '0')
    const old = await measure(true)
    outer.remove()
    return JSON.stringify({ fixed: now, withOldRule: old })
  })()`)
  console.error(String(result))
} finally {
  try { child.kill() } catch { /* gone */ }
  await sleep(1200)
  await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}
