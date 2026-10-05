import { describe, expect, it, vi } from 'vitest'
import { requestAttachedImage } from './components/AttachedImage.js'
import type { WorkspaceImageResponse } from '../../shared/ipc.js'

describe('an image request lives only with its row', () => {
  it('asks the host once with the row folder and accepts its data URL', async () => {
    const image = { ok: true as const, path: 'C:/copy/chart.png', dataUrl: 'data:image/png;base64,cA==' }
    const read = vi.fn(async () => image)
    const accept = vi.fn()
    requestAttachedImage('chart.png', 'C:/copy', read, accept)
    await Promise.resolve()
    expect(read).toHaveBeenCalledExactlyOnceWith('chart.png', 'C:/copy')
    expect(accept).toHaveBeenCalledExactlyOnceWith(image)
  })
  it('accepts no refused image or failed request and never asks for a non-image', async () => {
    const accept = vi.fn()
    const read = vi.fn(async (): Promise<WorkspaceImageResponse> => ({ ok: false, message: 'Outside the workspace.' }))
    requestAttachedImage('../private.png', 'C:/folder', read, accept)
    requestAttachedImage('notes.md', 'C:/folder', read, accept)
    requestAttachedImage('x.svg', 'C:/folder', read, accept)
    requestAttachedImage('bad.png', 'C:/folder', async () => { throw Error('unreadable') }, accept)
    await Promise.resolve(); await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(1)
    expect(accept).not.toHaveBeenCalled()
  })
  it('drops an answer that arrives after the row unmounts', async () => {
    let resolve!: (answer: WorkspaceImageResponse) => void
    const answer = new Promise<WorkspaceImageResponse>(done => { resolve = done })
    const accept = vi.fn()
    const close = requestAttachedImage('chart.png', 'C:/folder', () => answer, accept)
    close()
    resolve({ ok: true, path: 'C:/folder/chart.png', dataUrl: 'data:image/png;base64,cA==' })
    await Promise.resolve()
    expect(accept).not.toHaveBeenCalled()
  })
})
