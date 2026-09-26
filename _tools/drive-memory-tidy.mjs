// A tidy pass: a teammate reads the folder's memories and suggests (A1.2).
//
//   node _tools/drive-memory-tidy.mjs [--packaged <exe>] [--tag <name>]
//
// Six memories kept, two of them the same fact, one contradicted by another.
// "Tidy up..." on the Memory screen, then "Ask Wren" from its menu, the way a
// person would. Wren's reply must come back as proposals -- nothing kept
// changes -- and the drive answers them: Merge them, Forget it. Seeded
// beside them is one suggestion made about words that have since changed;
// keeping it must be refused (the hash gate) and the suggestion dropped.
// Last, a NEW teammate's run: the file it is given, read by the drive.

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive, recordRoot } from './drive-lib.mjs'

/*
 * Free by default. LOCUST_DRIVE_CLAUDE=1 runs the teammates on Claude Haiku
 * instead -- for when the OpenCode free tier is down (2026-09-24: both free
 * models hung on a one-word prompt) -- and says the drive spends, so it also
 * needs LOCUST_SPEND=1.
 */
const ON_CLAUDE = process.env.LOCUST_DRIVE_CLAUDE === '1'
const ROUTE = ON_CLAUDE ? { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } : FREE_ROUTE

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(recordRoot('beta-fixes-2026-09-24'), `memory-tidy-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-tidy-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-05T05:00:00.000Z'
const kept = (memoryId, text) => ({ memoryId, text, scope: 'workspace', workspaceId, workspaceName: 'scratch', by: { name: 'you' }, createdAt: T0, status: 'kept', enabled: true })
const teammate = (name, hue) => ({ teammateId: `tm_${name.toLowerCase()}`, name, hue, role: 'Custom', roleTitle: 'Helper', createdAt: T0, route: ROUTE })
const drive = await startDrive({
  spends: ON_CLAUDE,
  name: 'memory-tidy',
  port: 9533,
  workspace,
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  seed: {
    schemaVersion: 1,
    teammates: [teammate('Wren', 'lime'), teammate('Ash', 'clay')],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
  },
  files: {
    'memories.json': {
      schemaVersion: 1,
      memories: [
        kept('mem_thu1', 'Deploys go out on Thursdays.'),
        kept('mem_thu2', 'We deploy every Thursday.'),
        kept('mem_moved', 'The API moved from port 3000 to port 3001 on September 20.'),
        kept('mem_port', 'The API is on port 3000.'),
        kept('mem_tests', 'Tests run with pnpm test.'),
        kept('mem_word', 'The secret word for this project is PELICAN.'),
        // A suggestion made about words that have since changed: its basis
        // is not the fingerprint of "Tests run with pnpm test." -- keeping it
        // must be refused.
        {
          memoryId: 'mem_stale',
          text: 'Tests run with npm test.',
          scope: 'workspace',
          workspaceId,
          workspaceName: 'scratch',
          by: { name: 'Booty' },
          createdAt: T0,
          status: 'proposed',
          enabled: true,
          replaces: 'mem_tests',
          basis: 'ffffffffffffffff'
        }
      ]
    }
  }
})

const memoryScreen = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true })); await new Promise(r => setTimeout(r, 700))`
const sections = `[...document.querySelectorAll('.lc-settings__section')].map(section => {
  const heading = section.querySelector('.lc-settings__heading')?.innerText.replace(/\\s+/g, ' ') ?? ''
  const rows = [...section.querySelectorAll('.lc-memory')].map(r => r.innerText.replace(/\\s+/g, ' ').slice(0, 170))
  return rows.length === 0 ? '' : heading + ': ' + rows.join(' | ')
}).filter(Boolean).join(' || ')`
const press = (rowPattern, label) => `(async () => {
  ${memoryScreen}
  const row = [...document.querySelectorAll('.lc-memory.is-proposed')].find(r => ${rowPattern}.test(r.innerText))
  if (!row) return 'no proposed row matching ${rowPattern}: ' + ${sections}
  const button = [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '${label}')
  if (!button) return 'no ${label} button: ' + row.innerText.replace(/\\s+/g, ' ')
  button.click()
  await new Promise(r => setTimeout(r, 900))
  const said = [...document.querySelectorAll('.lc-memory__notice, .lc-dialog__error')].map(n => n.innerText.replace(/\\s+/g, ' ')).join(' / ')
  return 'pressed ${label} || said: ' + (said || 'nothing') + ' || ' + ${sections}
})()`
const file = async () => (await readFile(join(workspace, '.locust', 'memory.md'), 'utf8').catch(() => 'no file')).split(/\r?\n/).filter((line) => line.startsWith('- ')).join(' / ')

try {
  await drive.capture('launch: six memories kept, two the same fact, one contradicted', () => drive.ready())
  await drive.capture('Memory screen: Tidy up... then Ask Wren from its menu', () => drive.evaluate(`(async () => {
    ${memoryScreen}
    const tidy = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Tidy up…')
    if (!tidy) return 'no Tidy up button: ' + ${sections}
    tidy.click()
    await new Promise(r => setTimeout(r, 500))
    const items = [...document.querySelectorAll('[role=menu] button, [role=menuitem]')]
    const menu = items.map(b => b.innerText.replace(/\\s+/g, ' ').trim()).join(' / ')
    const wren = items.find(b => /Ask Wren/.test(b.innerText))
    if (!wren) return 'no Ask Wren in the menu: ' + menu
    wren.click()
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 250))
      if (document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return 'menu: ' + menu + ' || running: ' + (document.querySelector('button[aria-label^="Stop the running"]') !== null)
  })()`))
  await drive.capture('what Wren said, and the card under it', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (!document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1500))
    const thread = document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? ''
    const card = document.querySelector('.lc-memorycard .lc-activity')?.innerText.replace(/\\s+/g, ' ') ?? 'no memory card'
    return 'card: ' + card + ' || block shown to the person: ' + /<locust-tidy>/.test(thread) + ' || reply: ' + thread.slice(-600)
  })()`))
  await drive.capture('Memory screen: the suggestions wait; nothing kept changed', () => drive.evaluate(`(async () => {
    ${memoryScreen}
    return (document.querySelector('.lc-memory__notice')?.innerText.replace(/\\s+/g, ' ') ?? 'no notice') + ' || ' + ${sections}
  })()`))
  await drive.capture('the file before any answer: all six still', async () => `the file says: ${await file()}`)
  await drive.capture('keep the out-of-date suggestion: refused, and dropped', () => drive.evaluate(press('/npm test/', 'Keep the change')))
  await drive.capture('Merge them, on a merge Wren suggested', () => drive.evaluate(press('/Wants to merge/', 'Merge them')))
  await drive.capture('Forget it, on a retirement Wren suggested', () => drive.evaluate(press('/Wants to forget/', 'Forget it')))
  await drive.capture('Ash, a new teammate: the file for its run, and its quote', async () => {
    await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
    const opened = await drive.evaluate(openTeammateScript('Ash'))
    const said = opened.startsWith('opened')
      ? await drive.evaluate(sendAndWaitScript('Without running any command or reading any file, quote every line your brief lists under what your team remembers, one per line, word for word.'))
      : opened
    return `the file says: ${await file()} || Ash: ${said}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren and Ash on ${ON_CLAUDE ? 'Claude Haiku' : 'the free OpenCode model'}; memory Keep and tell me; six memories kept and one out-of-date suggestion seeded.` })
}
