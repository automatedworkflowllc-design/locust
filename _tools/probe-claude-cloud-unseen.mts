// A real Claude cloud session started the way Locust starts one (0.556): in a
// terminal nobody sees, then a follow-up sent to it by id. Spends one small
// cloud session of the person's Claude plan.
//
//   npx tsx _tools/probe-claude-cloud-unseen.mts <git folder Claude Code trusts>

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createClaudeCloud } from '../apps/desktop/src/main/claude-cloud.ts'
import { runInPseudoTerminal } from '../apps/desktop/src/main/pseudo-terminal.ts'

const folder = process.argv[2]
if (folder === undefined) throw new Error('Give a folder.')
const where = 'C:\\Users\\<home>\\AppData\\Roaming\\npm\\claude.cmd'
const cloud = createClaudeCloud({
  discover: async () => [{ id: 'claude', executable: { discoveredPath: where, executablePath: where, prefixArgs: [] } }] as never,
  storePath: join(await mkdtemp(join(tmpdir(), 'locust-probe-cloud-')), 'claude-cloud.json'),
  terminal: runInPseudoTerminal
})
const began = Date.now()
const sent = await cloud.start(folder, 'Reply with the single word ok. Change nothing.')
console.log(`start (${String(Date.now() - began)} ms):`, JSON.stringify(sent))
if (!sent.ok || sent.session.sessionId === undefined) process.exit(1)
const more = await cloud.send(sent.session.id, 'Thanks, nothing more.')
console.log('follow-up:', JSON.stringify(more))
process.exit(more.ok ? 0 : 1)
