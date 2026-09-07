import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseArtifact, readRuntimeArtifacts } from './runtime-artifacts.js'

describe('reading what a person set up in the CLIs themselves', () => {
  // Colin, 2026-09-07: "It would just be nice for them to be able to see the
  // routines/automations they've setup on their models." A machine with three
  // Codex agents and three Claude commands on it read "Nothing saved yet".
  describe('front matter', () => {
    it("reads Claude's YAML fences", () => {
      expect(
        parseArtifact(
          'gig-scout.md',
          '---\nname: gig-scout\ndescription: Scans venues for gigs\ntools: WebFetch\n---\n\nYou are the lead scout.'
        )
      ).toEqual({ name: 'gig-scout', description: 'Scans venues for gigs' })
    })

    it("reads Codex's TOML, single-quoted or double", () => {
      expect(
        parseArtifact('gig-scout.toml', 'name = "gig-scout"\ndescription = \'Scans venues for gigs\'\n')
      ).toEqual({ name: 'gig-scout', description: 'Scans venues for gigs' })
    })

    it('falls back to the filename, because the file existing is the point', () => {
      expect(parseArtifact('standup.md', 'Just prose, no front matter.')).toEqual({ name: 'standup' })
    })

    it('takes a description without a name, which is how commands are written', () => {
      expect(parseArtifact('pitch.md', '---\ndescription: Write a pitch\n---\n')).toEqual({
        name: 'pitch',
        description: 'Write a pitch'
      })
    })

    it('never reads past the front matter into the instructions', () => {
      // The body is the person's own prose and none of the app's business; a
      // `name:` line inside it must not be mistaken for the artifact's name.
      const parsed = parseArtifact(
        'a.md',
        '---\nname: real\n---\n\nSome prose that happens to contain\nname: not-the-name\n'
      )
      expect(parsed.name).toBe('real')
    })
  })

  describe('on disk', () => {
    const seed = async (): Promise<string> => {
      const home = await mkdtemp(join(tmpdir(), 'locust-artifacts-'))
      await mkdir(join(home, '.claude', 'agents'), { recursive: true })
      await mkdir(join(home, '.claude', 'commands'), { recursive: true })
      await mkdir(join(home, '.codex', 'agents'), { recursive: true })
      await writeFile(
        join(home, '.claude', 'agents', 'seo-scout.md'),
        '---\nname: seo-scout\ndescription: Audits visibility\n---\nbody',
        'utf8'
      )
      await writeFile(
        join(home, '.claude', 'commands', 'standup.md'),
        '---\ndescription: Write the standup\n---\nbody',
        'utf8'
      )
      await writeFile(
        join(home, '.codex', 'agents', 'proposal-writer.toml'),
        'name = "proposal-writer"\ndescription = "Writes proposals"\n',
        'utf8'
      )
      return home
    }

    it('lists agents and commands for the runtimes that are installed', async () => {
      const home = await seed()
      const found = await readRuntimeArtifacts({ installed: ['claude', 'codex'], home })
      expect(found.map((entry) => `${entry.runtime}/${entry.kind}/${entry.name}`).sort()).toEqual([
        'claude/agent/seo-scout',
        'claude/command/standup',
        'codex/agent/proposal-writer'
      ])
    })

    it('says nothing about a runtime that is not on this machine', async () => {
      // A leftover .claude/agents from an uninstall would otherwise read as a
      // working teammate's routine.
      const home = await seed()
      const found = await readRuntimeArtifacts({ installed: ['codex'], home })
      expect(found.every((entry) => entry.runtime === 'codex')).toBe(true)
    })

    it('is empty, not an error, when nobody has set any up', async () => {
      const home = await mkdtemp(join(tmpdir(), 'locust-artifacts-bare-'))
      await expect(readRuntimeArtifacts({ installed: ['claude', 'codex'], home })).resolves.toEqual([])
    })

    it('ignores files of the wrong kind', async () => {
      const home = await seed()
      await writeFile(join(home, '.claude', 'agents', 'notes.txt'), 'not an agent', 'utf8')
      const found = await readRuntimeArtifacts({ installed: ['claude'], home })
      expect(found.some((entry) => entry.name === 'notes')).toBe(false)
    })

    it('carries the path, so the app can say where to go and change it', async () => {
      const home = await seed()
      const found = await readRuntimeArtifacts({ installed: ['claude'], home })
      expect(found[0]?.path).toContain('.claude')
    })
  })
})
