// Recently forgotten: a forgotten memory can come back (A1.8).
//
//   node _tools/drive-memory-trash.mjs [--packaged <exe>] [--tag <name>]
//
// Memory mode "Keep and tell me", three memories kept. The person removes one
// on the Memory screen; Booty, on the free OpenCode model, forgets another
// with the memory block. Both must be in Recently forgotten, by who forgot
// them, and gone from the file every teammate reads -- then Restore puts each
// back, and the file says so again. Forget everything for the folder holds
// all three; one is restored; and the app is closed and opened again to see
// that Recently forgotten outlives a restart. The file is read by the drive
// itself after each teammate run, and a NEW teammate quotes it.

import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag')
const outPath = tag === undefined ? undefined : join(new URL('../docs/beta-fixes-2026-09-24/', import.meta.url).pathname.slice(1), `memory-trash-${tag}`)
if (outPath !== undefined) await mkdir(outPath, { recursive: true })

const workspace = await scratchRepository('locust-drive-trash-ws-')
const workspaceId = `ws_${createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32)}`
const T0 = '2026-09-05T05:00:00.000Z'
const kept = (memoryId, text) => ({ memoryId, text, scope: 'workspace', workspaceId, workspaceName: 'scratch', by: { name: 'you' }, createdAt: T0, status: 'kept', enabled: true })
const teammate = (name, hue) => ({ teammateId: `tm_${name.toLowerCase()}`, name, hue, role: 'Custom', roleTitle: 'Helper', createdAt: T0, route: FREE_ROUTE })
const common = {
  name: 'memory-trash',
  port: 9530,
  workspace,
  ...(packaged === undefined ? {} : { packaged })
}
let drive = await startDrive({
  ...common,
  ...(outPath === undefined ? {} : { outPath }),
  keep: true,
  seed: {
    schemaVersion: 1,
    teammates: [teammate('Booty', 'blue'), teammate('Ash', 'clay'), teammate('Moth', 'teal'), teammate('Fern', 'rose')],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto' }
  },
  files: {
    'memories.json': {
      schemaVersion: 1,
      memories: [kept('mem_port', 'The API is on port 3000.'), kept('mem_day', 'Deploys go out on Fridays.'), kept('mem_word', 'The secret word for this project is PELICAN.')]
    }
  }
})

const QUOTE = 'Without running any command or reading any file, quote every line your brief lists under what your team remembers, one per line, word for word. If there is none, reply NONE.'
const briefed = async () => {
  const text = await readFile(join(workspace, '.locust', 'memory.md'), 'utf8')
  return 'the file says: ' + text.split(/\r?\n/).filter((line) => line.startsWith('- ')).join(' / ')
}
const ask = async (name, text) => {
  await drive.evaluate(`document.querySelector('.lc-brand__lockup').click()`)
  const opened = await drive.evaluate(openTeammateScript(name))
  if (!opened.startsWith('opened')) return opened
  return drive.evaluate(sendAndWaitScript(text))
}
const quote = async (name) => {
  const said = await ask(name, QUOTE)
  return `${await briefed()} || ${name}: ${said}`
}
const memoryScreen = `window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', ctrlKey: true, bubbles: true })); await new Promise(r => setTimeout(r, 700))`
// The Memory screen's sections as the person reads them.
const sections = `[...document.querySelectorAll('.lc-settings__section')].map(section => {
  const heading = section.querySelector('.lc-settings__heading')?.innerText.replace(/\\s+/g, ' ') ?? ''
  const rows = [...section.querySelectorAll('.lc-memory')].map(r => r.innerText.replace(/\\s+/g, ' ').slice(0, 110))
  return rows.length === 0 ? '' : heading + ': ' + rows.join(' | ')
}).filter(Boolean).join(' || ')`
const click = (rowPattern, label, where = '.lc-memory') => `(async () => {
  ${memoryScreen}
  const row = [...document.querySelectorAll('${where}')].find(r => ${rowPattern}.test(r.innerText))
  if (!row) return 'no row matching ${rowPattern}: ' + ${sections}
  const button = [...row.querySelectorAll('button')].find(b => b.innerText.trim() === '${label}')
  if (!button) return 'no ${label} button: ' + row.innerText.replace(/\\s+/g, ' ')
  button.click()
  await new Promise(r => setTimeout(r, 700))
  return 'pressed ${label} || ' + ${sections}
})()`

let handoff
try {
  await drive.capture('launch: three memories kept, mode Keep and tell me', () => drive.ready())
  await drive.capture('Remove "Deploys go out on Fridays" on the Memory screen', () => drive.evaluate(click('/Fridays/', 'Remove')))
  await drive.capture('Booty forgets "The API is on port 3000" with the memory block', () =>
    ask('Booty', 'Without running any command or reading any file, use the memory block you were shown, with exactly this one line and nothing else in it: "forget :: The API is on port 3000". Then reply with the single word OK.')
  )
  await drive.capture('Recently forgotten: both, and by whom', () => drive.evaluate(`(async () => { ${memoryScreen}; return ${sections} })()`))
  await drive.capture('Ash quotes what is kept: the secret word only', () => quote('Ash'))
  await drive.capture('Restore Fridays', () => drive.evaluate(click('/Fridays/', 'Restore', '.lc-memory.is-forgotten')))
  await drive.capture('Restore port 3000', () => drive.evaluate(click('/port 3000/', 'Restore', '.lc-memory.is-forgotten')))
  await drive.capture('Moth quotes what is kept: all three again', () => quote('Moth'))
  await drive.capture('Forget everything for this folder: what the confirmation says', () => drive.evaluate(`(async () => {
    ${memoryScreen}
    const button = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Forget everything for this folder')
    if (!button) return 'no Forget everything for this folder button'
    button.click()
    await new Promise(r => setTimeout(r, 400))
    const said = [...document.querySelectorAll('.lc-settings__note')].map(n => n.innerText.replace(/\\s+/g, ' ')).find(t => /forgotten\\./.test(t)) ?? 'no confirmation'
    ;[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Yes, forget')?.click()
    await new Promise(r => setTimeout(r, 800))
    return said + ' || ' + ${sections}
  })()`))
  await drive.capture('Restore the secret word', () => drive.evaluate(click('/PELICAN/', 'Restore', '.lc-memory.is-forgotten')))
  handoff = await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. Booty, Ash, Moth and Fern on the free OpenCode model; memory Keep and tell me; three memories kept; closed and opened again at the end.`, last: false })
} catch (error) {
  say(`first half failed: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  // The same profile, opened again.
  drive = await startDrive({ ...common, profilePath: handoff.profile, outPath: handoff.out, stepFrom: handoff.step })
  await drive.capture('opened again: Recently forgotten outlived the restart', async () => {
    await drive.ready()
    return drive.evaluate(`(async () => { ${memoryScreen}; return ${sections} })()`)
  })
  await drive.capture('Fern quotes what is kept: the secret word only', () => quote('Fern'))
} catch (error) {
  say(`second half failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Opened again on the same profile.' })
}
