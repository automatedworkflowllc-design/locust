import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * MEMORY RECALL BY MEANING, on this machine, with no network.
 *
 * The brief pastes the notes that bear on what was asked, and until now
 * "bear on" meant "shares a rare word with it" (shared/memory.ts). A note
 * that says "the site deploys from the gh-pages branch" never reached a
 * question about "publishing the website": not one word in common.
 *
 * MEASURED on Colin's store, 2026-09-28, against the 136 notes a colleague
 * would want for 76 of his real prompts (picked by reading): the keyword
 * brief pasted 70 of them at 8 lines and 97 at 24. Ranking every note by
 * meaning first, then the newest, pasted 84 and 107. The model is
 * all-MiniLM-L6-v2 in int8 (23 MB, Apache-2.0), run by onnxruntime's
 * WebAssembly build: about 7 ms a note on one thread, and every note is
 * embedded once and kept (by a hash of its words) in `cacheFile`.
 *
 * Tried and not shipped: bge-small (75 and 106 -- no better, twice the
 * size); fusing the keyword and meaning rankings, as ai-memory does (worse
 * than meaning alone at both sizes); onnxruntime's native build (208 MB)
 * and transformers.js (47 MB before a model), both too heavy for what they
 * add over the WebAssembly build.
 *
 * NEVER IN THE WAY. A recall that cannot load, or cannot answer before the
 * run would start, answers nothing, and the brief falls back to the keyword
 * order it had before -- the run is never held up by, or fails because of,
 * a better guess at which notes to paste. A slow first answer keeps working
 * in the background, so the next brief has it.
 */

/** The files `_tools/vendor-recall.mjs` stages beside the app. */
export const RECALL_FILES = {
  model: 'model.onnx',
  vocab: 'vocab.txt',
  loader: 'ort-wasm-simd-threaded.mjs',
  wasm: 'ort-wasm-simd-threaded.wasm'
} as const

/** The model's own limit: a longer text is read to its 256th token. */
const MAX_TOKENS = 256
/** How long a brief waits for an answer before it goes with the keyword order. */
export const RECALL_WAIT_MS = 1500
/** Notes kept in the cache file; the least recently used go first. */
const CACHE_LIMIT = 4000

/**
 * BERT's WordPiece tokenizer, as all-MiniLM-L6-v2 was trained with: lower
 * case, accents stripped, split on white space and punctuation, then each
 * word into the longest pieces the vocabulary holds. Checked against
 * transformers.js's own tokenizer on the 190 texts of the labelled set: the
 * same ids for 189, and the same brief for all 76 prompts.
 *
 * `vocab` is the vocabulary in id order: a piece's id is its index.
 */
export function wordPieces(vocab: readonly string[]): (text: string) => readonly number[] {
  const ids = new Map(vocab.map((piece, id) => [piece, id]))
  const id = (piece: string): number => ids.get(piece) ?? ids.get('[UNK]')!
  const punctuation = (ch: string): boolean => {
    const code = ch.codePointAt(0)!
    if ((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)) return true
    return /\p{P}/u.test(ch)
  }
  const chinese = (code: number): boolean =>
    (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x20000 && code <= 0x2a6df) || (code >= 0xf900 && code <= 0xfaff)
  const words = (text: string): string[] => {
    let clean = ''
    for (const ch of text) {
      const code = ch.codePointAt(0)!
      if (code === 0 || code === 0xfffd || (/\p{Cc}/u.test(ch) && !/\s/.test(ch))) continue
      clean += /\s/.test(ch) ? ' ' : chinese(code) ? ` ${ch} ` : ch
    }
    const out: string[] = []
    for (const word of clean.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').split(' ')) {
      let current = ''
      for (const ch of word) {
        if (!punctuation(ch)) {
          current += ch
          continue
        }
        if (current !== '') out.push(current)
        out.push(ch)
        current = ''
      }
      if (current !== '') out.push(current)
    }
    return out
  }
  const pieces = (word: string): string[] => {
    const chars = [...word]
    if (chars.length > 100) return ['[UNK]']
    const found: string[] = []
    let start = 0
    while (start < chars.length) {
      let end = chars.length
      let piece: string | undefined
      for (; start < end; end -= 1) {
        const candidate = (start > 0 ? '##' : '') + chars.slice(start, end).join('')
        if (ids.has(candidate)) {
          piece = candidate
          break
        }
      }
      // A word with any part the vocabulary cannot spell is one unknown word.
      if (piece === undefined) return ['[UNK]']
      found.push(piece)
      start = end
    }
    return found
  }
  return (text) => [id('[CLS]'), ...words(text).flatMap(pieces).map(id)].slice(0, MAX_TOKENS - 1).concat(id('[SEP]'))
}

export interface MemoryRecall {
  /**
   * How close in meaning each text is to `query`, in the texts' own order
   * (cosine, -1 to 1). Undefined when recall could not load, or could not
   * answer within `waitMs`.
   */
  similarity(query: string, texts: readonly string[], waitMs?: number): Promise<readonly number[] | undefined>
}

export type Vector = Float32Array
export interface Embedder {
  embed(ids: readonly number[]): Promise<Vector>
}

/** onnxruntime-web, told where its WebAssembly is, and the model loaded into it. */
async function loadEmbedder(directory: string): Promise<Embedder> {
  const ort = await import('onnxruntime-web')
  // One thread: a brief is a handful of short notes, and a worker pool would
  // compete with the runs it is briefing for the same cores.
  ort.env.wasm.numThreads = 1
  ort.env.wasm.wasmBinary = await readFile(join(directory, RECALL_FILES.wasm))
  ort.env.wasm.wasmPaths = { mjs: pathToFileURL(join(directory, RECALL_FILES.loader)).href }
  ort.env.logLevel = 'error'
  const session = await ort.InferenceSession.create(await readFile(join(directory, RECALL_FILES.model)))
  return {
    async embed(ids) {
      const length = ids.length
      const shape = [1, length]
      const output = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, (value) => BigInt(value)), shape),
        attention_mask: new ort.Tensor('int64', new BigInt64Array(length).fill(1n), shape),
        token_type_ids: new ort.Tensor('int64', new BigInt64Array(length), shape)
      })
      // The sentence is the mean of its tokens, scaled to length one, so a
      // dot product of two is their cosine.
      const hidden = output['last_hidden_state']!.data as Float32Array
      const width = hidden.length / length
      const mean = new Float32Array(width)
      for (let token = 0; token < length; token += 1) {
        for (let d = 0; d < width; d += 1) mean[d]! += hidden[token * width + d]! / length
      }
      const norm = Math.hypot(...mean) || 1
      return mean.map((value) => value / norm)
    }
  }
}

export function createMemoryRecall(input: {
  /** Where the four RECALL_FILES are. */
  readonly directory: string
  /** Where embedded notes are kept between launches. */
  readonly cacheFile: string
  readonly note?: (message: string) => void
  /** Test seam: an embedder instead of the model. */
  readonly embedder?: () => Promise<Embedder>
}): MemoryRecall {
  let ready: Promise<{ encode: (text: string) => readonly number[]; embedder: Embedder } | undefined> | undefined
  const load = (): NonNullable<typeof ready> => {
    ready ??= (async () => {
      try {
        const vocab = (await readFile(join(input.directory, RECALL_FILES.vocab), 'utf8')).split('\n')
        const embedder = await (input.embedder ?? (() => loadEmbedder(input.directory)))()
        return { encode: wordPieces(vocab), embedder }
      } catch (error) {
        // Once: the keyword order serves every brief after this, as before.
        input.note?.(`memory recall is off for this session: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    })()
    return ready
  }

  let cache: Promise<Map<string, Vector>> | undefined
  const readCache = (): Promise<Map<string, Vector>> => {
    cache ??= (async () => {
      try {
        const kept = JSON.parse(await readFile(input.cacheFile, 'utf8')) as { readonly vectors?: Record<string, string> }
        return new Map(Object.entries(kept.vectors ?? {}).map(([key, base64]) => {
          // Copied: a decoded Buffer may sit at an offset no Float32Array can start at.
          return [key, new Float32Array(new Uint8Array(Buffer.from(base64, 'base64')).buffer)] as const
        }))
      } catch {
        return new Map<string, Vector>()
      }
    })()
    return cache
  }
  let saving = Promise.resolve()
  const saveCache = (vectors: Map<string, Vector>): void => {
    saving = saving.then(async () => {
      const kept = [...vectors].slice(-CACHE_LIMIT)
      const body = JSON.stringify({ vectors: Object.fromEntries(kept.map(([key, vector]) => [key, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64')])) })
      await mkdir(dirname(input.cacheFile), { recursive: true })
      // Whole or not at all: a half-written cache would be read as empty.
      await writeFile(`${input.cacheFile}.tmp`, body)
      await rename(`${input.cacheFile}.tmp`, input.cacheFile)
    }).catch((error: unknown) => {
      input.note?.(`memory recall could not keep its cache: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  // One inference at a time: the model's session is not shared across calls.
  let queue: Promise<unknown> = Promise.resolve()
  const key = (text: string): string => createHash('sha256').update(text).digest('base64url').slice(0, 22)

  async function answer(query: string, texts: readonly string[]): Promise<readonly number[] | undefined> {
    const loaded = await load()
    if (loaded === undefined) return undefined
    const vectors = await readCache()
    let added = false
    const vectorOf = async (text: string, keep: boolean): Promise<Vector> => {
      const known = vectors.get(key(text))
      if (known !== undefined) {
        // Most recently used last, so the cache sheds the notes nobody has.
        vectors.delete(key(text))
        vectors.set(key(text), known)
        return known
      }
      const run = queue.then(() => loaded.embedder.embed(loaded.encode(text)))
      queue = run.catch(() => undefined)
      const vector = await run
      if (keep) {
        vectors.set(key(text), vector)
        added = true
      }
      return vector
    }
    const asked = await vectorOf(query, false)
    const scores: number[] = []
    for (const text of texts) {
      const vector = await vectorOf(text, true)
      scores.push(vector.reduce((sum, value, d) => sum + value * asked[d]!, 0))
    }
    if (added) saveCache(vectors)
    return scores
  }

  return {
    async similarity(query, texts, waitMs = RECALL_WAIT_MS) {
      if (texts.length === 0 || query.trim() === '') return undefined
      const working = answer(query, texts).catch((error: unknown) => {
        input.note?.(`memory recall could not rank this brief: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      })
      let timer: NodeJS.Timeout | undefined
      const late = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), waitMs)
      })
      try {
        return await Promise.race([working, late])
      } finally {
        clearTimeout(timer)
      }
    }
  }
}
