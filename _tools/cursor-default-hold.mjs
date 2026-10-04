// A DRIVE LEAVES THE PERSON'S CURSOR DEFAULT AS IT FOUND IT.
//
// `cursor-agent --model X` saves X as the person's Cursor default in
// ~/.cursor/cli-config.json. Locust puts it back when a Cursor run's process
// ends (0.431, apps/desktop/src/main/cursor-default-model.ts) and keeps a note
// in its profile for the next start. A drive defeats both: it ends the app
// before the run's process ends, and deletes the profile holding the note.
// 2026-09-28, the 0.443 compare drive left Colin's Cursor on Grok 4.6 High
// instead of his Grok 4.7 256K Medium, and he would only have found out by
// opening Cursor.
//
// So the harness holds the three model fields itself -- `model`,
// `selectedModel`, `modelSelectionHistory` -- from before the launch, and puts
// them back after the app is gone, then reads them back. The file also holds
// the person's Cursor sign-in: it is read and written whole, and nothing but
// the model ids is ever printed (AGENTS.md: never inspect a credential).
//
// What is held is also written to ~/.locust/drive-cursor-default.json (model
// fields only), so a drive that crashed before `putBack` is put right by the
// next drive to start. While that file's drive is still alive, a second drive
// adopts it instead of holding the changed default as "before".

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const FIELDS = ['model', 'selectedModel', 'modelSelectionHistory']

export const CURSOR_CONFIG = join(homedir(), '.cursor', 'cli-config.json')
export const HELD_FILE = join(homedir(), '.locust', 'drive-cursor-default.json')

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const fieldsOf = (config) => Object.fromEntries(FIELDS.filter((field) => field in config).map((field) => [field, config[field]]))
/** A model's name as the person would read it, and nothing else from the file. */
export const modelName = (fields) => {
  const model = fields?.model
  if (typeof model !== 'object' || model === null) return 'none'
  return String(model.displayName ?? model.displayModelId ?? model.modelId ?? 'unnamed')
}

const alive = (pid) => {
  if (typeof pid !== 'number') return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

function readConfig(file) {
  try {
    const text = readFileSync(file, 'utf8')
    const config = JSON.parse(text)
    return typeof config === 'object' && config !== null && !Array.isArray(config) ? { text, config } : undefined
  } catch {
    return undefined
  }
}

function writeFields(file, fields) {
  const now = readConfig(file)
  if (now === undefined) return { changed: false, held: false }
  if (FIELDS.every((field) => same(now.config[field], fields[field]))) return { changed: false, held: true }
  const restored = { ...now.config }
  for (const field of FIELDS) {
    if (field in fields) restored[field] = fields[field]
    else delete restored[field]
  }
  // Written the way Cursor writes it: its indent, its final newline or none.
  const indent = /^\{\r?\n( +)"/.exec(now.text)?.[1]?.length ?? 0
  const temporary = `${file}.locust-drive-${String(process.pid)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(restored, null, indent)}${now.text.endsWith('\n') ? '\n' : ''}`, 'utf8')
  renameSync(temporary, file)
  const back = readConfig(file)
  return { changed: true, held: back !== undefined && FIELDS.every((field) => same(back.config[field], fields[field])) }
}

/**
 * Hold the Cursor default before a drive launches the app.
 *
 * Returns `putBack()`, to call once the app and its processes are gone; it
 * says in one line what it found and did. `file` and `heldFile` are for the
 * check, which must never touch the real config.
 */
export function holdCursorDefault({ file = CURSOR_CONFIG, heldFile = HELD_FILE, say = (line) => console.error(line) } = {}) {
  let held
  try { held = JSON.parse(readFileSync(heldFile, 'utf8')) } catch { held = undefined }
  if (held !== undefined && (typeof held !== 'object' || held === null || typeof held.fields !== 'object')) held = undefined

  let owner = false
  if (held !== undefined && !alive(held.pid)) {
    // A drive that crashed before putting it back: put it back now.
    const { changed, held: ok } = writeFields(file, held.fields)
    if (changed) say(`Cursor default: a drive that ended early left it changed; put back ${modelName(held.fields)}${ok ? '' : ' -- BUT IT DID NOT READ BACK'}`)
    rmSync(heldFile, { force: true })
    held = undefined
  }
  if (held === undefined) {
    const found = readConfig(file)
    if (found === undefined) return { fields: undefined, putBack: () => 'Cursor default: no Cursor config on this machine' }
    held = { pid: process.pid, fields: fieldsOf(found.config) }
    mkdirSync(dirname(heldFile), { recursive: true })
    writeFileSync(heldFile, JSON.stringify(held), 'utf8')
    owner = true
  }
  // The same drive relaunching on its profile owns what it held the first time.
  if (held.pid === process.pid) owner = true
  const fields = held.fields
  let done = false

  return {
    fields,
    putBack() {
      done = true
      const left = readConfig(file)
      const { changed, held: ok } = writeFields(file, fields)
      if (owner && existsSync(heldFile)) rmSync(heldFile, { force: true })
      const line = !changed
        ? `Cursor default: unchanged (${modelName(fields)})`
        : ok
          ? `Cursor default: the drive left ${left === undefined ? 'something unreadable' : modelName(fieldsOf(left.config))}; put back ${modelName(fields)} and read back`
          : `Cursor default: put back ${modelName(fields)} but it DID NOT READ BACK -- fix by hand`
      say(line)
      return line
    },
    /** Whether `putBack` has run, for an exit hook that must not run it twice. */
    get done() { return done }
  }
}
