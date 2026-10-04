// A person watches the team remember things, and manages what it kept.
//
//   node _tools/drive-memory.mjs [--packaged <exe>]
//
// Two teammates on the free OpenCode model, memory on ("keep and tell me"),
// one memory seeded as if typed earlier. Wren is asked to quote it; Booty is
// asked to remember something with the block; the fold, the Memory screen,
// an edit, a switch-off, a memory typed by hand for everywhere.

import { createHash } from 'node:crypto'

import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

// C6 (plan 2026-09-24): the same drive against a packaged build.
const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined

const workspace = await scratchRepository('locust-drive-memory-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'memory',
  port: 9298,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: { ...FREE_ROUTE, mode: 'ask' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
  },
  files: {
    'memories.json': {
      schemaVersion: 1,
      memories: [{ memoryId: 'mem_seed', text: 'The secret word for this project is PELICAN.', scope: 'workspace', workspaceId, workspaceName: 'scratch', by: { name: 'you' }, createdAt: T0, status: 'kept', enabled: true }]
    }
  }
})

const pick = (name) => `(async () => { ${teammateFace(name)}.click(); await new Promise(r => setTimeout(r, 500)); return 'picked ${name}' })()`

try {
  await drive.capture('launch', () => drive.ready())
  /*
   * SAY WHICH ROUTE, rather than inheriting whatever the composer defaulted
   * to. This drive seeds its teammates with FREE_ROUTE, and a teammate's
   * seeded route is NOT the composer's route on a new conversation -- a drive
   * that assumed otherwise on 2026-09-20 sent its turn on Codex, which is
   * Astra's quota, and passed every check it made. `ready()` now refuses to
   * start a non-spending drive on a paid route; this line is the drive saying
   * what it meant rather than relying on that refusal to notice.
   */
  await drive.capture('pick the free route', () =>
    drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/free/i' }))
  )
  await drive.capture('Settings counts the seeded memory', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 800))
    // Settings has pages since 0.393 and opens on General; memory is its own page.
    ;[...document.querySelectorAll('.lc-settings__navitem')].find((item) => item.innerText.trim() === 'Memory')?.click()
    await new Promise(r => setTimeout(r, 500))
    const box = document.querySelector('.lc-settings__heading') ? document.querySelector('.lc-screen__scroll') : null
    const heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => /remembers/.test(h.textContent))
    heading?.scrollIntoView({ block: 'start' })
    await new Promise(r => setTimeout(r, 400))
    return heading?.closest('.lc-settings__section')?.innerText.replace(/\\s+/g, ' ').slice(0, 220) ?? 'no memory section'
  })()`))
  await drive.capture('ask Wren to quote what the team remembers', async () => {
    await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
    await drive.evaluate(pick('Wren'))
    return drive.evaluate(sendAndWaitScript('Your brief lists what your team remembers. Quote, word for word, the remembered line that mentions a secret word. If there is none, reply NONE.'))
  })
  await drive.capture('ask Booty to remember the build command', async () => {
    await drive.evaluate(pick('Booty'))
    return drive.evaluate(sendAndWaitScript('Remember, for this project only, that the build command is pnpm build. Use the memory block you were shown. Then reply with the single word OK.'))
  })
  await drive.capture('the memory fold in Booty\'s thread, opened', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-memorycard .lc-activity')
    if (!fold) return 'no memory fold: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-200) ?? '')
    const summary = fold.innerText.replace(/\\s+/g, ' ')
    // Only if it is closed. A finished turn's fold opens itself since 0.49.0,
    // so an unconditional click CLOSES it and the rows below read as absent.
    if (fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 300))
    return summary + ' || ' + [...document.querySelectorAll('.lc-memorycard__line')].map(l => l.innerText).join(' / ')
  })()`))
  await drive.capture('open Memory with Ctrl 5', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true }))
    await new Promise(r => setTimeout(r, 700))
    return (document.querySelector('.lc-screen__title')?.innerText ?? '') + ' · ' + (document.querySelector('.lc-screen__meta')?.innerText ?? '') + ' || ' + [...document.querySelectorAll('.lc-memory')].map(r => (r.querySelector('.lc-memory__text')?.innerText ?? '') + ' [' + (r.querySelector('.lc-memory__meta')?.innerText.replace(/\\s+/g, ' ') ?? '') + ']').join(' | ')
  })()`))
  await drive.capture('edit the seeded memory', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-memory')].find(r => /PELICAN/.test(r.innerText))
    if (!row) return 'no PELICAN row'
    ;[...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'Edit').click()
    await new Promise(r => setTimeout(r, 200))
    const box = row.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'The secret word for this project is HERON.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    ;[...row.querySelectorAll('button')].find(b => b.innerText.trim() === 'Save').click()
    await new Promise(r => setTimeout(r, 600))
    return [...document.querySelectorAll('.lc-memory__text')].map(t => t.innerText).join(' | ')
  })()`))
  await drive.capture('switch one off', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-memory')].find(r => /HERON/.test(r.innerText))
    row.querySelector('[role=switch]').click()
    await new Promise(r => setTimeout(r, 600))
    return 'aria-checked=' + row.querySelector('[role=switch]').getAttribute('aria-checked')
  })()`))
  await drive.capture('type a memory for everywhere', () => drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="What to remember"]')
    if (!box) return 'no add box'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(box, 'Colin wants diffs, not prose.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    ;[...document.querySelectorAll('[role=radiogroup][aria-label="Where it applies"] [role=radio]')].find(b => /Everywhere/.test(b.innerText))?.click()
    await new Promise(r => setTimeout(r, 100))
    ;[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Remember').click()
    await new Promise(r => setTimeout(r, 600))
    return [...document.querySelectorAll('.lc-memory')].map(r => r.innerText.replace(/\\s+/g, ' ').slice(0, 90)).join(' | ')
  })()`))
  await drive.capture('ask Wren again: which line is remembered now', async () => {
    await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
    await drive.evaluate(pick('Wren'))
    return drive.evaluate(sendAndWaitScript('Your brief lists what your team remembers. Quote every remembered line, one per line, word for word. If there is none, reply NONE.'))
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: (packaged === undefined ? 'Build: whatever `pnpm build` last wrote to out/.' : 'Build: the packaged build.') + ' Wren and Booty on the free OpenCode model, memory on (keep and tell me), one memory seeded as typed earlier.' })
}
