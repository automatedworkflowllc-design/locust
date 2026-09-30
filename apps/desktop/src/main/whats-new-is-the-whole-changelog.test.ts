import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { entries, splashEntries } from './changelog.js'

/**
 * WHAT'S NEW IS THE WHOLE CHANGELOG, AND A SPLASH IS FOR A BIG BUILD ONLY.
 *
 * Colin, 2026-09-23, with a frame of Claude Code's What's new: "we can really
 * get this and just introduce a proper changelog the way claude code does, if
 * we have really good big updates where the user has to know things, we can
 * have a splash page on update" -- and, of the home banner, "it adds a
 * needless scrollbar on that title menu".
 */

const FILE = [
  '# Changelog',
  '',
  '## 0.281.0 - 2026-09-23',
  '',
  '### New',
  '',
  "- **What's new, in Settings.** Every version.",
  '',
  '### Improved',
  '',
  '- **No banner.** Gone.',
  '',
  '## 0.280.0 - 2026-09-23',
  '',
  '- **Antigravity asks here.** Written before the groups.',
  '',
  '## 0.277.0 - 2026-09-22',
  '<!-- big -->',
  '',
  '- **Every teammate is a bot.**',
  '',
  '## 0.276.0 - 2026-09-22',
  '',
  '- **Dialogs fit.**'
].join('\n')

describe('an entry', () => {
  it("keeps its groups -- New, Improved, Fixed -- as Claude Code's What's new does", () => {
    const [newest] = entries(FILE)
    expect(newest?.groups).toEqual([
      { label: 'New', text: "- **What's new, in Settings.** Every version." },
      { label: 'Improved', text: '- **No banner.** Gone.' }
    ])
  })

  it('written before the groups, stays as it was written: one group, no label guessed for it', () => {
    expect(entries(FILE)[1]?.groups).toEqual([{ text: '- **Antigravity asks here.** Written before the groups.' }])
  })

  it('marked big says so, and the mark itself is nowhere in what is shown', () => {
    const bot = entries(FILE).find((entry) => entry.version === '0.277.0')
    expect(bot?.big).toBe(true)
    expect(bot?.body).not.toContain('<!--')
    expect(JSON.stringify(bot?.groups)).not.toContain('<!--')
    expect(entries(FILE).filter((entry) => entry.big).map((entry) => entry.version)).toEqual(['0.277.0'])
  })
})

describe('the splash', () => {
  const all = entries(FILE)

  it('shows the big builds between the one last seen and the one running', () => {
    expect(splashEntries(all, '0.276.0', '0.281.0').map((entry) => entry.version)).toEqual(['0.277.0'])
  })

  it('shows nothing when nothing big came since, on the same version, or on a first install', () => {
    expect(splashEntries(all, '0.277.0', '0.281.0')).toEqual([])
    expect(splashEntries(all, '0.281.0', '0.281.0')).toEqual([])
    expect(splashEntries(all, undefined, '0.281.0')).toEqual([])
  })

  it('shows nothing when the version last seen is not in the file -- a splash about the wrong builds is worse', () => {
    expect(splashEntries(all, '9.9.9', '0.281.0')).toEqual([])
    expect(splashEntries(all, '0.280.0', '0.276.0')).toEqual([])
  })
})

describe('the changelog that ships', () => {
  const shipped = readFileSync(fileURLToPath(new URL('../../../../CHANGELOG.md', import.meta.url)), 'utf8')
  const all = entries(shipped)

  it('is read whole: hundreds of builds, each with something to say', () => {
    expect(all.length).toBeGreaterThan(300)
    expect(all.every((entry) => entry.groups.length > 0)).toBe(true)
  })

  it("gives someone arriving from 0.276 the bots, the machine, the design pass, their own model, a room that remembers, pages that run each runtime's own commands a monochrome Locust, hand-off chains, landing a teammate's branch, comparing models, comparing their work and building to compare; from 0.448 nothing", () => {
    // 0.295.0 is big too: the title screen became a machine (A2). 0.350.0:
    // the first-impressions design pass -- Home leads with the team, a
    // conversation reads like Claude's (Colin, 2026-09-26). 0.357.0: Add your
    // own model, for a company that has one (Colin, the same day). 0.370.0:
    // a room remembers what was said -- the first thing the rooms research of
    // the same day said to build. 0.425.0: a web page a teammate made runs
    // inside Locust (Colin, 2026-09-28: "full functionality, sacrifice nothing").
    // 0.426.0: Claude Code's own slash commands in the / menu (Colin, the
    // same day: "the nerdier coders live by their commands"). 0.434.0: the
    // lime accent goes monochrome (Colin, the same day).
    // 0.440.0: a teammate's own branch lands on yours as one commit -- idea #2
    // of the product suggestions, which Colin picked the same day.
    // 0.441.0: compare models side by side (Colin, the same day: "works for me!").
    // 0.445.0: a comparison can compare the work -- each model edits its own copy,
    // Keep brings one in (Colin, the same day: "a room where you can compare work").
    // 0.448.0: build and compare from Home, in any folder (Colin, the same day:
    // "Keep working big dog", to a starter on Home).
    // 0.458.0: folders like Claude Code -- switch without a restart, every folder's
    // conversations by project (Colin, 2026-09-29: "Just make it work exactly like Claude code").
    // 0.462.0: ask on the side -- a question on a copy of a conversation (Devin's side chats).
    // 0.474.0: projects like Claude's, and math drawn (Colin, 2026-09-29: "claude has projects/and workspace folders").
    // 0.501.0: the Finances place (a tester's ask: Codex's Finances, inside Locust).
    // 0.498.0: edit an earlier message and start again from there (Claude Code's rewind).
    // 0.491.0: a turn reads like Claude Code's, its steps as lines between what was said (Colin, 2026-09-30: "ALL of our commands ... get rolled into the bar").
    const newest = all[0]!.version
    expect(splashEntries(all, '0.276.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0', '0.435.0', '0.434.0', '0.426.0', '0.425.0', '0.370.0', '0.357.0', '0.350.0', '0.295.0', '0.277.0'])
    expect(splashEntries(all, '0.280.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0', '0.435.0', '0.434.0', '0.426.0', '0.425.0', '0.370.0', '0.357.0', '0.350.0', '0.295.0'])
    expect(splashEntries(all, '0.295.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0', '0.435.0', '0.434.0', '0.426.0', '0.425.0', '0.370.0', '0.357.0', '0.350.0'])
    expect(splashEntries(all, '0.350.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0', '0.435.0', '0.434.0', '0.426.0', '0.425.0', '0.370.0', '0.357.0'])
    expect(splashEntries(all, '0.357.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0', '0.435.0', '0.434.0', '0.426.0', '0.425.0', '0.370.0'])
    expect(splashEntries(all, '0.370.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0', '0.435.0', '0.434.0', '0.426.0', '0.425.0'])
    expect(splashEntries(all, '0.425.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0', '0.435.0', '0.434.0', '0.426.0'])
    expect(splashEntries(all, '0.426.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0', '0.435.0', '0.434.0'])
    expect(splashEntries(all, '0.434.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0', '0.435.0'])
    expect(splashEntries(all, '0.435.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0', '0.440.0'])
    expect(splashEntries(all, '0.440.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0', '0.441.0'])
    expect(splashEntries(all, '0.441.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0', '0.445.0'])
    expect(splashEntries(all, '0.445.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0', '0.448.0'])
    expect(splashEntries(all, '0.448.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0', '0.458.0'])
    expect(splashEntries(all, '0.458.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0', '0.462.0'])
    expect(splashEntries(all, '0.462.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0', '0.474.0'])
    expect(splashEntries(all, '0.474.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0', '0.491.0'])
    expect(splashEntries(all, '0.491.0', newest).map((entry) => entry.version)).toEqual(['0.501.0', '0.498.0'])
    expect(splashEntries(all, '0.498.0', newest).map((entry) => entry.version)).toEqual(['0.501.0'])
    expect(splashEntries(all, '0.501.0', newest)).toEqual([])
  })
})

describe('the home banner', () => {
  it('is gone: What changed lives in Settings, and a big build gets the splash', () => {
    const app = readFileSync(fileURLToPath(new URL('../renderer/src/App.tsx', import.meta.url)), 'utf8')
    const screens = readFileSync(fileURLToPath(new URL('../renderer/src/components/Screens.tsx', import.meta.url)), 'utf8')
    expect(app).not.toContain('WhatChangedBanner')
    expect(screens).not.toContain('Here is what changed')
    expect(app).toContain('<WhatsNewSplash')
    expect(screens).toContain("shownPage === 'whatsnew'")
  })
})
