// Claude Code's own commands are in the / menu BEFORE any turn (0.694). Spends nothing.
//
//   node _tools/drive-claude-commands-before-a-turn.mjs [--packaged <exe>]
//
// Claude Code 2.1.29x announces nothing until its client says hello: every launch logged "Claude Code did
// not list its commands in time", and a Claude teammate's / menu held Locust's commands only until a turn
// had run. Locust now sends the SDK's `initialize` handshake. The menu is read as COUNTS and the group
// names only: a person's own commands and skills are theirs, and their names stay out of the record.
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { say, sleep, startDrive, openTeammateScript } from './drive-lib.mjs'

const packaged = process.argv.includes('--packaged') ? process.argv[process.argv.indexOf('--packaged') + 1] : undefined
const workspace = await mkdtemp(join(tmpdir(), 'locust-drive-claude-cmds-ws-'))
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'claude-commands-before-a-turn', port: 9811, workspace, sendsNothing: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_ada', name: 'Ada', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { runtime: 'claude', model: 'haiku', mode: 'ask' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
try {
  await drive.ready()
  await drive.evaluate(openTeammateScript('Ada'))
  // Discovery, then the listing: a few seconds on a quiet machine.
  let seen = { groups: [], rows: 0, claude: 0 }
  for (let i = 0; i < 30; i += 1) {
    seen = await drive.evaluate(`(async () => {
      const field = document.querySelector('form.command-dock textarea')
      field.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(field, '/')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
      const groups = [...document.querySelectorAll('.lc-slash .lc-slash__group')]
      const claude = groups.find((g) => /Claude/i.test(g.textContent))
      const claudeRows = claude === undefined ? 0 : (() => {
        let count = 0
        for (let node = claude.nextElementSibling; node && !node.classList.contains('lc-slash__group'); node = node.nextElementSibling) if (node.classList.contains('lc-slash__item')) count += 1
        return count
      })()
      setter.call(field, '')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      return { groups: groups.map((g) => g.textContent.trim()), rows: document.querySelectorAll('.lc-slash .lc-slash__item').length, claude: claudeRows }
    })()`)
    if (seen.claude > 0) break
    await sleep(2_000)
  }
  say(`  menu groups: ${JSON.stringify(seen.groups)}; Claude Code rows: ${String(seen.claude)}`)
  // Control (2026-10-07): the same drive on 0.693 reads 0 rows after a minute; on 0.694, 46.
  check("before any turn, the / menu lists Claude Code's own commands", seen.claude > 0, JSON.stringify(seen))
} catch (error) {
  failures += 1
  say(`[FAIL] the drive stopped: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: "Claude Code's commands in the / menu before any turn (0.694). Counts only." })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
