import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareClaudeSkills } from './claude-skills.js'
import { createSkillLibrary, gitBlobId, parseRepositoryLink, skillDescription, type Fetcher } from './skill-library.js'

/*
 * 0.710. Skills from a GitHub repository: a person names one, sees every
 * skill in it with the files that run, and keeps what they pick at the one
 * commit they saw. A fake GitHub stands in: the tests send nothing.
 */

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

interface FakeFile {
  readonly text: string
  readonly mode?: string
}

/** A repository at one or more commits, served the way GitHub's API and raw host serve it. */
function fakeGitHub(repos: Record<string, { readonly branch?: string; readonly private?: boolean; readonly commits: Record<string, Record<string, FakeFile>> }>, extra: {
  readonly tamper?: string
  readonly limited?: boolean
} = {}): { readonly fetch: Fetcher; readonly asked: string[] } {
  const asked: string[] = []
  const headCommit = new Map<string, string>()
  for (const [name, repo] of Object.entries(repos)) headCommit.set(name.toLowerCase(), Object.keys(repo.commits).at(-1) as string)
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), { status, headers })
  const fetch: Fetcher = async (url) => {
    asked.push(url)
    if (extra.limited === true) return answer(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791500000' })
    const api = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.replace(/\?.*$/, ''))
    if (api !== null) {
      const key = `${api[1]}/${api[2]}`
      const entry = Object.entries(repos).find(([name]) => name.toLowerCase() === key.toLowerCase())
      if (entry === undefined || entry[1].private === true) return answer(404, { message: 'Not Found' })
      const [full, repo] = entry
      const rest = api[3] ?? ''
      if (rest === '') return answer(200, { full_name: full, default_branch: repo.branch ?? 'main', private: false })
      const commit = /^\/commits\/(.+)$/.exec(rest)
      if (commit !== null) {
        const ref = decodeURIComponent(commit[1] as string)
        if (ref === (repo.branch ?? 'main')) return answer(200, { sha: headCommit.get(full.toLowerCase()) })
        if (repo.commits[ref] !== undefined) return answer(200, { sha: ref })
        return answer(422, { message: 'No commit found' })
      }
      const tree = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest)
      if (tree !== null) {
        const files = repo.commits[tree[1] as string]
        if (files === undefined) return answer(404, { message: 'Not Found' })
        return answer(200, {
          sha: tree[1],
          truncated: false,
          tree: Object.entries(files).map(([path, file]) => ({
            path,
            mode: file.mode ?? '100644',
            type: 'blob',
            sha: gitBlobId(new TextEncoder().encode(file.text)),
            size: new TextEncoder().encode(file.text).length
          }))
        })
      }
      return answer(404, { message: 'Not Found' })
    }
    const raw = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(url)
    if (raw !== null) {
      const repo = Object.entries(repos).find(([name]) => name.toLowerCase() === `${raw[1]}/${raw[2]}`.toLowerCase())?.[1]
      const path = (raw[4] as string).split('/').map(decodeURIComponent).join('/')
      const file = repo?.commits[raw[3] as string]?.[path]
      if (file === undefined) return answer(404, '404: Not Found')
      return answer(200, path === extra.tamper ? `${file.text} and a little more` : file.text)
    }
    return answer(404, 'nowhere')
  }
  return { fetch, asked }
}

const PDF_SKILL = '---\nname: pdf\ndescription: "Fill and read PDF forms."\n---\n\nUse scripts/fill.py.\n'

const repoAtA: Record<string, FakeFile> = {
  'README.md': { text: 'Skills.' },
  'skills/pdf/SKILL.md': { text: PDF_SKILL },
  'skills/pdf/scripts/fill.py': { text: 'print("filled")\n' },
  'skills/pdf/tools/convert': { text: '#!/bin/sh\necho hi\n', mode: '100755' },
  'skills/pdf/reference.md': { text: 'Forms.' },
  'skills/pdf/link': { text: '../../README.md', mode: '120000' },
  'skills/brand/SKILL.md': { text: '---\ndescription: The house style.\n---\nBe brief.\n' },
  'skills/bad name/SKILL.md': { text: 'x' },
  'other/aux/SKILL.md': { text: 'x' },
  'tools/build.sh': { text: 'echo build' }
}
const repoAtB: Record<string, FakeFile> = {
  ...repoAtA,
  'skills/brand/SKILL.md': { text: '---\ndescription: The house style, revised.\n---\nBe briefer.\n' },
  'skills/pdf/scripts/fill.py': { text: 'print("filled twice")\n' }
}

const roots: string[] = []
async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'locust-skill-library-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('a GitHub link', () => {
  it('reads owner/repo, a github.com link, and a link to a folder on a branch', () => {
    expect(parseRepositoryLink('anthropics/skills')).toEqual({ owner: 'anthropics', repo: 'skills' })
    expect(parseRepositoryLink(' https://github.com/anthropics/skills.git/ ')).toEqual({ owner: 'anthropics', repo: 'skills' })
    expect(parseRepositoryLink('github.com/acme/kit/tree/v2/skills/pdf')).toEqual({ owner: 'acme', repo: 'kit', ref: 'v2', path: 'skills/pdf' })
    expect(parseRepositoryLink('https://github.com/acme/kit?tab=readme')).toEqual({ owner: 'acme', repo: 'kit' })
  })

  it('refuses what is not one', () => {
    for (const text of ['', 'acme', 'https://gitlab.com/acme/kit', 'file:///C:/kit', 'acme/kit/blob/main/x', 'acme/kit/tree/main/../x', 'acme/..']) {
      expect(parseRepositoryLink(text), text).toBeUndefined()
    }
  })

  it("reads a SKILL.md's description, quoted or not", () => {
    expect(skillDescription(PDF_SKILL)).toBe('Fill and read PDF forms.')
    expect(skillDescription('---\r\ndescription: plain\r\n---\r\n')).toBe('plain')
    expect(skillDescription('no front matter')).toBeUndefined()
  })
})

describe('skills from a GitHub repository', () => {
  it('lists each skill with its files, the ones that run marked, and keeps nothing yet', async () => {
    const root = await scratch()
    const github = fakeGitHub({ 'Acme/kit': { commits: { [SHA_A]: repoAtA } } })
    const library = createSkillLibrary({ root, fetch: github.fetch })
    const preview = await library.preview('acme/kit')

    expect(preview).toMatchObject({ source: 'Acme/kit', ref: 'main', sha: SHA_A, partial: false })
    const pdf = preview.skills.find((skill) => skill.name === 'pdf')
    expect(pdf?.description).toBe('Fill and read PDF forms.')
    expect(pdf?.held).toBeUndefined()
    // The link is not a file: never carried.
    expect(pdf?.files.map((file) => file.path).sort()).toEqual(['SKILL.md', 'reference.md', 'scripts/fill.py', 'tools/convert'])
    expect(pdf?.files.filter((file) => file.runs).map((file) => file.path).sort()).toEqual(['scripts/fill.py', 'tools/convert'])
    expect(preview.skills.find((skill) => skill.name === 'brand')?.description).toBe('The house style.')
    // A name Claude Code would not take, and one Windows cannot hold, are shown and held.
    expect(preview.skills.find((skill) => skill.name === 'bad name')?.held).toMatch(/not one Claude Code takes/)
    expect(preview.skills.find((skill) => skill.name === 'aux')?.held).toBeUndefined()
    // Only reads: nothing under the library yet.
    expect(await library.list()).toEqual([])
    expect(github.asked.every((url) => url.startsWith('https://api.github.com/') || url.startsWith('https://raw.githubusercontent.com/'))).toBe(true)
  })

  it('keeps the picked skills at the commit that was looked at, byte for byte', async () => {
    const root = await scratch()
    const repos = { 'acme/kit': { commits: { [SHA_A]: repoAtA } as Record<string, Record<string, FakeFile>> } }
    const github = fakeGitHub(repos)
    const library = createSkillLibrary({ root, fetch: github.fetch, now: () => new Date('2026-10-09T02:00:00Z') })
    const preview = await library.preview('https://github.com/acme/kit')
    // The branch moves on after the look: keeping still installs what was seen.
    repos['acme/kit'].commits[SHA_B] = repoAtB

    const sources = await library.install({ source: preview.source, ref: preview.ref, sha: preview.sha, names: ['pdf'] })
    expect(sources).toEqual([
      { source: 'acme/kit', ref: 'main', sha: SHA_A, keptAt: '2026-10-09T02:00:00.000Z', skills: [{ name: 'pdf', files: 4, bytes: expect.any(Number) as number, runs: ['scripts/fill.py', 'tools/convert'] }] }
    ])
    expect(await readFile(join(library.skillsFolder, 'pdf', 'scripts', 'fill.py'), 'utf8')).toBe('print("filled")\n')
    expect(await readFile(join(library.skillsFolder, 'pdf', 'SKILL.md'), 'utf8')).toBe(PDF_SKILL)
    expect((await readdir(library.skillsFolder)).sort()).toEqual(['pdf'])
    expect(github.asked.some((url) => url.includes(SHA_B))).toBe(false)
  })

  it('looking again shows what is kept, and keeping again replaces it with the new commit', async () => {
    const root = await scratch()
    const repos = { 'acme/kit': { commits: { [SHA_A]: repoAtA } as Record<string, Record<string, FakeFile>> } }
    const library = createSkillLibrary({ root, fetch: fakeGitHub(repos).fetch })
    const first = await library.preview('acme/kit')
    await library.install({ source: first.source, ref: first.ref, sha: first.sha, names: ['pdf', 'brand'] })

    repos['acme/kit'].commits[SHA_B] = repoAtB
    const library2 = createSkillLibrary({ root, fetch: fakeGitHub(repos).fetch })
    const again = await library2.preview('acme/kit')
    expect(again.sha).toBe(SHA_B)
    expect(again.skills.find((skill) => skill.name === 'pdf')?.keptAt).toBe(SHA_A)
    expect(again.skills.find((skill) => skill.name === 'brand')?.description).toBe('The house style, revised.')

    // Kept again with brand left unticked: brand goes, pdf moves to the new commit.
    const sources = await library2.install({ source: again.source, ref: again.ref, sha: again.sha, names: ['pdf'] })
    expect(sources.map((source) => [source.source, source.sha, source.skills.map((skill) => skill.name)])).toEqual([['acme/kit', SHA_B, ['pdf']]])
    expect(await readFile(join(library2.skillsFolder, 'pdf', 'scripts', 'fill.py'), 'utf8')).toBe('print("filled twice")\n')
    expect((await readdir(library2.skillsFolder)).sort()).toEqual(['pdf'])
  })

  it('a file that does not arrive as GitHub lists it keeps nothing at all', async () => {
    const root = await scratch()
    const repos = { 'acme/kit': { commits: { [SHA_A]: repoAtA } } }
    const looked = await createSkillLibrary({ root, fetch: fakeGitHub(repos).fetch }).preview('acme/kit')
    const library = createSkillLibrary({ root, fetch: fakeGitHub(repos, { tamper: 'skills/pdf/scripts/fill.py' }).fetch })

    await expect(library.install({ source: looked.source, ref: looked.ref, sha: looked.sha, names: ['brand', 'pdf'] })).rejects.toThrow(
      /pdf\/scripts\/fill\.py did not arrive as GitHub lists it\. Nothing was kept/
    )
    expect(await library.list()).toEqual([])
    expect(await readdir(root).catch(() => [])).not.toContain('skills')
    expect((await readdir(root).catch(() => [])).filter((name) => name.startsWith('.staging-'))).toEqual([])
  })

  it('and leaves no staging folder when the other files are still arriving as it refuses', async () => {
    // The 0.711 ship's unit run: the tampered file failed first, cleanup ran,
    // and a file still downloading wrote its folder back.
    const root = await scratch()
    const repos = { 'acme/kit': { commits: { [SHA_A]: repoAtA } } }
    const looked = await createSkillLibrary({ root, fetch: fakeGitHub(repos).fetch }).preview('acme/kit')
    const tampered = fakeGitHub(repos, { tamper: 'skills/pdf/scripts/fill.py' }).fetch
    const late: Fetcher = async (url, init) => {
      if (!url.endsWith('skills/pdf/scripts/fill.py')) await new Promise((resolve) => setTimeout(resolve, 40))
      return tampered(url, init)
    }
    const library = createSkillLibrary({ root, fetch: late })
    await expect(library.install({ source: looked.source, ref: looked.ref, sha: looked.sha, names: ['brand', 'pdf'] })).rejects.toThrow(/did not arrive as GitHub lists it/)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await readdir(root).catch(() => [])).filter((name) => name.startsWith('.staging-'))).toEqual([])
  })

  it('a name kept from one repository is held in another, and refused if asked anyway', async () => {
    const root = await scratch()
    const repos = {
      'acme/kit': { commits: { [SHA_A]: repoAtA } },
      'other/tools': { commits: { [SHA_B]: { 'pdf/SKILL.md': { text: '---\ndescription: Another pdf.\n---\n' } } } }
    }
    const library = createSkillLibrary({ root, fetch: fakeGitHub(repos).fetch })
    const kit = await library.preview('acme/kit')
    await library.install({ source: kit.source, ref: kit.ref, sha: kit.sha, names: ['pdf'] })

    const tools = await library.preview('other/tools')
    expect(tools.skills[0]?.held).toBe('A skill called pdf is kept from acme/kit. Remove that one to keep this.')
    await expect(library.install({ source: tools.source, ref: tools.ref, sha: tools.sha, names: ['pdf'] })).rejects.toThrow(/kept from acme\/kit/)

    // Removed, the name is free.
    expect(await library.remove('acme/kit')).toEqual([])
    expect(await readdir(library.skillsFolder)).toEqual([])
    const kept = await library.install({ source: tools.source, ref: tools.ref, sha: tools.sha, names: ['pdf'] })
    expect(kept.map((source) => source.source)).toEqual(['other/tools'])
  })

  it('says plainly what GitHub would not give', async () => {
    const root = await scratch()
    const repos = { 'acme/secret': { private: true, commits: { [SHA_A]: repoAtA } }, 'acme/empty': { commits: { [SHA_A]: { 'README.md': { text: 'none' } } } } }
    const library = createSkillLibrary({ root, fetch: fakeGitHub(repos).fetch })
    await expect(library.preview('acme/secret')).rejects.toThrow('No public repository at acme/secret. Locust reads public repositories only.')
    await expect(library.preview('acme/nothing')).rejects.toThrow(/No public repository at acme\/nothing/)
    await expect(library.preview('acme/empty')).rejects.toThrow('acme/empty has no skills: no folder in it holds a SKILL.md.')
    await expect(library.preview('not a link')).rejects.toThrow(/Paste a GitHub repository/)
    await expect(createSkillLibrary({ root, fetch: fakeGitHub(repos, { limited: true }).fetch }).preview('acme/empty')).rejects.toThrow(
      /GitHub's limit for looking without signing in is used up until .+\. Try again then\./
    )
    await expect(
      createSkillLibrary({ root, fetch: async () => { throw new TypeError('fetch failed') } }).preview('acme/empty')
    ).rejects.toThrow('Locust could not reach GitHub. Check the connection and try again.')
  })

  it("follows a redirect only to GitHub's own hosts", async () => {
    const root = await scratch()
    const github = fakeGitHub({ 'acme/kit': { commits: { [SHA_A]: repoAtA } } })
    // A renamed repository: the old name answers 301 to the new one, on api.github.com.
    const renamed: Fetcher = async (url, init) =>
      url === 'https://api.github.com/repos/acme/old-kit'
        ? new Response(null, { status: 301, headers: { location: 'https://api.github.com/repos/acme/kit' } })
        : github.fetch(url, init)
    expect((await createSkillLibrary({ root, fetch: renamed }).preview('acme/old-kit')).source).toBe('acme/kit')

    const elsewhere: Fetcher = async (url, init) =>
      url.startsWith('https://raw.githubusercontent.com/')
        ? new Response(null, { status: 302, headers: { location: 'https://files.example.com/fill.py' } })
        : github.fetch(url, init)
    const library = createSkillLibrary({ root, fetch: elsewhere })
    await expect(library.install({ source: 'acme/kit', ref: 'main', sha: SHA_A, names: ['brand'] })).rejects.toThrow(
      'GitHub sent Locust somewhere other than GitHub. Nothing was read from there.'
    )
    expect(github.asked.some((url) => url.includes('example.com'))).toBe(false)
    expect(await library.list()).toEqual([])
  })

  it('refuses a keep it was not shown: a name not in that commit, or no commit', async () => {
    const root = await scratch()
    const library = createSkillLibrary({ root, fetch: fakeGitHub({ 'acme/kit': { commits: { [SHA_A]: repoAtA } } }).fetch })
    await expect(library.install({ source: 'acme/kit', ref: 'main', sha: SHA_A, names: ['nope'] })).rejects.toThrow(/nope is not a skill/)
    await expect(library.install({ source: 'acme/kit', ref: 'main', sha: SHA_A, names: ['bad name'] })).rejects.toThrow(/Pick at least one/)
    await expect(library.install({ source: 'acme/kit', ref: 'main', sha: 'main', names: ['pdf'] })).rejects.toThrow(/Look at the repository again/)
    await expect(library.install({ source: '../kit', ref: 'main', sha: SHA_A, names: ['pdf'] })).rejects.toThrow(/not a repository/)
    expect(await library.list()).toEqual([])
  })
})

describe('a Claude run is handed the kept skills', () => {
  it('outside Auto beside the folder\'s own; in Auto, the kept ones alone', async () => {
    const root = await scratch()
    const library = createSkillLibrary({ root: join(root, 'library'), fetch: fakeGitHub({ 'acme/kit': { commits: { [SHA_A]: repoAtA } } }).fetch })
    const looked = await library.preview('acme/kit')
    await library.install({ source: looked.source, ref: looked.ref, sha: looked.sha, names: ['pdf', 'brand'] })
    const workspace = join(root, 'work')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(workspace, '.claude', 'skills', 'review'), { recursive: true })
    await writeFile(join(workspace, '.claude', 'skills', 'review', 'SKILL.md'), 'Review it.')

    const ask = await prepareClaudeSkills({ scratchRoot: join(root, 'copies'), workspacePath: workspace, ownSkills: false, libraryFolder: library.skillsFolder })
    expect(ask.plugins.map((plugin) => [plugin.name, plugin.skills])).toEqual([
      ['project', ['project:review']],
      ['library', ['library:brand', 'library:pdf']]
    ])
    const libraryPlugin = ask.plugins.find((plugin) => plugin.name === 'library')
    expect(JSON.parse(await readFile(join(libraryPlugin?.dir ?? '', '.claude-plugin', 'plugin.json'), 'utf8'))).toMatchObject({ name: 'library' })
    expect(await readFile(join(libraryPlugin?.dir ?? '', 'skills', 'pdf', 'scripts', 'fill.py'), 'utf8')).toBe('print("filled")\n')
    await ask.dispose()

    const auto = await prepareClaudeSkills({ scratchRoot: join(root, 'copies'), workspacePath: workspace, ownSkills: true, libraryFolder: library.skillsFolder, auto: true })
    expect(auto.plugins.map((plugin) => plugin.name)).toEqual(['library'])
    await auto.dispose()
    // The run's copy goes; the kept skills stay.
    expect((await readdir(library.skillsFolder)).sort()).toEqual(['brand', 'pdf'])
  })
})
