// Put the memory-recall model where the packager will carry it.
//
//   node _tools/vendor-recall.mjs
//
// Memory recall ranks a teammate's notes by meaning, on this machine, with no
// network: all-MiniLM-L6-v2 (int8, Apache-2.0) run by onnxruntime-web's
// WebAssembly build. Four files have to be real files beside app.asar:
//
//   model.onnx                    the model, 23 MB, from Hugging Face at a
//                                 pinned revision, checked by its SHA-256
//   vocab.txt                     the tokenizer's word pieces, one per line,
//                                 taken from the same revision's tokenizer.json
//   ort-wasm-simd-threaded.mjs    onnxruntime's loader and its WebAssembly,
//   ort-wasm-simd-threaded.wasm   copied from the installed onnxruntime-web
//
// None of it is committed: 34 MB of binaries does not belong in the history.
// A download is kept in place, so this only touches the network when the
// pinned revision changes or the folder is empty.
//
// Run before packaging; `ship.mjs` does it.

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = fileURLToPath(new URL('../apps/desktop/', import.meta.url))
const DESTINATION = join(DESKTOP, 'resources', 'recall')
const REVISION = '751bff37182d3f1213fa05d7196b954e230abad9'
const FROM = `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/${REVISION}`
const PINNED = {
  'model.onnx': { from: `${FROM}/onnx/model_quantized.onnx`, sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' },
  'tokenizer.json': { from: `${FROM}/tokenizer.json`, sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0' }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

mkdirSync(DESTINATION, { recursive: true })
for (const [name, { from, sha256: expected }] of Object.entries(PINNED)) {
  const path = join(DESTINATION, name)
  if (existsSync(path) && sha256(readFileSync(path)) === expected) continue
  const response = await fetch(from)
  if (!response.ok) {
    console.error(`${name}: ${from} answered ${String(response.status)}.`)
    process.exit(1)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== expected) {
    console.error(`${name}: the download does not match its pinned SHA-256; refusing to ship it.`)
    process.exit(1)
  }
  writeFileSync(path, bytes)
}

// The vocabulary in id order, which is all the tokenizer needs: a word piece's
// id is its line number.
const vocab = JSON.parse(readFileSync(join(DESTINATION, 'tokenizer.json'), 'utf8')).model.vocab
const pieces = []
for (const [piece, id] of Object.entries(vocab)) pieces[id] = piece
if (pieces.length !== 30522 || pieces.some((piece) => piece === undefined || piece.includes('\n'))) {
  console.error('tokenizer.json does not hold the 30,522 word pieces this model was trained with.')
  process.exit(1)
}
writeFileSync(join(DESTINATION, 'vocab.txt'), pieces.join('\n'))

const require = createRequire(join(DESKTOP, 'package.json'))
// The package exports no package.json; its entry point sits in `dist`.
const ort = dirname(require.resolve('onnxruntime-web'))
for (const name of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  copyFileSync(join(ort, name), join(DESTINATION, name))
}

const { version } = JSON.parse(readFileSync(join(dirname(ort), 'package.json'), 'utf8'))
console.log(`Staged memory recall (all-MiniLM-L6-v2 @ ${REVISION.slice(0, 7)}, onnxruntime-web ${version}) at apps/desktop/resources/recall.`)
