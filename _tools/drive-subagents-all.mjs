// The same subagent ask on three runtimes, to see which spawn one and what
// Locust shows while it runs.
//
//   node _tools/drive-subagents-all.mjs
//
// Wren on Codex CLI, Booty on Cursor Agent / composer-2.5, Gem on the free
// OpenCode model. Each is asked to use a subagent to count the lines in
// README.md. Kept per teammate: the sidebar's live label over time, the
// fold rows with each tool's name, and the header. Spends one short run on
// each of Colin's Codex and Cursor accounts.

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, FREE_ROUTE } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-subagents-ws-')
const T0 = '2026-09-05T05:00:00.000Z'
const drive = await startDrive({
  name: 'subagents-all',
  port: 9306,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      // gpt-5.6-sol: the model Colin's own session spawned subagents on (2026-09-06).
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: T0, route: { runtime: 'codex', model: 'gpt-5.6-sol', mode: 'ask' } },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'blue', role: 'Custom', roleTitle: 'Reviewer', createdAt: T0 },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'violet', role: 'Custom', roleTitle: 'Scout', createdAt: T0, route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
const ASK = 'Use a subagent (a helper agent, if your tools offer one) to count the lines in README.md and report the number to you. Then reply with one sentence giving that number. If you have no way to start a subagent, say so in one sentence and count the lines yourself. Do not edit anything.'
const pick = (name) => `(async () => { document.querySelector('.lc-brand__lockup').click(); await new Promise(r => setTimeout(r, 300)); [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message ${name}')).click(); await new Promise(r => setTimeout(r, 500)); return 'picked ${name}' })()`
const watch = (name) => `(async () => {
  const seen = []
  for (let i = 0; i < 480; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    const row = [...document.querySelectorAll('.lc-teammate')].find(r => new RegExp('^' + ${JSON.stringify(name)}).test(r.innerText.trim()))
    const line = row ? row.innerText.replace(/\\s+/g, ' ').slice(0, 70) : ''
    if (seen[seen.length - 1] !== line) seen.push(line)
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 800))
  const fold = document.querySelector('.lc-activity')
  // The is-open class is never set on the card. ActivityCard sets
  // aria-expanded on the button and nothing else, so this guard never
  // guarded anything. Harmless while earlier folds were closed anyway;
  // since 0.49.0 a finished turn's fold opens itself and this CLOSED it.
  if (fold && fold.getAttribute('aria-expanded') !== 'true') fold.click()
  await new Promise(r => setTimeout(r, 300))
  return 'sidebar over time: ' + seen.join(' -> ') + ' || fold: ' + (fold?.innerText.replace(/\\s+/g, ' ').slice(0, 60) ?? 'none') + ' || rows: ' + [...document.querySelectorAll('.lc-filerow')].map(r => (r.classList.contains('is-helper') ? '[subagent] ' : '') + r.innerText.replace(/\\s+/g, ' ').trim()).join(' | ').slice(0, 320) + ' || reply: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-160) ?? '')
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('Codex CLI: ask for a subagent and watch', async () => {
    await drive.evaluate(pick('Wren'))
    await drive.evaluate(sendAndWaitScript(ASK, { settle: false }))
    return drive.evaluate(watch('Wren'))
  })
  await drive.capture('Cursor Agent / composer-2.5: pick the route, ask, watch', async () => {
    await drive.evaluate(pick('Booty'))
    await drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'composer', row: '/composer[ -]2\\.5/i' }))
    await drive.evaluate(sendAndWaitScript(ASK, { settle: false }))
    return drive.evaluate(watch('Booty'))
  })
  await drive.capture('OpenCode free model: ask, watch', async () => {
    await drive.evaluate(pick('Gem'))
    await drive.evaluate(sendAndWaitScript(ASK, { settle: false }))
    return drive.evaluate(watch('Gem'))
  })
  await drive.capture('the three headers', () => drive.evaluate(`(async () => {
    const out = []
    for (const name of ['Wren', 'Booty', 'Gem']) {
      const row = [...document.querySelectorAll('.lc-teammate')].find(r => new RegExp('^' + name).test(r.innerText.trim()))
      row?.querySelector('.lc-teammate__mission')?.click()
      await new Promise(r => setTimeout(r, 600))
      out.push(name + ': ' + (document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 130) ?? ''))
    }
    return out.join(' || ')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. The same subagent ask on Codex CLI, Cursor Agent / composer-2.5 and the free OpenCode model.' })
}
