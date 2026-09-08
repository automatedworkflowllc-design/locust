// A person watches the team remember things, and manages what it kept.
//
//   node _tools/drive-memory.mjs
//
// Two teammates on the free OpenCode model, memory on ("keep and tell me"),
// one memory seeded as if typed earlier. Wren is asked to quote it; Booty is
// asked to remember something with the block; the fold, the Memory screen,
// an edit, a switch-off, a memory typed by hand for everywhere.

import { createHash } from 'node:crypto'

import { FREE_ROUTE, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-memory-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
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

const pick = (name) => `(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message ${name}')).click(); await new Promise(r => setTimeout(r, 500)); return 'picked ${name}' })()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('Settings counts the seeded memory', () => drive.evaluate(`(async () => {
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 800))
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
    fold.click()
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
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren and Booty on the free OpenCode model, memory on (keep and tell me), one memory seeded as typed earlier.' })
}
