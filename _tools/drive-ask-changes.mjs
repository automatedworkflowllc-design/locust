// "Ask me first" covers a rewrite and a forget (0.315).
//
//   node _tools/drive-ask-changes.mjs
//
// Memory mode Ask me first, two memories the person already kept: one named
// (deploy-day), one not. Booty, on the free OpenCode model, is asked to
// rewrite the named one and to forget the other. Neither may change until
// the person answers: the thread says what is asked, the Memory screen shows
// each proposal beside what it would change, "Keep the change" rewrites,
// "Keep it" keeps, "Forget it" forgets -- and the brief follows each answer,
// which is the round trip rather than the write. Read twice: the file every
// teammate is given (.locust/memory.md, written from the same lines as the
// brief, before each run), and a teammate quoting it. Each quote is a NEW
// teammate's first conversation -- a follow-up carries what the model read
// on an earlier turn, and the first run of this drive quoted a memory that
// was already gone from its brief for exactly that reason.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-askchanges-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-05T05:00:00.000Z'
const kept = (memoryId, text, name) => ({
  memoryId,
  text,
  scope: 'workspace',
  workspaceId,
  workspaceName: 'scratch',
  by: { name: 'you' },
  createdAt: T0,
  status: 'kept',
  enabled: true,
  ...(name === undefined ? {} : { name })
})
const drive = await startDrive({
  name: 'ask-changes',
  port: 9528,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      /*
       * No teammate here runs in Ask MODE. "Ask me first" is the workspace's
       * MEMORY mode and needs nothing of the route; an OpenCode run in Ask
       * mode ends the moment its model calls the shell, and the free models
       * reach for `cat` first -- the first two runs of this drive lost three
       * of their turns to exactly that, the second one its only proposal.
       */
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: FREE_ROUTE },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0, route: FREE_ROUTE },
      { teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Quoter', createdAt: T0, route: FREE_ROUTE },
      { teammateId: 'tm_moth', name: 'Moth', hue: 'teal', role: 'Custom', roleTitle: 'Quoter', createdAt: T0, route: FREE_ROUTE }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'ask' }
  },
  files: {
    'memories.json': {
      schemaVersion: 1,
      memories: [kept('mem_day', 'Deploys go out on Fridays.', 'deploy-day'), kept('mem_port', 'The API is on port 3000.')]
    }
  }
})
const QUOTE = 'Without running any command or reading any file, quote every line your brief lists under what your team remembers, one per line, word for word. If there is none, reply NONE.'
// What the file every teammate reads said for the run just finished.
const briefed = async () => {
  const text = await readFile(join(workspace, '.locust', 'memory.md'), 'utf8')
  return 'the file says: ' + text.split(/\r?\n/).filter((line) => line.startsWith('- ')).join(' / ')
}
const quote = async (name) => {
  await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
  await drive.evaluate(pick(name))
  const said = await drive.evaluate(sendAndWaitScript(QUOTE))
  return `${await briefed()} || ${name}: ${said}`
}
const pick = (name) => `(async () => { ${teammateFace(name)}.click(); await new Promise(r => setTimeout(r, 500)); return 'picked ${name}' })()`
// Every memory row on the Memory screen, a proposal marked as one.
const rows = `[...document.querySelectorAll('.lc-memory')].map(r => (r.classList.contains('is-proposed') ? '[proposed] ' : '') + r.innerText.replace(/\\s+/g, ' ').slice(0, 160)).join(' | ')`
const memoryScreen = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true })); await new Promise(r => setTimeout(r, 700))`
const press = (rowPattern, label) => `(async () => {
  ${memoryScreen}
  const row = [...document.querySelectorAll('.lc-memory.is-proposed')].find(r => ${rowPattern}.test(r.innerText))
  if (!row) return 'no proposed row matching ${rowPattern}: ' + ${rows}
  const button = [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '${label}')
  if (!button) return 'no ${label} button: ' + row.innerText.replace(/\\s+/g, ' ')
  button.click()
  await new Promise(r => setTimeout(r, 700))
  return 'pressed ${label} || ' + ${rows}
})()`

try {
  await drive.capture('launch, mode Ask me first, two kept memories', () => drive.ready())
  await drive.capture('pick the free route', () =>
    drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/free/i' }))
  )
  await drive.capture('ask Booty to change one memory and forget the other', async () => {
    await drive.evaluate(pick('Booty'))
    return drive.evaluate(
      sendAndWaitScript(
        'Without running any command or reading any file: two things your team remembers have changed. Use the memory block you were shown, with exactly these two lines and nothing else in it: "remember as deploy-day :: Deploys go out on Thursdays." and "forget :: The API is on port 3000". Then reply with the single word OK.'
      )
    )
  })
  await drive.capture('the thread names what is asked, not "remembered"', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-memorycard .lc-activity')
    if (!fold) return 'no memory fold: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-240) ?? '')
    const summary = fold.innerText.replace(/\\s+/g, ' ')
    if (fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 300))
    return summary + ' || ' + [...document.querySelectorAll('.lc-memorycard__line')].map(l => l.innerText.replace(/\\s+/g, ' ')).join(' / ')
  })()`))
  await drive.capture('the Memory screen: each proposal beside what it would change', () => drive.evaluate(`(async () => {
    ${memoryScreen}
    return (document.querySelector('.lc-memory__notice')?.innerText.replace(/\\s+/g, ' ') ?? 'no notice') + ' || ' + ${rows}
  })()`))
  await drive.capture('Wren, before anyone answers: the brief still has both, unchanged', () => quote('Wren'))
  await drive.capture('press Keep the change', () => drive.evaluate(press('/Thursdays/', 'Keep the change')))
  await drive.capture('press Keep it on the forget', () => drive.evaluate(press('/port 3000/', 'Keep it')))
  await drive.capture('Ash quotes what is kept now: Thursdays, and port 3000 still', () => quote('Ash'))
  await drive.capture('Booty asks to forget port 3000 again; this time Forget it', async () => {
    await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
    await drive.evaluate(pick('Booty'))
    await drive.evaluate(
      sendAndWaitScript('Without running any command or reading any file, use the memory block you were shown, with exactly this one line and nothing else in it: "forget :: The API is on port 3000". Then reply with the single word OK.')
    )
    return drive.evaluate(press('/port 3000/', 'Forget it'))
  })
  await drive.capture('Moth quotes what is kept last: Thursdays only', () => quote('Moth'))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Booty proposes; Wren, Ash and Moth quote, each in their first conversation; all on the free OpenCode model; memory mode Ask me first, two memories already kept.' })
}
