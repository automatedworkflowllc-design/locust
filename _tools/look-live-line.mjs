// The live line of a running turn, filmed: what it says, second by second (0.569).
//
//   node _tools/look-live-line.mjs [--packaged <exe>] [--tag <name>] [--frames 12] [--every 1500]
//
// Colin, 2026-10-03, with four frames of Claude Code's new status line
// ("Reading pet removal in main and who calls it 40m 11s >", "Running a
// command", "Editing pet-library.ts"): "anything we can use from this taskbar
// setup to improve our current setup". A free OpenCode turn that reads a
// file, runs a slow command and writes a file, its live line read and
// pictured every `--every` ms, so the two can be compared on what each says
// while it works. Free OpenCode; nothing else is sent.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const frames = Number(arg('--frames') ?? '14')
const every = Number(arg('--every') ?? '1500')
const workspace = await scratchRepository('locust-look-live-ws-')
await writeFile(join(workspace, 'notes.txt'), 'Kiln fires Thursday.\nGlaze orders close at noon.\n', 'utf8')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `look-live-line-${tag}`,
  port: 9892,
  workspace,
  outPath: join(recordRoot('look-live-line-2026-10-03'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Custom', roleTitle: 'Studio', createdAt: '2026-10-03T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
const live = `JSON.stringify((() => {
  const row = [...document.querySelectorAll('.lc-livestep')].at(-1)
  return row === undefined ? null : { text: row.innerText.replace(/\\s+/g, ' ').trim(), register: row.dataset.register ?? '', kind: row.dataset.stepKind ?? '' }
})())`
try {
  await drive.ready()
  await drive.resize(1200, 760)
  await drive.evaluate(openTeammateScript('Gem'))
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, ${JSON.stringify('Read notes.txt. Then run this exact shell command: node -e "setTimeout(() => console.log(\'kiln ready\'), 6000)". Then write summary.txt with one line saying when the kiln fires. Then reply DONE.')})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return }
    }
  })()`)
  const seen = []
  for (let i = 0; i < frames; i += 1) {
    await sleep(every)
    const now = JSON.parse(String(await drive.capture(`live line, ${String(((i + 1) * every) / 1000)} s`, () => drive.evaluate(live))))
    seen.push(now)
    say(`  ${String(((i + 1) * every) / 1000).padStart(5)} s  ${now === null ? '(no live line)' : `[${now.register}/${now.kind}] ${now.text}`}`)
    if (now === null && i > 4) break
  }
} catch (error) {
  say(`look failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A free turn that reads, runs a 6 s command and writes; its live line every ${String(every)} ms.` })
}
