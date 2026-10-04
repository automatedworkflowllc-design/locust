import { describe, expect, it } from 'vitest'

import { newerMacRelease } from './mac-release.js'

/*
 * A Mac copy cannot update itself until it is signed (0.515); it says when a
 * newer one is out, with this chip's disk image. A tester on a Mac,
 * 2026-10-01: "oh no updates also, thats kind of rough".
 */
const base = 'https://github.com/automatedworkflowllc-design/locust-releases/releases/download'
const release = (tag: string, assets: readonly string[], extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: assets.map((name) => ({ name, browser_download_url: `${base}/${tag}/${name}` })),
  ...extra
})

describe('a Mac says when a newer Locust is out', () => {
  it('offers the newest release that has this chip\'s disk image', () => {
    const releases = [
      release('0.515.0', ['Locust-0.515.0-setup.exe']), // Windows first; the Mac build follows minutes later
      release('0.514.0', ['Locust-0.514.0-setup.exe', 'Locust-0.514.0-mac-arm64.dmg', 'Locust-0.514.0-mac-x64.dmg'])
    ]
    expect(newerMacRelease(releases, '0.512.0', 'arm64')).toEqual({ version: '0.514.0', url: `${base}/0.514.0/Locust-0.514.0-mac-arm64.dmg` })
    expect(newerMacRelease(releases, '0.512.0', 'x64')?.url).toBe(`${base}/0.514.0/Locust-0.514.0-mac-x64.dmg`)
  })

  it('offers nothing when this copy is already that version or newer', () => {
    const releases = [release('0.514.0', ['Locust-0.514.0-mac-arm64.dmg'])]
    expect(newerMacRelease(releases, '0.514.0', 'arm64')).toBeUndefined()
    expect(newerMacRelease(releases, '0.515.0', 'arm64')).toBeUndefined()
  })

  it('skips drafts and pre-releases, and never offers a link off the releases repository', () => {
    expect(newerMacRelease([release('0.520.0', ['Locust-0.520.0-mac-arm64.dmg'], { draft: true })], '0.514.0', 'arm64')).toBeUndefined()
    expect(newerMacRelease([release('0.520.0', ['Locust-0.520.0-mac-arm64.dmg'], { prerelease: true })], '0.514.0', 'arm64')).toBeUndefined()
    const elsewhere = [{ tag_name: '0.520.0', assets: [{ name: 'Locust-0.520.0-mac-arm64.dmg', browser_download_url: 'https://example.com/Locust.dmg' }] }]
    expect(newerMacRelease(elsewhere, '0.514.0', 'arm64')).toBeUndefined()
  })

  it('answers nothing for an answer that is not a list of releases', () => {
    expect(newerMacRelease(undefined, '0.514.0', 'arm64')).toBeUndefined()
    expect(newerMacRelease({ message: 'API rate limit exceeded' }, '0.514.0', 'arm64')).toBeUndefined()
  })
})
