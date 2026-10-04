// Does a command row say what the teammate was DOING?
//
//   node _tools/probe-command-row-says-why.mjs
//
// Colin, 2026-09-09, showing Claude Code's own transcript: the rows there
// read "Checked what the app says about the free route", not a grep
// pipeline. That is not derived from the command -- Claude Code's Bash tool
// takes a `description` beside it and the model writes one every call.
//
// Locust had the field arriving and drew the pipeline. OpenCode's bash tool
// carries the same field, and OpenCode is the free runtime, so this is the
// only way to see the feature work without spending anything.
//
// The command must still be reachable. It is the evidence of what ran on
// this machine; the sentence is a claim about it by the thing that ran it. A
// row may lead with the claim only while the evidence is one press away, so
// this checks BOTH -- the sentence on the row, and the command under it.
//
// FREE: one short run on the free OpenCode model, in accept-edits so it may
// actually run a command.

import { FREE_ROUTE, say, scratchRepository, startDrive, teammateFace } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-probe-cmdrow-ws-')
const drive = await startDrive({
  name: 'command-row',
  port: 9450,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('launch and ask for something that needs a command', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      ${teammateFace('Wren')}?.click()
      await new Promise(r => setTimeout(r, 600))
      const field = document.querySelector('form.command-dock textarea')
      if (!field) return 'no composer'
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, 'Use your bash tool to run exactly: ls -a . Then reply with the number of entries it printed and nothing else. You must run the command; do not answer from memory.')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
      field.form.requestSubmit()
      for (let i = 0; i < 300; i += 1) {
        await new Promise(r => setTimeout(r, 500))
        if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      await new Promise(r => setTimeout(r, 1500))
      return 'finished'
    })()`)
  })

  await drive.capture('open the activity fold', () => drive.evaluate(`(async () => {
    const fold = document.querySelector('.lc-activity')
    if (!fold) return 'no activity fold'
    // Only when it is not already open: since 0.49.0 a finished turn's fold
    // opens itself, and an unconditional click CLOSES it.
    if (fold.getAttribute('aria-expanded') !== 'true') fold.click()
    await new Promise(r => setTimeout(r, 500))
    // Every row, not only the shell ones: when the model answers without a
    // command there is nothing to read, and the useful thing to know then is
    // what it DID reach for -- including what OpenCode calls its shell tool.
    return 'shell rows: ' + document.querySelectorAll('.lc-filerow.is-shell').length +
      ' · all rows: ' + [...document.querySelectorAll('.lc-filerow')].map(r => r.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60)).join(' | ')
  })()`))

  /*
   * The premise, outside capture(): a run that used no command has no
   * command row, and every check below would pass by finding nothing. Free
   * models do not always reach for a tool, so this is a real possibility
   * and not a formality.
   */
  const rows = Number(await drive.evaluate(`document.querySelectorAll('.lc-filerow.is-shell').length`))
  if (rows < 1) throw new Error('NOT A COMMAND-ROW TEST: the run used no shell command, so there is no row to read')
  say(`  ${String(rows)} command row(s)`)

  await drive.capture('what each command row says', () => drive.evaluate(`(async () => {
    return [...document.querySelectorAll('.lc-filerow.is-shell')]
      .map(row => row.innerText.replace(/\\s+/g, ' ').trim().slice(0, 110))
      .join(' || ')
  })()`))

  await drive.capture('the command is still one press away', () => drive.evaluate(`(async () => {
    const row = [...document.querySelectorAll('.lc-filerow.is-shell')].find(r => r.tagName === 'BUTTON')
    if (!row) return 'no expandable command row -- the command printed nothing, so it is on the row itself'
    const before = document.querySelectorAll('.lc-shellcommand').length
    row.click()
    await new Promise(r => setTimeout(r, 500))
    const shown = [...document.querySelectorAll('.lc-shellcommand')].map(p => p.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80))
    return 'command blocks before: ' + before + ' · after opening: ' + shown.length + (shown.length ? ' · ' + shown.join(' | ') : '')
  })()`))
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on the free OpenCode model in accept-edits, asked for something that needs a shell command.' })
}
