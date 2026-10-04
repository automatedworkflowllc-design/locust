import { describe, expect, it } from 'vitest'

import { imageMediaType, isImagePath, MAX_PREVIEW_BYTES } from './image-files.js'

describe('deciding what to draw as a picture', () => {
  it('names the media type for the formats a browser paints', () => {
    expect(imageMediaType('shot.png')).toBe('image/png')
    expect(imageMediaType('photo.jpg')).toBe('image/jpeg')
    expect(imageMediaType('photo.jpeg')).toBe('image/jpeg')
    expect(imageMediaType('anim.gif')).toBe('image/gif')
    expect(imageMediaType('modern.webp')).toBe('image/webp')
  })

  it('does not care how the extension is cased', () => {
    // A screenshot off a camera or a Windows share is routinely SHOT.PNG.
    expect(imageMediaType('SHOT.PNG')).toBe('image/png')
    expect(isImagePath('Photo.JPG')).toBe(true)
  })

  it('reads the last extension, not the first', () => {
    expect(imageMediaType('archive.png.txt')).toBeUndefined()
    expect(imageMediaType('report.final.png')).toBe('image/png')
  })

  it('leaves everything else as a file', () => {
    for (const path of ['notes.md', 'main.ts', 'archive.tar.gz', 'README', 'data.json']) {
      expect(isImagePath(path), path).toBe(false)
      expect(imageMediaType(path), path).toBeUndefined()
    }
  })

  it('refuses SVG on purpose', () => {
    // THE test. An SVG is a document that can carry script and fetch remote
    // content, and this would be one chosen from anywhere on the machine and
    // painted inside the app. It still attaches and still reaches the
    // runtime; it is simply not drawn here.
    expect(isImagePath('icon.svg')).toBe(false)
  })

  it('handles a path with directories and a name with no dot at all', () => {
    expect(imageMediaType('src/assets/logo.png')).toBe('image/png')
    expect(imageMediaType('Makefile')).toBeUndefined()
    expect(imageMediaType('')).toBeUndefined()
    // A dotfile is not an extension.
    expect(imageMediaType('.gitignore')).toBeUndefined()
  })

  it('bounds a preview well above a screenshot and well below trouble', () => {
    expect(MAX_PREVIEW_BYTES).toBeGreaterThan(2 * 1024 * 1024)
    expect(MAX_PREVIEW_BYTES).toBeLessThanOrEqual(16 * 1024 * 1024)
  })
})
