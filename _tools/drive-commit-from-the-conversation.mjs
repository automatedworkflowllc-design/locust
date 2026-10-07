// Commit from the conversation (0.680).
//
//   node _tools/drive-commit-from-the-conversation.mjs [--packaged <exe>] [--tag <name>]
//
// A teammate that works in the folder itself left its changes uncommitted, and
// the person went to a terminal to commit them. 0.680 puts Commit in the
// conversation's header while the folder has something to commit. A scratch
// repository with a local "origin"; Wren, on the free model in Edit, adds a
// line to README.md, and the drive adds notes.md beside it. Then: Commit is in
// the header, it lists both files, its message starts with what was asked,
// Commit and push makes one commit as the person and sends it to origin, it
// says so, and the button leaves once the folder is clean. 0.679 has no
// Commit button. Spends nothing (the free model).

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, git, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const workspace = await scratchRepository('locust-drive-commit-ws-')
const bare = await mkdtemp(join(tmpdir(), 'locust-drive-commit-origin-'))
await git(['init', '-q', '--bare', '-b', 'main'], bare)
await git(['remote', 'add', 'origin', bare], workspace)
await git(['push', '-q', '-u', 'origin', 'main'], workspace)
const ASK = "Add one line at the end of README.md: 'Hello from Wren.' Change nothing else."

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `commit-from-the-conversation-${tag}`, port: 9811, workspace,
  outPath: join(recordRoot('commit-from-the-conversation-2026-10-06'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-06T00:00:00.000Z', route: { ...FREE_ROUTE, mode: 'accept-edits' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const panel = `(() => {
  const box = document.querySelector('.lc-commit')
  return JSON.stringify({
    button: [...document.querySelectorAll('.lc-workroom__actions button')].some((b) => b.innerText.trim() === 'Commit'),
    open: box !== null,
    title: box?.querySelector('.lc-commit__title')?.innerText ?? '',
    files: [...(box?.querySelectorAll('.lc-commit__path') ?? [])].map((p) => p.innerText.trim()),
    message: box?.querySelector('textarea')?.value ?? '',
    actions: [...(box?.querySelectorAll('.lc-commit__actions button') ?? [])].map((b) => b.innerText.trim()),
    said: [...(box?.querySelectorAll('.lc-commit__said') ?? [])].map((p) => p.innerText.trim()).join(' ')
  })
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1200, 820)
  say(`  ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  const sent = String(await drive.capture('Wren edits README.md', () => drive.evaluate(sendAndWaitScript(ASK, { waitSeconds: 300 }))))
  say(`  sent: ${sent.slice(0, 160)}`)
  const readme = String(await git(['diff', '--', 'README.md'], workspace))
  say(`  README.md ${readme.includes('Hello from Wren') ? 'has' : 'does not have'} the line`)
  await writeFile(join(workspace, 'notes.md'), 'A note beside the change.\n', 'utf8')
  // The window comes back into focus, which is when the header reads the folder again.
  await drive.evaluate(`window.dispatchEvent(new Event('focus'))`)
  await sleep(1500)
  const before = JSON.parse(String(await drive.evaluate(panel)))
  check('Commit is in the header while the folder has changes', before.button, JSON.stringify(before))
  await drive.evaluate(`[...document.querySelectorAll('.lc-workroom__actions button')].find((b) => b.innerText.trim() === 'Commit')?.click()`)
  await sleep(1200)
  const opened = JSON.parse(String(await drive.capture('Commit, open', () => drive.evaluate(panel))))
  const expected = readme.includes('Hello from Wren') ? ['README.md', 'notes.md'] : ['notes.md']
  check('it lists what a commit would take', JSON.stringify(opened.files) === JSON.stringify(expected), JSON.stringify(opened.files))
  check('its message starts with what was asked, and names Wren', opened.message.startsWith(ASK.slice(0, 40)) && /Locust-Teammate: Wren/.test(opened.message), opened.message)
  check('it offers Commit and Commit and push, and no pull request without GitHub', JSON.stringify(opened.actions) === JSON.stringify(['Commit', 'Commit and push']), JSON.stringify(opened.actions))
  const head = String(await git(['rev-parse', 'HEAD'], workspace)).trim()
  await drive.evaluate(`[...document.querySelectorAll('.lc-commit__actions button')].find((b) => b.innerText.trim() === 'Commit and push')?.click()`)
  let after
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    after = JSON.parse(String(await drive.evaluate(panel)))
    if (/Committed/.test(after.said) || after.said.length > 0 && after.actions.includes('Back')) break
  }
  await drive.capture('Committed and pushed', () => drive.evaluate(panel))
  check('it says it committed and pushed', new RegExp(`Committed ${String(expected.length)} files to main as [0-9a-f]{7}\\. Pushed to origin\\.`).test(after.said), after.said)
  const log = String(await git(['log', '--format=%H %an|%s', `${head}..HEAD`], workspace)).trim().split('\n').filter((line) => line.length > 0)
  check('one new commit, made as you', log.length === 1 && /Locust drive\|/.test(log[0]), JSON.stringify(log))
  const remote = String(await git(['rev-parse', 'main'], bare)).trim()
  check('origin has it', log.length === 1 && remote === String(await git(['rev-parse', 'HEAD'], workspace)).trim(), remote)
  check('the folder is clean', String(await git(['status', '--porcelain'], workspace)).trim() === '', String(await git(['status', '--porcelain'], workspace)))
  await drive.evaluate(`[...document.querySelectorAll('.lc-commit__actions button')].find((b) => b.innerText.trim() === 'Done')?.click()`)
  await sleep(800)
  const gone = JSON.parse(String(await drive.capture('Done: the button leaves', () => drive.evaluate(panel))))
  check('with nothing left to commit the button leaves', !gone.button && !gone.open, JSON.stringify(gone))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on the free model, Edit; Commit and push from the header.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
