import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createMacUpdater, macSelfUpdateTarget, SWAP_SCRIPT } from './mac-self-update.js'

/*
 * A MAC LOCUST UPDATES ITSELF (0.516). Colin, 2026-10-01, for a tester on a
 * Mac: "try and make it work for him and just like how ours is". The steps,
 * off a Mac: hdiutil and ditto are stood in for, the swap script is run for
 * real wherever a POSIX shell is.
 */
let root: string | undefined
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const base = 'https://github.com/automatedworkflowllc-design/locust-releases/releases/download'
const IMAGE = Buffer.from('a disk image, for the test')
const releases = (sha256: string) => [{
  tag_name: '0.517.0',
  assets: [{ name: 'Locust-0.517.0-mac-arm64.dmg', browser_download_url: `${base}/0.517.0/Locust-0.517.0-mac-arm64.dmg`, size: IMAGE.length, digest: `sha256:${sha256}` }]
}]
const sha = createHash('sha256').update(IMAGE).digest('hex')

describe('where a Mac Locust can replace itself', () => {
  it('a Locust.app in a folder it can write', () => {
    expect(macSelfUpdateTarget('/Applications/Locust.app/Contents/MacOS/Locust', () => true)).toBe('/Applications/Locust.app')
    expect(macSelfUpdateTarget('/Applications/Locust.app/Contents/MacOS/Locust', () => false)).toBeUndefined()
  })

  it('not from the disk image, nor macOS\'s translocated copy of a download, nor a bare binary', () => {
    expect(macSelfUpdateTarget('/Volumes/Locust 0.516.0/Locust.app/Contents/MacOS/Locust', () => true)).toBeUndefined()
    expect(macSelfUpdateTarget('/private/var/folders/x/AppTranslocation/ABC/d/Locust.app/Contents/MacOS/Locust', () => true)).toBeUndefined()
    expect(macSelfUpdateTarget('/usr/local/bin/locust', () => true)).toBeUndefined()
  })
})

describe('a Mac update, from check to swap', () => {
  const setup = async (digest: string) => {
    root = await mkdtemp(join(tmpdir(), 'locust-mac-update-'))
    const commands: string[] = []
    const swaps: { script: string; args: readonly string[] }[] = []
    const events: string[] = []
    let quit = 0
    const updater = createMacUpdater({
      currentVersion: '0.516.0',
      arch: 'arm64',
      bundle: join(root, 'Locust.app'),
      cacheFolder: join(root, 'cache'),
      quit: () => { quit += 1 },
      pid: 4242,
      fetchReleases: async () => releases(digest),
      download: async (_url, to, onPercent) => { onPercent(100); await writeFile(to, IMAGE) },
      run: async (command, args) => {
        commands.push([command, ...args].join(' '))
        // ditto "copies" the app: the staged folder appears.
        if (command === 'ditto') await mkdir(args[1]!, { recursive: true })
        // hdiutil attach "mounts" the image: a Locust.app in the mount point.
        if (command === 'hdiutil' && args[0] === 'attach') await mkdir(join(args[args.length - 1]!, 'Locust.app'), { recursive: true })
        return { code: 0, output: '' }
      },
      startSwap: (script, args) => swaps.push({ script, args })
    })
    for (const event of ['download-progress', 'update-downloaded', 'error']) updater.on(event, () => events.push(event))
    updater.autoDownload = true
    return { updater, commands, swaps, events, quitCount: () => quit }
  }

  it('finds the newer release, downloads it, checks it, and stages its app beside the running one', async () => {
    const { updater, commands, events } = await setup(sha)
    const result = await updater.checkForUpdates()
    expect(result).toMatchObject({ updateInfo: { version: '0.517.0' }, isUpdateAvailable: true })
    await result?.downloadPromise
    expect(events).toContain('update-downloaded')
    expect(commands.some((line) => line.startsWith('hdiutil attach') && line.includes('-nobrowse') && line.includes('-readonly'))).toBe(true)
    expect(commands.some((line) => line.startsWith('ditto ') && line.endsWith('.Locust-update.app'))).toBe(true)
    expect(commands.some((line) => line.startsWith('xattr -dr com.apple.quarantine'))).toBe(true)
    expect(commands.some((line) => line.startsWith('hdiutil detach'))).toBe(true)
  })

  it('refuses a download that does not match the release, and installs nothing', async () => {
    const { updater, commands, events } = await setup('0'.repeat(64))
    const result = await updater.checkForUpdates()
    await expect(result?.downloadPromise).rejects.toThrow(/does not match/)
    expect(events).toContain('error')
    expect(events).not.toContain('update-downloaded')
    expect(commands.some((line) => line.startsWith('ditto'))).toBe(false)
  })

  it('on Restart and install, hands the swap to the shell and quits', async () => {
    const { updater, swaps, quitCount } = await setup(sha)
    await (await updater.checkForUpdates())?.downloadPromise
    updater.quitAndInstall(true, true)
    await vi.waitFor(() => expect(quitCount()).toBe(1))
    expect(swaps).toHaveLength(1)
    expect(swaps[0]!.args).toEqual(['4242', join(root!, 'Locust.app'), join(root!, '.Locust-update.app')])
    expect(await readFile(swaps[0]!.script, 'utf8')).toBe(SWAP_SCRIPT)
  })

  it('offers nothing when this is already the newest', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-mac-update-'))
    const updater = createMacUpdater({ currentVersion: '0.517.0', arch: 'arm64', bundle: join(root, 'Locust.app'), cacheFolder: root, quit: () => undefined, fetchReleases: async () => releases(sha) })
    expect(await updater.checkForUpdates()).toMatchObject({ isUpdateAvailable: false })
  })
})

// The swap script itself, run by a real shell where there is one (Git Bash here, /bin/sh on the Mac runner).
const shell = (() => {
  try {
    execFileSync('sh', ['-c', 'true'])
    return true
  } catch {
    return false
  }
})()

describe.runIf(shell)('the swap script, run', () => {
  it('puts the new app in the old one\'s place and leaves nothing behind', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-swap-'))
    const app = join(root, 'Locust.app')
    const next = join(root, '.Locust-update.app')
    await mkdir(app); await writeFile(join(app, 'version'), 'old')
    await mkdir(next); await writeFile(join(next, 'version'), 'new')
    const script = join(root, 'swap.sh')
    await writeFile(script, SWAP_SCRIPT)
    // A pid that has already gone; `open` is not on this machine, which only ends the script.
    try { execFileSync('sh', [script, '999999', app.replace(/\\/g, '/'), next.replace(/\\/g, '/')], { stdio: 'ignore' }) } catch { /* `open` missing off a Mac */ }
    expect(await readFile(join(app, 'version'), 'utf8')).toBe('new')
    expect(existsSync(next)).toBe(false)
    expect(existsSync(`${app}.replaced`)).toBe(false)
  })

  it('and when the new one cannot be moved in, puts the old one back', async () => {
    root = await mkdtemp(join(tmpdir(), 'locust-swap-'))
    const app = join(root, 'Locust.app')
    await mkdir(app); await writeFile(join(app, 'version'), 'old')
    const script = join(root, 'swap.sh')
    await writeFile(script, SWAP_SCRIPT)
    try { execFileSync('sh', [script, '999999', app.replace(/\\/g, '/'), join(root, 'missing.app').replace(/\\/g, '/')], { stdio: 'ignore' }) } catch { /* `open` missing */ }
    expect(await readFile(join(app, 'version'), 'utf8')).toBe('old')
  })
})
