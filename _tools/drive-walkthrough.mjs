// The ordinary path, through the binary an installer lays down.
//
//   node _tools/drive-walkthrough.mjs
//
// Colin, 2026-09-09: "walk yourself through the new app. Just like another
// windows user would."
//
// Every other drive here proves one thing. This one deliberately proves
// nothing: it walks the path a person walks on the day they install Locust and
// CAPTURES each screen, so the pictures can be read afterwards by someone
// looking for what nobody predicted. Assertions decide in advance what is
// worth noticing; the point of a walkthrough is the opposite.
//
// It runs `release/win-unpacked/Locust.exe` -- the same bytes the installer
// lays down -- rather than the dev build, because `app.isPackaged` is false
// under `electron .` and the version line, the window title and the update
// section all read differently there from what a person actually gets.
//
// One teammate on the FREE OpenCode model, so the walk costs nothing, and a
// throwaway profile, so no existing Locust install is touched.

import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APP_DIR, say, scratchRepository, startDrive } from './drive-lib.mjs'

const EXE = join(APP_DIR, 'release', 'win-unpacked', 'Locust.exe')
if (!existsSync(EXE)) {
  say(`no packaged build at ${EXE} -- run \`pnpm --filter @teammate/desktop package\` first`)
  process.exit(1)
}

const workspace = await scratchRepository('locust-walk-ws-')
// A file OUTSIDE the workspace, which is the case 0.47.0 exists for.
const elsewhere = await mkdtemp(join(tmpdir(), 'locust-walk-elsewhere-'))
const outsideFile = join(elsewhere, 'notes-from-elsewhere.md')
await writeFile(outsideFile, '# Notes\n\nThis file lives outside the project folder.\n', 'utf8')

const drive = await startDrive({
  name: 'walkthrough',
  port: 9421,
  packaged: EXE,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/**
 * The route chip's own text, which is where the chosen runtime is stated.
 * Read back after picking, because a selection that silently did nothing is
 * how the first run of this walk ended up on a paid runtime.
 */
const ROUTE_CHIP = `(() => {
  const chip = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
  return (chip?.textContent ?? '').replace(/\\s+/g, ' ').trim()
})()`

/**
 * Open the picker until the model catalog has actually arrived.
 *
 * Discovery finds the runtimes quickly and the per-runtime model lists follow
 * separately. Measured on the packaged build (`probe-picker-contents`,
 * 2026-09-09): at the moment the window is up the picker holds SIX rows -- one
 * "Account default" per runtime, no models under any of them -- and twenty
 * seconds later the same search matches six free OpenCode models.
 *
 * So the condition is a row that is NOT a placeholder. The first version
 * waited for `rows > 1`, which those six account-defaults satisfy instantly:
 * the wait returned "ready" on precisely the state it existed to wait past,
 * the search then matched nothing, and the walk went out on a paid runtime.
 * That is the same shape as every false green in this repository -- a check
 * that passes on the thing it is meant to detect.
 */
const WAIT_FOR_CATALOG = `(async () => {
  for (let waited = 0; waited < 40000; waited += 750) {
    const chip = [...document.querySelectorAll('button.lc-control')].find((b) => (b.textContent ?? '').includes('/'))
    if (document.querySelector('.lc-picker') === null) chip?.click()
    await new Promise((r) => setTimeout(r, 300))
    const picker = document.querySelector('.lc-picker')
    if (picker !== null) {
      const labels = [...picker.querySelectorAll('.lc-picker__label')].map((el) => (el.textContent ?? '').trim())
      const real = labels.filter((label) => label !== 'Account default')
      if (real.length > 0) return 'catalog ready, ' + String(real.length) + ' models listed'
    }
    await new Promise((r) => setTimeout(r, 450))
  }
  return 'catalog never arrived'
})()`

/**
 * Choose OpenCode's free model, by the row's own label.
 *
 * NOT through the shared `pickRouteScript`, which does not reliably apply a
 * selection against the packaged build: measured three ways in
 * `probe-picker-contents` on 2026-09-09, the helper reported success and left
 * the chip on `Codex CLI / account-default`, while clicking the same row by
 * hand -- filtered or unfiltered -- moved it to `OpenCode /
 * ling-3.0-flash-fin-free` every time. The app is fine in every hand-driven
 * path; the helper is the unreliable part, and that is worth knowing because
 * about sixty drives use it.
 *
 * Matched on the LABEL rather than the row's `innerText`, which is what the
 * helper tests: a label is one string the component renders, and innerText
 * folds in the detail line and the tag.
 */
const PICK_FREE_OPENCODE = `(async () => {
  if (document.querySelector('.lc-picker') === null) {
    const control = [...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')
    control?.click()
    await new Promise((r) => setTimeout(r, 900))
  }
  const picker = document.querySelector('.lc-picker')
  if (picker === null) return 'picker would not open'
  let group = ''
  for (const node of picker.querySelector('.lc-picker__list').children) {
    const header = node.querySelector('.lc-picker__group')
    if (header) group = (header.textContent ?? '').trim()
    const rowEl = node.querySelector('.lc-picker__row')
    if (rowEl === null || rowEl.disabled === true) continue
    const label = (rowEl.querySelector('.lc-picker__label')?.textContent ?? '').trim()
    if (/opencode/i.test(group) && /free/i.test(label)) {
      rowEl.click()
      await new Promise((r) => setTimeout(r, 1200))
      return 'chose ' + label
    }
  }
  return 'no free OpenCode row offered'
})()`

/** What the screen says, in the words a person would read off it. */
const reading = `(() => {
  const text = (el) => (el === null ? null : (el.innerText ?? '').replace(/\\s+/g, ' ').trim())
  return JSON.stringify({
    title: document.title,
    version: text(document.querySelector('.lc-sidebar__version, .lc-settings__version')),
    teammates: [...document.querySelectorAll('.lc-teammate-name')].map((el) => text(el)),
    composerPlaceholder: document.querySelector('textarea[aria-label="Mission instruction"]')?.placeholder ?? null,
    controls: [...document.querySelectorAll('button.lc-control')].map((el) => text(el)),
    suggestions: [...document.querySelectorAll('.lc-idlepad__prompt, .lc-teammate__title')].map((el) => text(el)).slice(0, 4),
    bottomLine: text(document.querySelector('.lc-sidebar__foot, .lc-statusline'))
  })
})()`

try {
  await drive.capture('what greets you', async () => {
    await drive.ready()
    return drive.evaluate(reading)
  })

  await drive.capture('open the one teammate', async () => {
    await drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()
      await new Promise(r => setTimeout(r, 800))
    })()`)
    return drive.evaluate(reading)
  })

  await drive.capture('pick a model, the way the picker offers them', async () => {
    /*
     * Wait for the CATALOG, then pick, then read the chip back.
     *
     * The first run of this walkthrough opened the picker immediately, typed
     * `free`, and was told "Nothing matches that." -- because the model list
     * had not arrived. The selection silently did nothing, the run went out on
     * Codex at account-default, and it spent real quota on a walk that was
     * supposed to cost nothing. Nothing in the drive noticed; the receipt in
     * the screenshot is how it was found afterwards.
     *
     * That empty-state sentence was itself a defect and is fixed
     * (`pickerEmptyMessage`), but a drive must not depend on the app being
     * honest about a state it can simply wait for.
     */
    await drive.evaluate(WAIT_FOR_CATALOG)
    await drive.evaluate(PICK_FREE_OPENCODE)
    return `route is ${String(await drive.evaluate(ROUTE_CHIP))}`
  })

  /*
   * The guard, OUTSIDE the capture, which is the whole point.
   *
   * `capture` records a thrown error as the step's note and carries on -- it
   * is built that way so one bad reading does not lose the rest of a walk.
   * The first version of this check threw INSIDE it, so the drive dutifully
   * wrote "refusing to walk on a paid runtime" and then walked on the paid
   * runtime anyway. That cost quota a second time, which is worse than the
   * defect it was guarding against.
   *
   * Thrown here, it skips to `finally`, the record is still written, and the
   * process exits non-zero.
   */
  const route = String(await drive.evaluate(ROUTE_CHIP))
  if (!/opencode/i.test(route)) {
    throw new Error(`the route is ${JSON.stringify(route)}, not OpenCode -- refusing to walk on a paid runtime`)
  }

  await drive.capture('type a slash, to see what is possible from here', async () => {
    return drive.evaluate(`(async () => {
      const box = document.querySelector('textarea[aria-label="Mission instruction"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(box, '/')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 700))
      /* No backticks in here: this sits inside a template literal. */
      return JSON.stringify({
        menuOpen: document.querySelector('.lc-slash') !== null,
        commands: [...document.querySelectorAll('.lc-slash__item')].map(el => (el.innerText ?? '').replace(/\\s+/g, ' ').trim())
      })
    })()`)
  })

  await drive.capture('ask it something real', async () => {
    return drive.evaluate(`(async () => {
      const box = document.querySelector('textarea[aria-label="Mission instruction"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(box, 'Create a file called hello.txt containing the single word HELLO, then run a command that prints it back, then say DONE.')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      box.focus()
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await new Promise(r => setTimeout(r, 50000))
      return 'sent, and waited'
    })()`)
  })

  await drive.capture('what the finished turn shows', async () => {
    return drive.evaluate(`(async () => {
      const text = (el) => (el === null ? null : (el.innerText ?? '').replace(/\\s+/g, ' ').trim())
      return JSON.stringify({
        trace: text(document.querySelector('.lc-activity')),
        rows: [...document.querySelectorAll('.lc-filerow')].map(el => text(el)),
        replies: [...document.querySelectorAll('.lc-agentline__body')].map(el => text(el)).slice(-3),
        header: text(document.querySelector('.lc-workroom__header'))
      })
    })()`)
  })

  await drive.capture('the Missions screen', async () => {
    return drive.evaluate(`(async () => {
      document.querySelector('button[title="All missions (Ctrl 1)"]')?.click()
      await new Promise(r => setTimeout(r, 1200))
      const text = (el) => (el === null ? null : (el.innerText ?? '').replace(/\\s+/g, ' ').trim())
      return JSON.stringify({
        meta: text(document.querySelector('.lc-screen__meta')),
        rows: [...document.querySelectorAll('.lc-missionrow')].map(el => text(el))
      })
    })()`)
  })

  await drive.capture('and Settings, where a person checks what they installed', async () => {
    return drive.evaluate(`(async () => {
      document.querySelector('button[title^="Settings"]')?.click()
      await new Promise(r => setTimeout(r, 1200))
      const body = (document.body.innerText ?? '').replace(/\\s+/g, ' ')
      return JSON.stringify({ says: body.slice(0, 700) })
    })()`)
  })
} finally {
  await drive.finish({
    intro: `Walked through the packaged 0.54.0 build on a fresh profile, one teammate, free model. A file to attach was left at ${outsideFile}.`
  })
}

say('done')
