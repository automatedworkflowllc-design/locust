// Colin's 2026-09-06 failure, reproduced: Cursor Agent, grok 4.6, an effort
// picked, Accept edits. Before 0.34.1 the run died at once with "That
// runtime cannot be started with the options chosen" because the renderer
// sent the variant id AND the effort, and Cursor's builder refuses any
// effort. Spends one short Cursor run on grok 4.6 at its lowest effort.
//
//   node _tools/drive-cursor-effort.mjs

import { pickRouteScript, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-cursor-effort-ws-')
const drive = await startDrive({
  name: 'cursor-effort',
  port: 9309,
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
  await drive.capture('Wren: choose Cursor Agent / grok 4.6, then pick an effort', async () => {
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 500)) })()`)
    const route = await drive.evaluate(pickRouteScript({ group: '/cursor/i', search: 'grok-4.6', row: '/grok-4.6/i' }))
    const effort = await drive.evaluate(`(async () => {
      const control = document.querySelector('button[title="Reasoning effort"]')
      if (!control) return 'no effort control: ' + ([...document.querySelectorAll('.lc-control--boxed')].map(b => b.innerText).join(' | '))
      control.click(); await new Promise(r => setTimeout(r, 300))
      const items = [...document.querySelectorAll('[role=menuitemradio]')].map(b => b.innerText.trim())
      const pick = [...document.querySelectorAll('[role=menuitemradio]')].find(b => /^low$/i.test(b.innerText.trim())) ?? document.querySelector('[role=menuitemradio]')
      pick?.click(); await new Promise(r => setTimeout(r, 300))
      return 'offered: ' + items.join(', ') + ' || chip: ' + control.innerText.replace(/[ \\t\\n]+/g, ' ').trim()
    })()`)
    return route + ' || ' + effort
  })
  await drive.capture('send one line and wait; the failure card or the reply', async () => {
    await drive.evaluate(sendAndWaitScript('Reply with exactly one word: ready. Use no tools.', { waitSeconds: 240 }))
    return drive.evaluate(`(async () => {
      await new Promise(r => setTimeout(r, 800))
      const thread = document.querySelector('.lc-thread')?.innerText.replace(/[ \\t\\n]+/g, ' ') ?? ''
      const failed = /could not continue|cannot be started/.test(thread)
      return (failed ? 'FAILED: ' : 'ran: ') + thread.slice(-260)
    })()`)
  })
  // A SECOND turn, which is the case Colin actually hit on 2026-09-07 and the
  // one turn above cannot reach. By now the route's model has been RESOLVED to
  // the variant (`cursor-grok-4.6-medium`), and `startRoute` used to look a
  // family up by id alone -- so on the follow-up no family matched, the effort
  // travelled beside the model, and Cursor refused: "That runtime cannot be
  // started with the options chosen. Cursor Agent takes no effort level."
  await drive.capture('a SECOND turn, now that the model id IS a variant', async () => {
    await drive.evaluate(sendAndWaitScript('Reply with exactly one word: again. Use no tools.', { waitSeconds: 240 }))
    return drive.evaluate(`(async () => {
      await new Promise(r => setTimeout(r, 800))
      // Whitespace collapsed by split/join rather than a regex: an escape in
      // here has to survive both this file and the CDP template literal, and
      // a bare newline inside a regex literal is a syntax error at the far end.
      // Whitespace collapsed without any escape sequence: one has to survive
      // both this file and the CDP template literal, and a bare newline inside
      // a regex literal is a syntax error at the far end (measured, this file).
      const thread = (document.querySelector('.lc-thread')?.innerText ?? '').split(String.fromCharCode(10)).join(' ')
      const refused = /takes no effort level|cannot be started with the options/.test(thread)
      return (refused ? 'REFUSED ON THE FOLLOW-UP: ' : 'ran: ') + thread.slice(-260)
    })()`)
  })
  await drive.capture('the header: which model and effort the record says', () => drive.evaluate(`(document.querySelector('.lc-workroom__header')?.innerText.replace(/[ \\t\\n]+/g, ' ').slice(0, 200) ?? '')`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. Wren on Cursor Agent / grok 4.6 with an effort picked, Accept edits -- the case Colin hit on 2026-09-06.' })
}
