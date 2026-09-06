// Three teammates at once, each on its OWN worktree.
//
//   node _tools/drive-worktree-concurrent.mjs
//
// The shared-folder drives found what the app cannot know: when two runs write
// to one folder, a before/after reading of the tree names nobody, so each
// receipt now says so and counts the folder's change against nobody
// (0.36.2, 0.36.3). Worktrees are the app's own answer to that problem -- the
// teammate flag's comment says it in as many words, "so two teammates editing
// one repository do not collide" -- and it had never been driven with more
// than one teammate running.
//
// So: the same three teammates, the same three files, every one of them on
// its own branch. What should happen if the feature works is the exact
// opposite of the shared case:
//
//   - each run reports ITS file, with a real diff stat, attributed to it
//   - no run says the folder was shared, because for it no folder was
//   - each worktree holds its own file and neither of the others'
//
// A pass here is what makes "give concurrent teammates worktrees" honest
// advice rather than a guess.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const WORDS = { Wren: 'ALMANAC', Booty: 'BRAMBLE', Gem: 'CINDER' }
const workspace = await scratchRepository('locust-drive-worktree-ws-')

const drive = await startDrive({
  name: 'worktree-concurrent',
  port: 9316,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', worktree: true, createdAt: '2026-09-05T05:00:00.000Z' },
      { teammateId: 'tm_booty', name: 'Booty', hue: 'violet', role: 'Docs & QA', worktree: true, createdAt: '2026-09-05T05:00:01.000Z' },
      { teammateId: 'tm_gem', name: 'Gem', hue: 'clay', role: 'Research & Briefs', worktree: true, createdAt: '2026-09-05T05:00:02.000Z' }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const startFor = async (name) => {
  await drive.evaluate(`(async () => {
    [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === 'Message ${name}').click()
    await new Promise(r => setTimeout(r, 350))
  })()`)
  await drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'muse', row: '/muse/i' }))
  return drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Write a 40-line poem about locusts into a file named ${WORDS[name]}.txt, then reply with exactly the word ${WORDS[name]} and nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    await new Promise(r => setTimeout(r, 300))
    return 'sent to ${name}'
  })()`)
}

/** The fold line and any host notice, for one teammate. */
const receiptFor = (name) => drive.evaluate(`(async () => {
  const row = [...document.querySelectorAll('.lc-teammate')].find(r => new RegExp('^' + ${JSON.stringify(name)}).test(r.innerText.trim()))
  row?.querySelector('.lc-teammate__mission')?.click()
  await new Promise(r => setTimeout(r, 1200))
  const thread = document.querySelector('.lc-thread')?.innerText ?? ''
  const shared = /cannot be told apart/.test(thread) ? 'SAYS SHARED' : 'no shared notice'
  const fold = thread.split(String.fromCharCode(10)).find(t => /tool call/.test(t)) ?? 'no fold line'
  // The failure card, when there is one: which teammate lost the race, and why.
  const why = thread.split(String.fromCharCode(10)).find(t => /could not continue|permission requested|ended without/.test(t))
  if (why !== undefined) return ${JSON.stringify(name)} + ': FAILED -- ' + why.trim().slice(0, 160)
  return ${JSON.stringify(name)} + ': ' + fold.trim() + ' | ' + shared
})()`)

try {
  await drive.ready()
  const rostered = await drive.evaluate(`document.querySelectorAll('.lc-teammate').length`)
  if (Number(rostered) !== 3) throw new Error(`roster holds ${String(rostered)} teammates, not 3`)

  await drive.capture('three teammates, each on its own branch', () => `roster: ${String(rostered)} teammates, all with worktree: true`)

  await drive.capture('all three started, none waiting', async () => {
    const said = []
    for (const name of Object.keys(WORDS)) said.push(await startFor(name))
    return said.join(' || ')
  })

  await drive.capture('peak working at once', () => drive.evaluate(`(async () => {
    let peak = 0
    for (let i = 0; i < 240; i += 1) {
      await new Promise(r => setTimeout(r, 400))
      const working = [...document.querySelectorAll('.lc-teammate')].filter(r => !/idle/.test(r.innerText)).length
      if (working > peak) peak = working
      if (peak > 0 && working === 0) break
    }
    return 'peak working at once: ' + String(peak)
  })()`))

  await drive.capture('what each receipt says, and whether any claims a shared folder', async () => {
    const said = []
    for (const name of Object.keys(WORDS)) said.push(await receiptFor(name))
    return said.join(' || ')
  })

  await drive.capture('what is in each worktree on disk', async () => {
    const root = join(workspace, '.locust', 'worktrees')
    let trees
    try {
      trees = await readdir(root)
    } catch {
      return 'no .locust/worktrees directory -- the teammates ran in the folder itself'
    }
    const seen = []
    for (const tree of trees) {
      const files = (await readdir(join(root, tree)).catch(() => [])).filter((name) => name.endsWith('.txt'))
      seen.push(`${tree}: ${files.length === 0 ? 'no .txt' : files.join(',')}`)
    }
    const loose = (await readdir(workspace)).filter((name) => name.endsWith('.txt'))
    return `${seen.join(' | ')} || loose in the folder itself: ${loose.length === 0 ? 'none' : loose.join(',')}`
  })
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. Three teammates on the free OpenCode model, each with its own worktree, all started without waiting.'
  })
}
