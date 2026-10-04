// A real Claude cloud session, read back the way Locust 0.558 reads one:
// started out of sight on Haiku, given time, then brought in with
// `claude --teleport <id> --worktree <name>` and its change shown. Spends one
// small cloud session of the person's Claude plan; it pushes a claude/ branch.
//
//   npx tsx _tools/probe-claude-cloud-read.mts <git folder Claude Code trusts> [seconds to wait] [--apply]
//   LOCUST_CLOUD_STORE=<claude-cloud.json> to re-read a session already started (no new spend).

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClaudeCloud } from '../apps/desktop/src/main/claude-cloud.ts'
import { runInPseudoTerminal } from '../apps/desktop/src/main/pseudo-terminal.ts'

const folder = process.argv[2]
if (folder === undefined) throw new Error('Give a folder.')
const wait = Number(process.argv[3] ?? '120')
const where = 'C:\\Users\\<home>\\AppData\\Roaming\\npm\\claude.cmd'
const storePath = process.env.LOCUST_CLOUD_STORE ?? join(await mkdtemp(join(tmpdir(), 'locust-probe-cloud-read-')), 'claude-cloud.json')
console.log('store:', storePath)
const cloud = createClaudeCloud({
  discover: async () => [{ id: 'claude', executable: { discoveredPath: where, executablePath: where, prefixArgs: [] } }] as never,
  storePath,
  terminal: async (run) => { const r = await runInPseudoTerminal(run); if (process.env.LOCUST_DRAWN !== undefined && r.ok) (await import('node:fs')).writeFileSync(process.env.LOCUST_DRAWN, r.drawn); (await import('node:fs')).writeFileSync((process.env.LOCUST_DRAWN ?? 'x') + '.run.json', JSON.stringify({ ...run, env: Object.fromEntries(Object.entries(run.env).map(([k, v]) => [k, v === undefined ? '<undefined>' : v])) }, null, 1)); return r }
})
let id = (await cloud.list(folder))[0]?.id
if (id === undefined) {
  const sent = await cloud.start(folder, 'Create a new file named cloud-read-check.txt containing the single line: read back by Locust. Commit it on your branch. Change nothing else and open no pull request.', undefined, { model: 'haiku', effort: 'low' })
  console.log('start:', JSON.stringify(sent))
  if (!sent.ok || sent.session.sessionId === undefined) process.exit(1)
  id = sent.session.id
  console.log(`waiting ${String(wait)} s for it to work`)
  await new Promise((done) => setTimeout(done, wait * 1000))
}
const began = Date.now()
const read = await cloud.check(id)
console.log(`check (${String(Date.now() - began)} ms):`, JSON.stringify(read, null, 1).slice(0, 4000))
if (process.argv.includes('--apply') && read.ok) console.log('apply:', JSON.stringify(await cloud.apply(id)))
