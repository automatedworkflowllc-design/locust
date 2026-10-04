// How much does an update from one published Locust to the next download?
//
//   electron _tools/probe-differential-update.cjs <old version> <new version> <old installer>
//
// Runs electron-updater's own differential download -- the code the installed
// app runs, over Electron's network stack, as the app does -- from <old
// installer> to the published <new version>: both block maps from the
// release channel, only the changed blocks fetched, the result checked against
// the published sha512. Counts the bytes that actually arrived.
//
// Why: every release shipped without its block map, so every update fell back
// to downloading the whole 117 MB installer -- eight times on 2026-09-23 alone,
// the day a beta tester reported his connection dropping while Locust was open.
// Nothing is installed; the downloaded file is checked and deleted.

const { app } = require('electron')
const { createHash } = require('node:crypto')
const { createReadStream } = require('node:fs')
const { mkdtemp, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const { gunzipSync } = require('node:zlib')

const [oldVersion, newVersion, oldInstaller] = process.argv.slice(-3)
const CHANNEL = 'https://github.com/automatedworkflowllc-design/locust-releases/releases/download'
const updater = dirname(require.resolve('electron-updater/package.json', { paths: [join(__dirname, '..', 'apps', 'desktop')] }))
const runtime = dirname(require.resolve('builder-util-runtime/package.json', { paths: [updater] }))
const { ElectronHttpExecutor } = require(join(updater, 'out', 'electronHttpExecutor'))
const { GenericDifferentialDownloader } = require(join(updater, 'out', 'differentialDownloader', 'GenericDifferentialDownloader'))
const { CancellationToken } = require(runtime)

const sha512 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('base64')))
  })

async function main() {
  const http = new ElectronHttpExecutor()
  // Every byte that arrives in a response body, counted where it arrives.
  let arrived = 0
  const createRequest = http.createRequest.bind(http)
  http.createRequest = (options, callback) =>
    createRequest(options, (response) => {
      response.on('data', (chunk) => {
        arrived += chunk.length
      })
      callback(response)
    })

  const token = new CancellationToken()
  const text = async (url) => (await http.downloadToBuffer(new URL(url), { cancellationToken: token })).toString('utf8')
  const blockMap = async (version) => {
    const data = await http.downloadToBuffer(new URL(`${CHANNEL}/${version}/Locust-${version}-setup.exe.blockmap`), { cancellationToken: token })
    return JSON.parse(gunzipSync(data).toString())
  }

  const scratch = await mkdtemp(join(tmpdir(), 'locust-differential-'))
  const newFile = join(scratch, 'update.exe')
  const lines = []
  const logger = { info: (m) => lines.push(String(m)), warn: (m) => lines.push(`warn: ${String(m)}`), error: (m) => lines.push(`error: ${String(m)}`) }
  let planned
  try {
    const yml = await text(`${CHANNEL}/${newVersion}/latest.yml`)
    const published = {
      url: /^path:\s*(.+)$/m.exec(yml)[1].trim(),
      sha512: /^sha512:\s*(.+)$/m.exec(yml)[1].trim(),
      size: Number(/^\s+size:\s*(\d+)$/m.exec(yml)[1])
    }
    const [oldMap, newMap] = await Promise.all([blockMap(oldVersion), blockMap(newVersion)])
    const beforeDownload = arrived
    const started = Date.now()
    await new GenericDifferentialDownloader(published, http, {
      newUrl: new URL(`${CHANNEL}/${newVersion}/${published.url}`),
      oldFile: oldInstaller,
      logger,
      newFile,
      isUseMultipleRangeRequest: false,
      requestHeaders: {},
      cancellationToken: token,
      onProgress: (progress) => {
        planned = progress.total
      }
    }).download(oldMap, newMap)
    const got = await stat(newFile)
    const digest = await sha512(newFile)
    const body = arrived - beforeDownload
    console.log(lines.filter((l) => /Full:|To download|Differential/.test(l)).join('\n'))
    console.log(`${oldVersion} -> ${newVersion}: ${(body / 1e6).toFixed(2)} MB arrived for a ${(published.size / 1e6).toFixed(1)} MB installer, in ${((Date.now() - started) / 1000).toFixed(1)} s${planned === undefined ? '' : ` (planned ${(planned / 1e6).toFixed(2)} MB)`}`)
    const whole = got.size === published.size && digest === published.sha512
    console.log(`the assembled installer: ${got.size} bytes, sha512 ${whole ? 'MATCHES' : 'DOES NOT MATCH'} the published one`)
    console.log(whole && body < published.size / 10 ? 'DIFFERENTIAL UPDATE PASSED' : 'DIFFERENTIAL UPDATE FAILED')
  } catch (error) {
    console.log(lines.join('\n'))
    console.log(`DIFFERENTIAL UPDATE FAILED: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

app.whenReady().then(main).finally(() => app.quit())
