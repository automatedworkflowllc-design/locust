// A person tries to remove a teammate's own branch while it is in use,
// then after the run, and starts the teammate again afterwards.
//
//   node _tools/drive-worktree-live.mjs
//
// Wren with Own branch on, free OpenCode model. A slow run; Settings' Own
// branches row must read "In use" and refuse while it runs; after the run,
// Remove takes the tree away and the branch stays; a new message makes the
// tree again on the same branch.

import { FREE_ROUTE, git, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-wt-ws-')
const drive = await startDrive({
  name: 'worktree-live',
  port: 9300,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE, worktree: true }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

const settingsRows = `(async () => {
  if (![...document.querySelectorAll('.lc-settings__heading')].length) document.querySelector('button[title="Settings (Ctrl 3)"]').click()
  for (let i = 0; i < 40; i += 1) {
    await new Promise(r => setTimeout(r, 250))
    if (document.querySelector('.lc-worktreerow') || i > 12) break
  }
  const rows = [...document.querySelectorAll('.lc-worktreerow')]
  return rows.length === 0
    ? 'no rows: ' + ([...document.querySelectorAll('.lc-policyrow')].find(p => /OWN BRANCHES/.test(p.textContent))?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? 'no own-branches row')
    : rows.map(r => r.innerText.replace(/\\s+/g, ' ') + ' [button ' + (r.querySelector('button')?.disabled ? 'disabled' : 'enabled') + ']').join(' | ')
})()`

try {
  await drive.capture('launch: Wren on locust/wren', () => drive.ready())
  await drive.capture('start a slow run in the own branch', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren').click(); await new Promise(r => setTimeout(r, 500)) })()`)
    return drive.evaluate(sendAndWaitScript('Read README.md, then write a numbered list of 40 distinct one-sentence ideas for improving this scratch project, thinking carefully about each. Do not edit any files.', { settle: false }))
  })
  await drive.capture('Settings while it runs: the row reads In use', async () => {
    await drive.evaluate(`(async () => { for (let i = 0; i < 80; i += 1) { await new Promise(r => setTimeout(r, 250)); if (document.querySelector('button[aria-label^="Stop the running"]')) break } await new Promise(r => setTimeout(r, 4000)) })()`)
    return drive.evaluate(settingsRows)
  })
  await drive.capture('press it anyway', () => drive.evaluate(`(async () => {
    const button = document.querySelector('.lc-worktreerow button')
    if (!button) return 'no button'
    const before = button.innerText.trim() + ' disabled=' + button.disabled
    button.click()
    await new Promise(r => setTimeout(r, 800))
    return before + ' -> rows after: ' + [...document.querySelectorAll('.lc-worktreerow')].map(r => r.innerText.replace(/\\s+/g, ' ')).join(' | ')
  })()`))
  await drive.capture('wait for the run to finish', () => drive.evaluate(`(async () => {
    // Settings is on screen, so there is no Stop button to watch; the
    // teammate's own row says when the run is over.
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const wren = [...document.querySelectorAll('.lc-teammate')].find(r => /Wren/.test(r.innerText))
      if (wren && /idle|done|failed/i.test(wren.innerText) && !/working|thinking|running|starting|replying|listening/i.test(wren.innerText)) break
    }
    await new Promise(r => setTimeout(r, 2500))
    return 'finished; sidebar: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 160)
  })()`))
  await drive.capture('Settings after: Remove is offered', () => drive.evaluate(settingsRows))
  await drive.capture('Remove it', () => drive.evaluate(`(async () => {
    const button = [...document.querySelectorAll('.lc-worktreerow button')].find(b => b.innerText.trim() === 'Remove')
    if (!button) return 'no Remove'
    button.click()
    for (let i = 0; i < 40; i += 1) { await new Promise(r => setTimeout(r, 250)); if (!document.querySelector('.lc-worktreerow')) break }
    return ([...document.querySelectorAll('.lc-policyrow')].find(p => /OWN BRANCHES/.test(p.textContent))?.innerText.replace(/\\s+/g, ' ').slice(0, 200) ?? 'no own-branches row') + ' || sidebar: ' + document.querySelector('.lc-sidebar').innerText.replace(/\\s+/g, ' ').slice(0, 120)
  })()`))
  const branches = await git(['branch', '--list', 'locust/*'], workspace).catch(() => '')
  const trees = await git(['worktree', 'list', '--porcelain'], workspace).catch(() => '')
  drive.record.push({ step: drive.record.length + 1, title: 'git after Remove', note: `branches: ${branches.trim().replace(/\s+/g, ' ')} · worktrees mention tm_wren: ${String(/tm_wren/.test(trees.replace(/\\/g, '/')))}`, errors: [] })
  await drive.capture('message Wren again: the tree comes back', async () => {
    await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren').click(); await new Promise(r => setTimeout(r, 500)) })()`)
    return drive.evaluate(sendAndWaitScript('Reply with the single word READY. Do not read or edit any files.'))
  })
  await drive.capture('Settings once more', () => drive.evaluate(settingsRows))
  const treesAfter = await git(['worktree', 'list', '--porcelain'], workspace).catch(() => '')
  drive.record.push({ step: drive.record.length + 1, title: 'git after the new run', note: `worktrees mention tm_wren: ${String(/tm_wren/.test(treesAfter.replace(/\\/g, '/')))} · branch list: ${(await git(['branch', '--list', 'locust/*'], workspace).catch(() => '')).trim()}`, errors: [] })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren with Own branch on, free OpenCode model. Remove tried during a run, then after; then a new run.' })
}
