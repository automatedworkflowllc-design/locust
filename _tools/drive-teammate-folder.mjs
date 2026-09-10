// Does a teammate with its own folder actually stand in it?
//
//   LOCUST_SPEND=1 node _tools/drive-teammate-folder.mjs
//
// Colin, 2026-09-09: "just double checking it should only change the folder
// for that chat/teammate not the entire app."
//
// The feature is one line deep -- `peerContextFor` sets the cwd -- and one
// line is exactly the kind of thing that typechecks, passes its unit tests
// and is wrong on screen. So this asks a real teammate to read a file that
// exists in ITS folder and nowhere else. A run that answers with the token
// stood where it was told to; a run that says the file is missing stood in
// the project folder, whatever the record says.
//
// The app is NOT switched: the project folder is the one the drive opened
// with, and it stays. That is the half of the claim that matters -- nothing
// reopened, nothing was rebound, and one teammate moved.
//
// SPENDS: one short Claude Code turn on sonnet at low effort. It reads one
// file and writes nothing.

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { say, scratchRepository, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends a Claude Code turn. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-folder-project-')
// The other folder, and the only place the token exists.
const elsewhere = await mkdtemp(join(tmpdir(), 'locust-folder-elsewhere-'))
const TOKEN = 'ELSEWHERE-4417-OK'
await writeFile(join(elsewhere, 'WHERE-AM-I.txt'), `${TOKEN}\n`, 'utf8')
await writeFile(join(elsewhere, 'LOCUST.md'), 'Keep answers to one paragraph.\n', 'utf8')

const drive = await startDrive({
  name: 'teammate-folder',
  port: 9458,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        folder: elsewhere,
        route: { runtime: 'claude', model: 'sonnet', mode: 'auto', effort: 'low' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})

try {
  await drive.capture('launch, with the project folder unchanged', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => {
      [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()
      await new Promise(r => setTimeout(r, 700))
      return 'mode: ' + ([...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Permission mode')?.innerText.replace(/\\s+/g, ' ').trim() ?? 'none')
    })()`)
  })

  // The premises, OUTSIDE capture(), because a thrown premise inside one is
  // recorded as a note and walked past.
  const mode = String(await drive.evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === 'Permission mode')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
  if (!/auto/i.test(mode)) throw new Error(`NOT A FOLDER TEST: the composer is in "${mode}", and only Auto may read a file`)
  say(`  mode is ${mode}`)

  await drive.capture('ask it to read a file that exists only in its own folder', () => drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Read the file WHERE-AM-I.txt in the folder you are standing in and reply with its contents and nothing else. If it is not there, reply exactly: NOT HERE.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    field.form.requestSubmit()
    for (let i = 0; i < 360; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      if (i > 8 && !document.querySelector('button[aria-label^="Stop the running"]')) break
    }
    await new Promise(r => setTimeout(r, 1500))
    return (document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-500) ?? 'no thread')
  })()`))

  // The reading that decides it, taken from the page rather than from the
  // step's note, so the answer cannot be a sentence about the answer.
  const thread = String(await drive.evaluate(`document.querySelector('.lc-thread')?.innerText ?? ''`))
  say(thread.includes(TOKEN)
    ? `  STOOD IN ITS OWN FOLDER: the thread carries ${TOKEN}`
    : `  DID NOT: the token is absent, so the run did not stand in ${elsewhere}`)

  await drive.capture('and the dialog says which folder it is', () => drive.evaluate(`(async () => {
    const rail = [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))
    if (!rail) return 'no rail button'
    const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 200 })
    rail.dispatchEvent(event)
    await new Promise(r => setTimeout(r, 400))
    const edit = [...document.querySelectorAll('.lc-context__label')].find(n => n.innerText.trim() === 'Edit')
    if (!edit) return 'no Edit item: ' + [...document.querySelectorAll('.lc-context__label')].map(n => n.innerText.trim()).join('|')
    edit.click()
    await new Promise(r => setTimeout(r, 500))
    const row = document.querySelector('.lc-field--folder')
    return row === null ? 'no folder row in the dialog' : row.innerText.replace(/\\s+/g, ' ').trim().slice(0, 220)
  })()`))
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: `Build: whatever \`pnpm build\` last wrote to out/. The project folder is ${workspace}; Wren's own folder is ${elsewhere}, and WHERE-AM-I.txt exists only there. Nothing was switched and nothing reopened.`
  })
}
