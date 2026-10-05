/// <reference types="node" />
import { useContext } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { isImagePath } from '../../shared/image-files.js'
import { ThreadImagesContext } from './threadImages.js'
import { ActivityCard } from './components/ActivityCard.js'
import { AgentText } from './components/ThreadItems.js'
import { foldPlainToolRuns } from './missionView.js'
import type { ActivityDetail } from './missionView.js'

// SSR does not run effects. Supply the preview host's accepted/refused answer
// at that boundary; the separate request tests exercise the async lifecycle.
vi.mock('./components/AttachedImage.js', () => ({ AttachedImage: ({ path, render }: { path: string; render?: (url: string, absolute: string) => React.ReactElement }) => {
  const { folder } = useContext(ThreadImagesContext)
  const accepted = isImagePath(path) && folder !== undefined && !path.startsWith('..') && !path.includes(':') && !path.startsWith('/') && path !== 'refused.png'
  if (!accepted) return null
  return render?.('data:image/png;base64,cGljdHVyZQ==', `${folder}/${path}`) ?? <img src="data:image/png;base64,cGljdHVyZQ==" alt={path} />
} }))
function row(name: string, tool = 'Read', kind = 'searching'): string {
  const detail: ActivityDetail = { kind, name, tool, settled: true }
  return renderToStaticMarkup(<ThreadImagesContext.Provider value={{ folder: 'C:/conversation', onOpenFile: undefined }}><ActivityCard summary="Work" details={[detail]} runtimeName="Claude Code" workspacePath="C:/conversation" finished openByDefault /></ThreadImagesContext.Provider>)
}

describe('a thread shows local pictures', () => {
  it('draws an image under each runtime Read row while keeping its name', () => {
    for (const tool of ['Read', 'read_file', 'view_file', 'readFile', 'ReadToolCall']) {
      const html = row('chart.png', tool)
      expect(html).toContain('lc-threadimage__picture')
      expect(html).toContain('title="chart.png"')
      expect(html).toContain('>Read</span>')
    }
    expect(row('notes.md')).not.toContain('lc-threadimage__picture')
    expect(row('chart.png', 'Grep')).not.toContain('lc-threadimage__picture')
  })
  it('leaves a refused read row exactly as it was', () => {
    const html = row('refused.png')
    expect(html).toContain('title="refused.png"')
    expect(html).toContain('>Read</span>')
    expect(html).not.toContain('lc-threadimage')
    expect(html).not.toContain('<img')
  })
  it('draws a thumbnail below a changed image file, including a disk observation', () => {
    expect(row('red.png', 'Write', 'edit')).toContain('lc-threadimage__picture')
    const html = renderToStaticMarkup(<ThreadImagesContext.Provider value={{ folder: 'C:/conversation', onOpenFile: vi.fn() }}><ActivityCard summary="Edited 1 file" details={[{ kind: 'edit', name: 'red.png', tool: 'observed_edit', status: 'changed on disk', settled: true }]} runtimeName="Claude Code" workspacePath="C:/conversation" variant="files" openByDefault finished /></ThreadImagesContext.Provider>)
    expect(html).toContain('changed · seen on disk')
    expect(html).toContain('aria-label="Open red.png"')
    expect(html).toContain('lc-threadimage__picture')
  })
  it('draws a local Markdown image and uses its alt text as the caption', () => {
    const html = renderToStaticMarkup(<ThreadImagesContext.Provider value={{ folder: 'C:/conversation', onOpenFile: undefined }}><AgentText text="The result: ![Revenue chart](chart.png)" streaming={false} /></ThreadImagesContext.Provider>)
    expect(html).toContain('lc-threadimage__picture')
    expect(html).toContain('alt="Revenue chart"')
    expect(html).toContain('lc-threadimage__caption">Revenue chart')
    expect(html).not.toContain('![')
  })
  it('draws an image under a parsed changed-file row but never a deleted file', () => {
    const patch = (deleted: boolean) => ({ added: deleted ? 0 : 1, removed: deleted ? 1 : 0, truncated: false, text: `diff --git a/red.png b/red.png\n--- ${deleted ? 'a/red.png' : '/dev/null'}\n+++ ${deleted ? '/dev/null' : 'b/red.png'}\n@@ -${deleted ? '1' : '0,0'} +${deleted ? '0,0' : '1'} @@\n${deleted ? '-' : '+'}image\n` })
    const draw = (deleted: boolean) => renderToStaticMarkup(<ThreadImagesContext.Provider value={{ folder: 'C:/conversation', onOpenFile: vi.fn() }}><ActivityCard summary="Edited 1 file" details={[{ kind: 'edit', name: 'red.png', tool: 'Write', settled: true, patch: patch(deleted) }]} runtimeName="Claude Code" workspacePath="C:/conversation" openByDefault finished /></ThreadImagesContext.Provider>)
    expect(draw(false)).toContain('lc-threadimage__picture')
    expect(draw(true)).not.toContain('lc-threadimage__picture')
  })
  it('draws no outside, network, SVG or refused Markdown image', () => {
    for (const path of ['../private.png', 'https://example.com/graph.png', 'x.svg', 'refused.png']) {
      expect(renderToStaticMarkup(<ThreadImagesContext.Provider value={{ folder: 'C:/conversation', onOpenFile: undefined }}><AgentText text={`Before ![chart](${path}) after.`} streaming={false} /></ThreadImagesContext.Provider>)).not.toContain('<img')
    }
    expect(renderToStaticMarkup(<AgentText text="`![literal](chart.png)`" streaming={false} />)).toContain('![literal](chart.png)')
  })
  it('keeps image reads out of a folded run of plain tool names', () => {
    const entry = { kind: 'tool' as const, key: '1', name: 'chart.png', tool: 'Read', settled: true, failed: false }
    expect(foldPlainToolRuns([entry, { ...entry, key: '2', name: 'notes.md' }])).toHaveLength(2)
  })
  it('bounds the picture to the column width and 320 pixels without cropping', () => {
    const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8')
    const rule = css.split('\n').find(line => line.startsWith('.lc-threadimage__picture '))
    expect(rule).toContain('max-width: 100%')
    expect(rule).toContain('max-height: 320px')
    expect(rule).toContain('object-fit: contain')
  })
})
