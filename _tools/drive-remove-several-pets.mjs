// Several pets taken out of the picker at once, and one brought back (0.569).
//
//   node _tools/drive-remove-several-pets.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-03: "some of them are too janky to even add more animations
// too, give me an option to delete some of them for now so i dont have to
// name them individually". Seeded: Robot and Dot as if downloaded before
// (drawn with Locust's own sheet), and Wren wearing Robot. In the look picker:
// Remove some..., tick Robot, Dot and Reaper, Remove 3. The three leave the
// picker; Dot's files go, Robot's stay for Wren's face, and the message says
// so; Show removed lists them, and picking Robot brings it back. Nothing is
// downloaded, though the picker reads the picks' small pictures; nothing sent.

import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APP_DIR, recordRoot, say, scratchRepository, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const SHEET = join(APP_DIR, 'resources', 'pets', 'hoodie-cat', 'spritesheet.webp')
const profilePath = await mkdtemp(join(process.env.LOCUST_SCRATCH ?? tmpdir(), 'locust-drive-remove-pets-'))
for (const [id, name] of [['robot', 'Robot'], ['dot', 'Dot']]) {
  await mkdir(join(profilePath, 'pets', id), { recursive: true })
  await copyFile(SHEET, join(profilePath, 'pets', id, 'spritesheet.webp'))
  await writeFile(join(profilePath, 'pets', id, 'pet.json'), JSON.stringify({ id, displayName: name, description: `${name}, for the drive.`, spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 }))
}
const workspace = await scratchRepository('locust-drive-remove-pets-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `remove-pets-${tag}`,
  port: 9891,
  workspace,
  profilePath,
  sendsNothing: true,
  outPath: join(recordRoot('remove-several-pets-2026-10-03'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Docs & QA', createdAt: '2026-10-03T01:00:00.000Z', avatar: { headwear: 1, accessory: 0, mouth: 0, bot: { shape: 'droid', face: 'eyes' }, pet: { source: 'gallery', id: 'robot' } } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off' }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const PETS = `document.querySelector('[role=group][aria-label="Pets"]')`
const read = `JSON.stringify({
  picks: [...${PETS}.querySelectorAll('[data-source="gallery"]')].filter((t) => t.dataset.removed !== 'yes').map((t) => t.dataset.pet),
  removedShown: [...${PETS}.querySelectorAll('[data-removed="yes"]')].map((t) => t.dataset.pet),
  captions: [...${PETS}.querySelectorAll('.lc-pets__caption')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim())
})`
const button = (text) => `[...${PETS}.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(text)})`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1300, 900)
  const before = JSON.parse(String(await drive.capture('New teammate: the Pets row', () => drive.evaluate(`(async () => {
    if (!document.querySelector('.lc-rostergrid')) document.querySelector('.lc-faces__team')?.click()
    await new Promise((r) => setTimeout(r, 900))
    document.querySelector('.lc-rostercard--new')?.click()
    await new Promise((r) => setTimeout(r, 1200))
    ${PETS}?.scrollIntoView({ block: 'center' })
    await new Promise((r) => setTimeout(r, 600))
    return ${read}
  })()`))))
  check('the picker offers all 21 picks to start', before.picks.length === 21, JSON.stringify(before.picks))
  const ticking = String(await drive.capture('Remove some..., three ticked', () => drive.evaluate(`(async () => {
    ${button('Remove some…')}?.click()
    await new Promise((r) => setTimeout(r, 400))
    for (const id of ['robot', 'dot', 'reaper']) ${PETS}.querySelector('[data-pet="' + id + '"]')?.click()
    await new Promise((r) => setTimeout(r, 300))
    return [...${PETS}.querySelectorAll('[aria-pressed=true]')].map((t) => t.dataset.pet).sort().join(',') + ' | ' + (${button('Remove 3')} ? 'Remove 3 offered' : 'no Remove 3')
  })()`)))
  check('ticking marks them, and the button counts them', ticking === 'dot,reaper,robot | Remove 3 offered', ticking)
  const after = JSON.parse(String(await drive.capture('Remove 3', () => drive.evaluate(`(async () => {
    ${button('Remove 3')}?.click()
    for (let i = 0; i < 40 && !${button('Remove some…')}; i += 1) await new Promise((r) => setTimeout(r, 250))
    await new Promise((r) => setTimeout(r, 500))
    return ${read}
  })()`))))
  check('the three leave the picker', after.picks.length === 18 && !after.picks.some((id) => ['robot', 'dot', 'reaper'].includes(id)), JSON.stringify(after.picks))
  const said = after.captions.join(' ')
  check('it says what it did, and that Robot stays on Wren', /Removed 3 pets from the picker/.test(said) && /Robot stays on Wren until they get another look/.test(said), said)
  check('Dot is gone from this computer; Robot, worn, is kept', !existsSync(join(drive.profile, 'pets', 'dot')) && existsSync(join(drive.profile, 'pets', 'robot')))
  const file = JSON.parse(await readFile(join(drive.profile, 'pets-removed.json'), 'utf8').catch(() => '{}'))
  check('the removals are kept in the profile', JSON.stringify(file.ids) === JSON.stringify(['robot', 'dot', 'reaper']), JSON.stringify(file))
  const shown = JSON.parse(String(await drive.capture('Show removed', () => drive.evaluate(`(async () => {
    ${button('Show removed')}?.click()
    await new Promise((r) => setTimeout(r, 400))
    return ${read}
  })()`))))
  check('Show removed lists them, faded', [...shown.removedShown].sort().join(',') === 'dot,reaper,robot', JSON.stringify(shown.removedShown))
  const back = JSON.parse(String(await drive.capture('Robot, picked again', () => drive.evaluate(`(async () => {
    ${PETS}.querySelector('[data-pet="robot"]')?.click()
    await new Promise((r) => setTimeout(r, 2000))
    return ${read}
  })()`))))
  check('picking Robot brings it back into the picker', back.picks.includes('robot') && !back.removedShown.includes('robot'), JSON.stringify(back))
  // Sonnet's 0.569 pass: "Removed 3 pets" stayed beside "2 removed" once Robot came back.
  check('and the removal message goes once a pet is picked', !back.captions.some((line) => /Removed 3 pets/.test(line)), JSON.stringify(back.captions))
  const file2 = JSON.parse(await readFile(join(drive.profile, 'pets-removed.json'), 'utf8').catch(() => '{}'))
  check('and out of the removed list', JSON.stringify(file2.ids) === JSON.stringify(['dot', 'reaper']), JSON.stringify(file2))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Robot and Dot seeded as downloaded, Wren wearing Robot; three removed at once, one brought back.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
