import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { briefedMemories } from '../shared/memory.js'
import type { MemoryLine } from '../shared/memory.js'
import { createMemoryRecall, RECALL_FILES, wordPieces } from './memory-recall.js'
import type { Embedder } from './memory-recall.js'

/**
 * MEMORY RECALL BY MEANING (0.454): the notes a brief pastes are the ones
 * closest in meaning to what was asked, found on this machine -- and when
 * that cannot answer, the brief is exactly what it was before.
 */

const STAGED = fileURLToPath(new URL('../../resources/recall/', import.meta.url))
const staged = Object.values(RECALL_FILES).every((name) => existsSync(join(STAGED, name)))

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** A folder holding a small vocabulary, and a cache file beside it. */
async function folder(vocab: readonly string[]): Promise<{ directory: string; cacheFile: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'locust-recall-'))
  directories.push(directory)
  await writeFile(join(directory, RECALL_FILES.vocab), vocab.join('\n'))
  return { directory, cacheFile: join(directory, 'cache.json') }
}

/** The cache is written in the background; a test waits for it before its folder goes. */
async function saved(cacheFile: string): Promise<void> {
  await expect.poll(async () => existsSync(cacheFile) && (await readFile(cacheFile, 'utf8')).length > 0).toBe(true)
}

const VOCAB = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'deploy', 'site', 'publish', 'reply', 'short', '##s', ',', '.']

/** Stands in for the model: a word's id is its direction, so shared words mean closeness. */
function countingEmbedder(): Embedder & { calls: number } {
  const embedder = {
    calls: 0,
    async embed(ids: readonly number[]) {
      embedder.calls += 1
      const vector = new Float32Array(VOCAB.length)
      for (const id of ids) if (id > 3) vector[id]! += 1
      const norm = Math.hypot(...vector) || 1
      return vector.map((value) => value / norm)
    }
  }
  return embedder
}

const line = (text: string, at: string): MemoryLine => ({ text, scope: 'workspace', by: 'Wren', where: undefined, at })

describe('the tokenizer', () => {
  it('lower-cases, strips accents, splits punctuation and spells a word in the longest pieces it has', () => {
    const encode = wordPieces(VOCAB)
    // [CLS] deploy ##s , site . [SEP]
    expect(encode('Deploys, SÍTE.')).toEqual([2, 4, 9, 10, 5, 11, 3])
    // A word with a part the vocabulary cannot spell is one unknown word.
    expect(encode('deployz')).toEqual([2, 1, 3])
  })

  it('stops at the model\'s 256 tokens, and still ends the sentence', () => {
    const ids = wordPieces(VOCAB)('site '.repeat(400))
    expect(ids).toHaveLength(256)
    expect(ids[255]).toBe(3)
  })

  it.skipIf(!staged)('gives the ids the model was trained with', () => {
    const vocab = readFileSync(join(STAGED, RECALL_FILES.vocab), 'utf8').split('\n')
    // BERT's own: [CLS] hello , world ! [SEP]
    expect(wordPieces(vocab)('Hello, world!')).toEqual([101, 7592, 1010, 2088, 999, 102])
  })
})

describe('memory recall', () => {
  it('scores each note by how close it is to what was asked, in the notes\' order', async () => {
    const embedder = countingEmbedder()
    const place = await folder(VOCAB)
    const recall = createMemoryRecall({ ...place, embedder: async () => embedder })
    const scores = await recall.similarity('publish the site', ['short replies', 'deploys the site', 'publish'])
    await saved(place.cacheFile)
    expect(scores).toHaveLength(3)
    expect(scores![0]).toBe(0)
    expect(scores![1]).toBeGreaterThan(0)
    expect(scores![2]).toBeGreaterThan(0)
  })

  it('embeds a note once, and keeps it for the next launch', async () => {
    const place = await folder(VOCAB)
    const first = countingEmbedder()
    await createMemoryRecall({ ...place, embedder: async () => first }).similarity('site', ['deploys the site', 'short replies'])
    expect(first.calls).toBe(3)
    await saved(place.cacheFile)

    const next = countingEmbedder()
    const scores = await createMemoryRecall({ ...place, embedder: async () => next }).similarity('publish', ['deploys the site', 'short replies'])
    // Only the question was new.
    expect(next.calls).toBe(1)
    expect(scores).toHaveLength(2)
  })

  it('answers nothing, and says so once, when the model cannot load', async () => {
    const notes: string[] = []
    const recall = createMemoryRecall({
      ...(await folder(VOCAB)),
      note: (message) => notes.push(message),
      embedder: async () => {
        throw new Error('model.onnx is missing')
      }
    })
    expect(await recall.similarity('site', ['deploys the site'])).toBeUndefined()
    expect(await recall.similarity('site', ['deploys the site'])).toBeUndefined()
    expect(notes).toEqual(['memory recall is off for this session: model.onnx is missing'])
  })

  it('never holds a brief up: a slow answer is no answer, and the next brief has it', async () => {
    const embedder = countingEmbedder()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const place = await folder(VOCAB)
    const recall = createMemoryRecall({
      ...place,
      embedder: async () => {
        await gate
        return embedder
      }
    })
    expect(await recall.similarity('site', ['deploys the site'], 20)).toBeUndefined()
    release()
    await expect.poll(() => embedder.calls).toBe(2)
    expect(await recall.similarity('site', ['deploys the site'], 20)).toHaveLength(1)
    await saved(place.cacheFile)
  })
})

describe('a brief ranked by meaning', () => {
  const memories = [
    line('The site deploys from the gh-pages branch; pushing there makes it live.', '2026-09-01T00:00:00.000Z'),
    line('The person likes short replies, no headers.', '2026-09-02T00:00:00.000Z'),
    line('Unit tests run with vitest from apps/desktop.', '2026-09-03T00:00:00.000Z'),
    line('The website hero has a rainbow border around the dashboard link.', '2026-09-04T00:00:00.000Z')
  ]
  const query = 'how do I publish the website?'

  it('pastes the closest first, the newer first on a tie', () => {
    const order = briefedMemories({ memories, query, similarity: [0.4, 0.1, 0.1, 0.2] }).map((memory) => memory.text)
    expect(order).toEqual([memories[0]!.text, memories[3]!.text, memories[2]!.text, memories[1]!.text])
  })

  it('is exactly the keyword brief when recall did not answer', () => {
    expect(briefedMemories({ memories, query, similarity: [0.4, 0.1] })).toEqual(briefedMemories({ memories, query }))
    expect(briefedMemories({ memories, similarity: [0.4, 0.1, 0.1, 0.2] })).toEqual(briefedMemories({ memories }))
  })

  it.skipIf(!staged)('with the real model, finds the note that shares no word with the question', async () => {
    const { cacheFile } = await folder(VOCAB)
    const recall = createMemoryRecall({ directory: STAGED, cacheFile })
    // The first load compiles the WebAssembly; give it the time a brief would not.
    const similarity = await recall.similarity(query, memories.map((memory) => memory.text), 60_000)
    expect(similarity).toHaveLength(4)
    // The keyword brief leads with the note that says "website"...
    expect(briefedMemories({ memories, query })[0]!.text).toBe(memories[3]!.text)
    // ...meaning leads with how the site actually goes live.
    expect(briefedMemories({ memories, query, similarity: similarity! })[0]!.text).toBe(memories[0]!.text)
    await saved(cacheFile)
  }, 90_000)
})
