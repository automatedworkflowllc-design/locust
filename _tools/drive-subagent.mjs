// A runtime spawns its own helper, and a person sees it as a row.
//
//   node _tools/drive-subagent.mjs
//
// Wren on Claude Code / sonnet, read-only, asked to use a subagent (its
// Task tool) for a small job. Until now the helper row was proven only
// against a seeded ledger; this is the first time a live helper is
// watched arriving. Spends one short Claude Code run with one subagent.

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-subagent-ws-')
const drive = await startDrive({
  name: 'subagent',
  port: 9302,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})

try {
  await drive.capture('launch', () => drive.ready())
  await drive.capture('Wren: choose Claude Code / sonnet, read-only', async () => {
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message Wren').click(); await new Promise(r => setTimeout(r, 500)) })()`)
    const route = await drive.evaluate(pickRouteScript({ group: '/claude/i', search: 'sonnet', row: '/^sonnet/i' }))
    const mode = await drive.evaluate(`(async () => {
      const control = document.querySelector('button[aria-label="Permission mode"], button[title="Permission mode"]')
      control.click(); await new Promise(r => setTimeout(r, 300))
      ;[...document.querySelectorAll('[role=menuitemradio]')].find(b => /^Ask\\b/.test(b.innerText.trim()))?.click()
      await new Promise(r => setTimeout(r, 300))
      return control.innerText.replace(/\\s+/g, ' ').trim()
    })()`)
    return route + ' || mode: ' + mode
  })
  await drive.capture('ask for a subagent; the picture is taken the moment the sidebar says a subagent is working', async () => {
    await drive.evaluate(sendAndWaitScript('Use a subagent (your Task tool) to count the lines in README.md and report the number to you. Then reply with one sentence giving that number. Do not edit anything.', { settle: false }))
    return drive.evaluate(`(async () => {
      const seen = []
      for (let i = 0; i < 240; i += 1) {
        await new Promise(r => setTimeout(r, 250))
        const wren = [...document.querySelectorAll('.lc-teammate')].find(r => /Wren/.test(r.innerText))
        const line = wren ? wren.innerText.replace(/\\s+/g, ' ').slice(0, 60) : ''
        if (seen[seen.length - 1] !== line) seen.push(line)
        if (/subagent working/.test(line)) return 'sidebar until now: ' + seen.join(' -> ') + ' || glyph: ' + (wren.querySelector('.lc-teammate__delegating') ? 'drawn' : 'MISSING')
        if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'never said subagent working: ' + seen.join(' -> ')
      }
      return 'timed out: ' + seen.join(' -> ')
    })()`)
  })
  await drive.capture('the sidebar until the run settles', () => drive.evaluate(`(async () => {
    const seen = []
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const wren = [...document.querySelectorAll('.lc-teammate')].find(r => /Wren/.test(r.innerText))
      const line = wren ? wren.innerText.replace(/\\s+/g, ' ').slice(0, 60) : ''
      if (seen[seen.length - 1] !== line) seen.push(line)
      if (i > 2 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    return 'sidebar over time: ' + seen.join(' -> ')
  })()`))
  await drive.capture('the reply, and the activity fold opened', () => drive.evaluate(`(async () => {
    await new Promise(r => setTimeout(r, 800))
    const fold = document.querySelector('.lc-activity')
    if (!fold) return 'no activity fold: ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-200) ?? '')
    const summary = fold.innerText.replace(/\\s+/g, ' ').slice(0, 100)
    fold.click()
    await new Promise(r => setTimeout(r, 300))
    return summary + ' || ' + [...document.querySelectorAll('.lc-filerow')].map(r => (r.classList.contains('is-helper') ? '[helper] ' : '') + r.innerText.replace(/\\s+/g, ' ').trim()).join(' | ').slice(0, 400)
  })()`))
  await drive.capture('the header and the last words', () => drive.evaluate(`(document.querySelector('.lc-workroom__header')?.innerText.replace(/\\s+/g, ' ').slice(0, 160) ?? '') + ' || ' + (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-240) ?? '')`))
  await drive.capture('the route chip tooltip and the Settings row: the usage window', () => drive.evaluate(`(async () => {
    const chip = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    const tooltip = chip?.title ?? 'no chip'
    document.querySelector('button[title="Settings (Ctrl 3)"]').click()
    await new Promise(r => setTimeout(r, 900))
    const heading = [...document.querySelectorAll('.lc-settings__heading')].find(h => /Runtimes/.test(h.textContent))
    heading?.scrollIntoView({ block: 'start' })
    await new Promise(r => setTimeout(r, 300))
    const row = [...document.querySelectorAll('.lc-runtimerow')].find(r => /Claude Code/.test(r.innerText))
    return 'chip title: ' + tooltip.replace(/\\s+/g, ' ') + ' || Claude row: ' + (row?.innerText.replace(/\\s+/g, ' ').slice(0, 220) ?? 'none')
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on Claude Code / sonnet, read-only, asked to use a subagent.' })
}
