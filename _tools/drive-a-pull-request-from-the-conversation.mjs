// Open a pull request from the conversation, for real (0.680).
//
//   node _tools/drive-a-pull-request-from-the-conversation.mjs --repo <a clone of a THROWAWAY GitHub repo> [--packaged <exe>]
//
// The unit tests stand in for `gh`; this one does not: it opens a real pull request on GitHub, so it only ever
// runs on a throwaway repository named with --repo (2026-10-06: a private automatedworkflowllc-design/locust-pr-test,
// made for it). Wren, on the free model in Ask, says one word so there is a conversation; the drive adds a file;
// Commit offers "Open a pull request"; pressed, it commits on a new locust/<subject> branch, pushes, and GitHub has
// the pull request against main -- while main, locally and on GitHub, is where it was. The drive closes the pull
// request afterwards. Spends nothing.

import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, git, openTeammateScript, recordRoot, say, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const workspace = arg('--repo')
if (workspace === undefined) { say('--repo <a clone of a throwaway GitHub repository> is required'); process.exit(1) }
const gh = (args) => new Promise((resolve, reject) => execFile('gh', args, { cwd: workspace, windowsHide: true }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr))) : resolve(String(stdout)))))
const tag = packaged === undefined ? 'local' : 'packaged'
const mainBefore = String(await git(['rev-parse', 'origin/main'], workspace)).trim()

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-pull-request-${tag}`, port: 9813, workspace,
  outPath: join(recordRoot('a-pull-request-from-the-conversation-2026-10-06'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-06T00:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }],
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
    actions: [...(box?.querySelectorAll('.lc-commit__actions button') ?? [])].map((b) => b.innerText.trim()),
    note: box?.querySelector('.lc-commit__note')?.innerText ?? '',
    said: [...(box?.querySelectorAll('.lc-commit__said') ?? [])].map((p) => p.innerText.trim()).join(' '),
    link: box?.querySelector('.lc-commit__link')?.innerText ?? ''
  })
})()`
let url
try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1200, 820)
  say(`  ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  await drive.evaluate(sendAndWaitScript('Add a file called hello.md that says hello.', { waitSeconds: 240 }))
  // Ask writes nothing, so the change is the drive's own: what the pull request carries is known exactly.
  await writeFile(join(workspace, 'hello.md'), '# Hello\n\nFrom a Locust drive, to test Open a pull request.\n', 'utf8')
  await drive.evaluate(`window.dispatchEvent(new Event('focus'))`)
  await sleep(2500)
  await drive.evaluate(`[...document.querySelectorAll('.lc-workroom__actions button')].find((b) => b.innerText.trim() === 'Commit')?.click()`)
  await sleep(2500)
  const opened = JSON.parse(String(await drive.capture('Commit, open: a pull request offered', () => drive.evaluate(panel))))
  check('a GitHub folder with gh signed in is offered a pull request', opened.actions.includes('Open a pull request'), JSON.stringify(opened.actions))
  check('it says main stays where it is', /goes from a new branch; main stays where it is/.test(opened.note), opened.note)
  await drive.evaluate(`[...document.querySelectorAll('.lc-commit__actions button')].find((b) => b.innerText.trim() === 'Open a pull request')?.click()`)
  let after = opened
  for (let i = 0; i < 120; i += 1) {
    await sleep(500)
    after = JSON.parse(String(await drive.evaluate(panel)))
    if (after.actions.includes('Done') || after.actions.includes('Back')) break
  }
  await drive.capture('The pull request, opened', () => drive.evaluate(panel))
  say(`  said: ${after.said}`)
  check('it says it committed on a new branch, pushed, and opened the pull request', /Committed 1 file to locust\/[a-z0-9-]+ as [0-9a-f]{7}\. Your folder is on locust\/[a-z0-9-]+ now\. Pushed to origin\./.test(after.said) && /Pull request opened:/.test(after.said), after.said)
  const branch = String(await git(['symbolic-ref', '--short', 'HEAD'], workspace)).trim()
  const pr = JSON.parse(await gh(['pr', 'view', branch, '--json', 'url,state,baseRefName,headRefName,files']))
  url = pr.url
  check('GitHub has it: open, onto main, carrying hello.md', pr.state === 'OPEN' && pr.baseRefName === 'main' && pr.headRefName === branch && pr.files.map((f) => f.path).join() === 'hello.md', JSON.stringify(pr))
  check('the link shown is that pull request', url.endsWith(after.link), `${after.link} | ${url}`)
  await git(['fetch', '-q', 'origin'], workspace)
  check('main is where it was, locally and on GitHub', String(await git(['rev-parse', 'main'], workspace)).trim() === mainBefore && String(await git(['rev-parse', 'origin/main'], workspace)).trim() === mainBefore, mainBefore)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  if (url !== undefined) await gh(['pr', 'close', url, '--comment', 'Closed by the drive that opened it.']).then(() => say(`  closed ${url}`), (error) => say(`  could not close ${url}: ${error.message}`))
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. A real pull request on a throwaway repository, from Commit.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
