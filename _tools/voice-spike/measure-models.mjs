// Reproduce the model choice using exactly the shipped CPU CLI arguments.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const exec = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')
const cache = join(root, '.tmp/voice-model-measurement')
const revision = '5359861c739e955e79d9a303bcbc70fb988958b1'
const models = [
  ['base', 59721011, '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f'],
  ['small', 190098681, 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30']
]
await mkdir(cache, { recursive: true })
async function checked(url, path, bytes, sha) {
  let data = await readFile(path).catch(() => null)
  if (!data || data.length !== bytes || createHash('sha256').update(data).digest('hex') !== sha) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Download refused: ${response.status}`)
    data = Buffer.from(await response.arrayBuffer())
    if (data.length !== bytes || createHash('sha256').update(data).digest('hex') !== sha) throw new Error('Wrong download hash')
    await writeFile(path, data)
  }
}
const archive = join(cache, 'runtime.zip')
await checked('https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip', archive, 8928640, '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb')
await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${join(cache, 'native')}' -Force`], { windowsHide: true })
const results = []
for (const [name, bytes, sha] of models) {
  const file = `ggml-${name}.en-q5_1.bin`
  const model = join(cache, file)
  await checked(`https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/${file}`, model, bytes, sha)
  for (let run = 1; run <= 3; run++) {
    const start = performance.now()
    const { stdout } = await exec(join(cache, 'native/Release/whisper-cli.exe'), ['-m', model, '-f', join(root, '_tools/voice-spike/results/clip.wav'), '-t', '2', '-l', 'en', '-ng', '-nt', '-np'], { windowsHide: true, timeout: 120000 })
    const result = { model: name, run, bytes, sha256: sha, milliseconds: performance.now() - start, text: stdout.trim() }
    results.push(result)
    console.log(JSON.stringify(result))
  }
}
await writeFile(join(cache, 'results.json'), JSON.stringify({ clip: '_tools/voice-spike/results/clip.wav', seconds: 10, threads: 2, results }, null, 2))
