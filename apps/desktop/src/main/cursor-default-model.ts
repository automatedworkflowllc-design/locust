import { readFile, rename, rm, writeFile } from 'node:fs/promises'

/**
 * A CURSOR RUN LEAVES THE PERSON'S OWN CURSOR AS IT FOUND IT (0.431).
 *
 * `cursor-agent --model X` does not choose a model for one run: it saves X as
 * the person's Cursor default, in ~/.cursor/cli-config.json. MEASURED
 * 2026-09-27 over ACP and 2026-09-28 in print mode (what Locust runs): Grok
 * 4.7 256K Medium became Composer 2.5, and Colin's own Cursor then opened on
 * whatever his Locust teammate last used. Colin, asked whether Locust should
 * put it back after every run, 2026-09-28: "ill run with your
 * reccomendations".
 *
 * Only the three model fields are touched -- `model`, `selectedModel`,
 * `modelSelectionHistory`. The file also holds the person's Cursor sign-in;
 * it is read and written back whole, never looked at, copied or logged
 * (AGENTS.md: never inspect a subscription credential).
 *
 * Put back only when the default is still the model the run chose. If the
 * person switched models themselves meanwhile, theirs stands. With runs
 * overlapping, the state before the FIRST is what the LAST puts back. What
 * was kept is also written to `keptFile`, so a Locust that quit mid-run puts
 * it back on its next start (`recover`).
 */
const FIELDS = ['model', 'selectedModel', 'modelSelectionHistory'] as const
type Fields = Partial<Record<(typeof FIELDS)[number], unknown>>

export interface CursorDefaultModel {
  /** Before a Cursor run that names `runModel`. */
  before(runModel: string): Promise<void>
  /** After it ends, however it ended. */
  after(): Promise<void>
  /** At start: finish what a Locust that quit mid-run could not. */
  recover(): Promise<void>
}

/** The model id a run names, without its bracketed options: `composer-2.5[fast=true]` is `composer-2.5`. */
export const baseModelId = (model: string): string => model.replace(/\[.*$/, '').trim()

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const idOf = (value: unknown): string | undefined =>
  typeof value === 'object' && value !== null && typeof (value as { modelId?: unknown }).modelId === 'string'
    ? (value as { modelId: string }).modelId
    : undefined

export function createCursorDefaultModel(options: {
  readonly file: string
  readonly keptFile: string
  readonly note?: (what: string) => void
}): CursorDefaultModel {
  let active = 0
  let kept: { readonly fields: Fields; readonly runModel: string } | undefined

  const read = async (): Promise<{ readonly text: string; readonly config: Record<string, unknown> } | undefined> => {
    try {
      const text = await readFile(options.file, 'utf8')
      const config: unknown = JSON.parse(text)
      return typeof config === 'object' && config !== null && !Array.isArray(config) ? { text, config: config as Record<string, unknown> } : undefined
    } catch {
      return undefined
    }
  }
  const fieldsOf = (config: Record<string, unknown>): Fields =>
    Object.fromEntries(FIELDS.filter((field) => field in config).map((field) => [field, config[field]]))

  const putBack = async (record: { readonly fields: Fields; readonly runModel: string }): Promise<void> => {
    const now = await read()
    if (now === undefined) return
    const current = fieldsOf(now.config)
    if (FIELDS.every((field) => same(current[field], record.fields[field]))) return
    const ran = baseModelId(record.runModel)
    if (idOf(current.model) !== ran && idOf(current.selectedModel) !== ran) {
      options.note?.('the Cursor default changed to a model this run did not name; left as the person set it')
      return
    }
    const restored: Record<string, unknown> = { ...now.config }
    for (const field of FIELDS) {
      if (field in record.fields) restored[field] = record.fields[field]
      else delete restored[field]
    }
    // Written the way Cursor writes it: two-space indent, no final newline.
    const indent = /^\{\r?\n( +)"/.exec(now.text)?.[1]?.length ?? 0
    const temporary = `${options.file}.locust-${String(process.pid)}.tmp`
    await writeFile(temporary, `${JSON.stringify(restored, null, indent)}${now.text.endsWith('\n') ? '\n' : ''}`, 'utf8')
    await rename(temporary, options.file)
    const back = await read()
    const held = back !== undefined && FIELDS.every((field) => same(fieldsOf(back.config)[field], record.fields[field]))
    options.note?.(held ? 'the Cursor default put back as it was before the run' : 'the Cursor default could not be read back after putting it back')
  }

  return {
    async before(runModel) {
      if (active === 0) {
        const found = await read()
        kept = found === undefined ? undefined : { fields: fieldsOf(found.config), runModel }
        if (kept !== undefined) await writeFile(options.keptFile, JSON.stringify(kept), 'utf8').catch(() => undefined)
      } else if (kept !== undefined) {
        // A later run's model is what the default will show when the last ends.
        kept = { ...kept, runModel }
        await writeFile(options.keptFile, JSON.stringify(kept), 'utf8').catch(() => undefined)
      }
      active += 1
    },
    async after() {
      active = Math.max(0, active - 1)
      if (active > 0 || kept === undefined) return
      const record = kept
      kept = undefined
      try {
        await putBack(record)
      } finally {
        await rm(options.keptFile, { force: true }).catch(() => undefined)
      }
    },
    async recover() {
      if (active > 0) return
      let record: { readonly fields: Fields; readonly runModel: string } | undefined
      try {
        const parsed: unknown = JSON.parse(await readFile(options.keptFile, 'utf8'))
        if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { runModel?: unknown }).runModel === 'string') {
          record = parsed as { readonly fields: Fields; readonly runModel: string }
        }
      } catch {
        return
      }
      try {
        if (record !== undefined) await putBack(record)
      } finally {
        await rm(options.keptFile, { force: true }).catch(() => undefined)
      }
    }
  }
}
