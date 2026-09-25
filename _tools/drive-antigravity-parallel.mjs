// When one Antigravity step opens several tool calls, which result is whose?
//
//   node _tools/drive-antigravity-parallel.mjs [--exe <packaged Locust.exe>] [--tag <label>]
//
// A B4 lead from the code review: a transcript's `GENERIC` result line names
// no tool and carries no id, and the normalizer attaches each result to the
// most recently opened call (`openTools.pop()`). If a planner step opens two
// calls and the results come back in call order, that swaps them. Colin's own
// transcripts held exactly one such step in 44 conversations -- two calls,
// ONE result line -- which cannot say which way it goes.
//
// So this makes its own. Two files, each holding a marker that exists nowhere
// else, and a prompt asking for both reads in the same step. What is recorded:
// the raw transcript's shape for that turn (this drive's own files, nothing
// of Colin's), and which marker Locust attached to which call.

import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { pickRouteScript, say, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

// Antigravity runs only in a folder it has opened itself; this is the one the
// smoke uses. The two files are removed again at the end.
const workspace = 'C:/Users/<home>/Documents/antigravtest'
const FILES = [
  { name: 'agy-alpha.txt', marker: 'ALPHA-MARKER-5170' },
  { name: 'agy-bravo.txt', marker: 'BRAVO-MARKER-8823' }
]
for (const file of FILES) await writeFile(join(workspace, file.name), `${file.marker}\n`, 'utf8')
const startedAt = Date.now()

const drive = await startDrive({
  name: 'antigravity-parallel',
  port: 9357,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Custom', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const markerIn = (text) => FILES.find((f) => text.includes(f.marker))?.name ?? 'neither'

try {
  await drive.capture('Antigravity / flash', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { ${teammateFace('Gem')}?.click(); await new Promise((r) => setTimeout(r, 1000)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/antigravity/i', search: 'flash', row: '/flash/i' }))
  })

  await drive.capture('asked for both files in one step', () => drive.evaluate(sendAndWaitScript(
    `In a single step, call your file-viewing tool twice at once: once on ${FILES[0].name} and once on ${FILES[1].name}. Do not read them one after the other. Then reply with each file's contents, labelled by file name.`,
    { waitSeconds: 180 }
  )))

  await drive.capture('what Locust attached to each call', async () => {
    const dir = join(drive.profile, 'mission-ledger')
    const names = await readdir(dir).catch(() => [])
    const text = (await Promise.all(names.map((n) => readFile(join(dir, n), 'utf8').catch(() => '')))).join('\n')
    const rows = []
    for (const line of text.split('\n')) {
      if (!line.includes('"tool.completed"')) continue
      const payload = JSON.parse(line).event?.payload ?? {}
      rows.push(`${payload.itemId} ${payload.name} [${String(payload.command ?? '').slice(-40)}] -> output holds ${markerIn(String(payload.output ?? ''))}`)
    }
    return rows.length === 0 ? 'no tool.completed in the ledger' : rows.join(' // ')
  })

  await drive.capture('the transcript this turn wrote (shape only)', async () => {
    const root = join(homedir(), '.gemini', 'antigravity', 'brain')
    let newest
    for (const id of await readdir(root)) {
      const file = join(root, id, '.system_generated', 'logs', 'transcript.jsonl')
      const info = await stat(file).catch(() => undefined)
      if (info && info.mtimeMs >= startedAt && (!newest || info.mtimeMs > newest.mtime)) newest = { file, mtime: info.mtimeMs }
    }
    if (!newest) return 'no transcript written since the drive started'
    const lines = (await readFile(newest.file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
    return lines
      .filter((l) => l.type === 'PLANNER_RESPONSE' || l.type === 'GENERIC')
      .map((l) => l.type === 'GENERIC'
        ? `#${l.step_index} GENERIC holds ${markerIn(String(l.content ?? ''))}${FILES.every((f) => String(l.content ?? '').includes(f.marker)) ? ' (BOTH)' : ''}`
        : `#${l.step_index} PLANNER ${(l.tool_calls ?? []).map((c) => `${c.name}(${JSON.stringify(c.args ?? {}).match(/agy-(alpha|bravo)/)?.[0] ?? '?'})`).join(' + ') || 'answer'}`)
      .join(' // ')
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `One Antigravity step asked to open two file reads at once, in ${workspace}. ${FILES.map((f) => `${f.name} holds ${f.marker}`).join('; ')}; each marker exists nowhere else, so a result's marker says which call it answers.`
  })
  for (const file of FILES) await rm(join(workspace, file.name), { force: true })
}
