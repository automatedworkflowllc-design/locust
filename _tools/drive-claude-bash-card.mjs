// What does Claude Code's own Bash request look like on its card?
//
//   LOCUST_SPEND=1 node _tools/drive-claude-bash-card.mjs [--packaged <exe>] [--tag <label>]
//
// Seen in the check-after-edits drive (2026-09-25): in Edit mode Claude Code
// asked to run `node check.js`, and the card said the input went "to the
// service the connector reaches" and that Locust "cannot undo what happens
// there" -- the connector card, about a command on this machine. Wren (Claude
// Haiku, Edit) is asked to run one harmless command; the card is read and
// approved.
//
// SPENDS: one short Claude Haiku turn.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `claude-bash-card-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Haiku turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-drive-bash-card-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  ...(outPath === undefined ? {} : { outPath }),
  name: 'claude-bash-card',
  port: 9325,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-25T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('Wren (Claude Haiku, Edit) is asked to run a command; the card', async () => {
    await drive.ready()
    await drive.evaluate(openTeammateScript('Wren'))
    return drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Run exactly this shell command with your Bash tool: node -e "console.log(41+1)"   Then reply with its output only.')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 120; i += 1) {
        await new Promise((r) => setTimeout(r, 250))
        const button = document.querySelector('button[aria-label="Start mission"]')
        if (button && !button.disabled) { button.click(); break }
      }
      let card = 'no card'
      for (let i = 0; i < 600; i += 1) {
        await new Promise((r) => setTimeout(r, 400))
        const approval = document.querySelector('[role=group][aria-label="Approval required"]')
        if (approval) {
          await new Promise((r) => setTimeout(r, 400))
          card = approval.innerText.split(/\\s+/).join(' ')
          const said = /connector/i.test(card) ? '[SAYS CONNECTOR] ' : '[NO CONNECTOR WORDING] '
          card = said + card.slice(0, 420)
          ;[...approval.querySelectorAll('button')].find((b) => /^Approve once/.test(b.innerText.trim()))?.click()
          break
        }
        if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      for (let i = 0; i < 240; i += 1) {
        await new Promise((r) => setTimeout(r, 500))
        if (!document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      return card + ' || thread: ' + (document.querySelector('.lc-thread')?.innerText ?? '').split(/\\s+/).join(' ').slice(-80)
    })()`)
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Wren on Claude Haiku, Edit mode, asked to run one command.` })
}
