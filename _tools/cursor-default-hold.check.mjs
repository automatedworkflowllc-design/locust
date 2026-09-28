// Checks cursor-default-hold.mjs against a FAKE Cursor config, never the real
// one. Run: node _tools/cursor-default-hold.check.mjs  (exits non-zero on red)
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { holdCursorDefault } from './cursor-default-hold.mjs'

const root = mkdtempSync(join(tmpdir(), 'locust-cursor-hold-'))
const file = join(root, 'cli-config.json')
const heldFile = join(root, 'held.json')
const lines = []
const say = (line) => lines.push(line)
let red = 0
const check = (ok, what) => { console.log(`${ok ? 'green' : 'RED  '}  ${what}`); if (!ok) red += 1 }

const his = { modelId: 'grok-4.7', displayName: 'Grok 4.7 256K Medium', parameters: [{ id: 'effort', value: 'medium' }] }
const drive = { modelId: 'grok-4.6', displayName: 'Grok 4.6 High' }
const config = (model, history) => ({ version: 1, authInfo: { secret: 'SIGN-IN' }, model, selectedModel: model, modelSelectionHistory: history, other: true })
const write = (value) => writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
const read = () => JSON.parse(readFileSync(file, 'utf8'))

try {
  // 1. A drive that changes the default gets it put back, sign-in untouched.
  write(config(his, [his, drive]))
  const hold = holdCursorDefault({ file, heldFile, say })
  check(existsSync(heldFile) && !readFileSync(heldFile, 'utf8').includes('SIGN-IN'), 'the held note carries the model fields and not the sign-in')
  const changed = { ...config(drive, [drive, his]), authInfo: { secret: 'SIGNED-IN-AGAIN' } }
  write(changed)
  const line = hold.putBack()
  const after = read()
  check(JSON.stringify(after.model) === JSON.stringify(his) && JSON.stringify(after.modelSelectionHistory) === JSON.stringify([his, drive]), 'the model fields are back as they were')
  check(after.authInfo.secret === 'SIGNED-IN-AGAIN' && after.other === true, 'everything else in the file is as the run left it')
  check(/left Grok 4\.6 High; put back Grok 4\.7 256K Medium and read back/.test(line) && !line.includes('SIGN'), `it says what it did, by model name only: "${line}"`)
  check(!existsSync(heldFile), 'the held note is gone once put back')
  check(readFileSync(file, 'utf8').startsWith('{\n  "') && !readFileSync(file, 'utf8').endsWith('\n'), 'written the way Cursor writes it')

  // 2. A drive that changes nothing writes nothing.
  const before = readFileSync(file, 'utf8')
  const quiet = holdCursorDefault({ file, heldFile, say })
  check(/unchanged \(Grok 4\.7 256K Medium\)/.test(quiet.putBack()) && readFileSync(file, 'utf8') === before, 'unchanged: nothing written')

  // 3. A drive that died holding it is put right by the next to start.
  write(config(his, [his]))
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
  writeFileSync(heldFile, JSON.stringify({ pid: Number(dead.stdout), fields: { model: his, selectedModel: his, modelSelectionHistory: [his] } }), 'utf8')
  write(config(drive, [drive, his]))
  lines.length = 0
  const next = holdCursorDefault({ file, heldFile, say })
  check(read().model.modelId === 'grok-4.7' && lines.some((l) => /ended early/.test(l)), 'a dead drive\'s change is put back at the next start')
  check(next.fields.model.modelId === 'grok-4.7', 'and the next drive holds the person\'s model, not the leftover')
  next.putBack()

  // 4. A second drive while the first is alive adopts the first's hold.
  // (Same process here, so it is also the same-drive relaunch case.)
  write(config(his, [his]))
  const first = holdCursorDefault({ file, heldFile, say })
  write(config(drive, [drive, his]))
  // This process is alive, so a second hold here adopts the first's fields.
  check(holdCursorDefault({ file, heldFile, say }).fields.model.modelId === 'grok-4.7', 'a second drive while the first is alive holds the person\'s model, not the changed one')
  const held = JSON.parse(readFileSync(heldFile, 'utf8'))
  check(held.pid === process.pid, 'the hold names the drive holding it')
  first.putBack()
  check(read().model.modelId === 'grok-4.7', 'the first drive puts back the person\'s model')

  // 5. No Cursor on the machine: nothing held, nothing written.
  rmSync(file)
  const none = holdCursorDefault({ file, heldFile, say })
  check(/no Cursor config/.test(none.putBack()) && !existsSync(file) && !existsSync(heldFile), 'no Cursor: nothing held or written')
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log(red === 0 ? 'ALL GREEN' : `${String(red)} RED`)
process.exit(red === 0 ? 0 : 1)
