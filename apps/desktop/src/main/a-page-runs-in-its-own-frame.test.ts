import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createPageServer, fromPagePreview, isPagePath, PAGE_SCHEME } from './page-preview.js'

/**
 * A WEB PAGE RUNS IN LOCUST, IN A FRAME OF ITS OWN (0.425).
 *
 * Colin, 2026-09-28: "full functionality, sacrifice nothing." The page is
 * served from its own folder at its own origin; what may never happen is a
 * file outside the folder being served. drive-a-page-and-a-design runs a
 * page on the packaged build and has it report what it could reach.
 */
const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function site() {
  const outside = await mkdtemp(join(tmpdir(), 'locust-page-outside-'))
  const root = await mkdtemp(join(tmpdir(), 'locust-page-root-'))
  folders.push(outside, root)
  await writeFile(join(outside, 'secret.txt'), 'not for the page', 'utf8')
  await mkdir(join(root, 'site', 'css'), { recursive: true })
  await writeFile(join(root, 'site', 'index.html'), '<h1>Corner Shop</h1>', 'utf8')
  await writeFile(join(root, 'site', 'css', 'style.css'), 'h1 { color: rgb(1, 2, 3) }', 'utf8')
  const server = createPageServer({ roots: async () => [root] })
  const opened = await server.urlFor(join(root, 'site', 'index.html'))
  if (!opened.ok) throw new Error(opened.message)
  return { root, outside, server, url: opened.url }
}

describe('the page server', () => {
  it('gives a page inside the folder its own address, on its own scheme, with a random host', async () => {
    const { url } = await site()
    expect(url).toMatch(new RegExp(`^${PAGE_SCHEME}://[0-9a-f]{24}/site/index\\.html$`))
  })

  it('serves the page and what it links to, typed', async () => {
    const { server, url } = await site()
    const page = await server.handle(url)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect(await page.text()).toBe('<h1>Corner Shop</h1>')
    const style = await server.handle(url.replace('index.html', 'css/style.css'))
    expect(style.headers.get('content-type')).toContain('text/css')
  })

  it('serves a folder by its index.html', async () => {
    const { server, url } = await site()
    expect(await (await server.handle(url.replace('index.html', ''))).text()).toBe('<h1>Corner Shop</h1>')
  })

  it('never serves a file outside the folder: not by ../, not by an encoded ../', async () => {
    const { server, url, outside } = await site()
    const name = outside.split(/[\\/]/).pop()!
    for (const escape of [`../../${name}/secret.txt`, `..%2F..%2F${name}%2Fsecret.txt`, `%2e%2e/%2e%2e/${name}/secret.txt`]) {
      const answer = await server.handle(url.replace('site/index.html', escape))
      expect(answer.status, escape).not.toBe(200)
    }
  })

  it('never serves through a link inside the folder that points outside it', async () => {
    const { server, url, root, outside } = await site()
    const linked = await symlink(outside, join(root, 'site', 'escape'), 'junction').then(() => true, () => false)
    if (!linked) return
    const answer = await server.handle(url.replace('index.html', 'escape/secret.txt'))
    expect(answer.status).not.toBe(200)
  })

  it('answers nothing for a host it did not hand out', async () => {
    const { server } = await site()
    expect((await server.handle(`${PAGE_SCHEME}://000000000000000000000000/site/index.html`)).status).toBe(404)
  })

  it('gives no address to a page outside the folder, or to a file that is not a page', async () => {
    const { server, outside, root } = await site()
    await writeFile(join(outside, 'page.html'), '<p>x</p>', 'utf8')
    expect((await server.urlFor(join(outside, 'page.html'))).ok).toBe(false)
    expect((await server.urlFor(join(root, 'site', 'css', 'style.css'))).ok).toBe(false)
    expect(isPagePath('a/b/INDEX.HTM')).toBe(true)
  })
})

describe('which requests a page may make', () => {
  it('a page’s own frame, or anything it embedded, but never the app’s window', () => {
    const app = { url: 'file:///C:/Locust/resources/app.asar/out/renderer/index.html', parent: null }
    const page = { url: `${PAGE_SCHEME}://abc/site/index.html`, parent: app }
    const embedded = { url: 'https://www.youtube.com/embed/x', parent: page }
    expect(fromPagePreview(page)).toBe(true)
    expect(fromPagePreview(embedded)).toBe(true)
    expect(fromPagePreview(app)).toBe(false)
    expect(fromPagePreview(undefined)).toBe(false)
  })
})
