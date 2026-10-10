import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { colourCode, colouredAlready, grammarFor, languageOfPath, MAX_COLOURED_CHARACTERS } from './codeColors.js'
import { ColouredCode } from './components/ColouredCode.js'

/*
 * CODE IN A REPLY, IN COLOUR (0.719). Shiki is run for real here, with the
 * grammars Locust bundles; nothing is mocked.
 */
describe('code in a reply', () => {
  it('knows a fence by the words people write on it', () => {
    expect(grammarFor('ts')).toBe('typescript')
    expect(grammarFor('Python')).toBe('python')
    expect(grammarFor('bash')).toBe('shellscript')
    expect(grammarFor('ps1')).toBe('powershell')
    expect(grammarFor('c++')).toBe('cpp')
    expect(grammarFor('brainfudge')).toBeUndefined()
    expect(grammarFor(undefined)).toBeUndefined()
    // Not a key of the table's own prototype.
    expect(grammarFor('constructor')).toBeUndefined()
  })

  it('knows an opened file’s language by its name', () => {
    expect(languageOfPath('C:\\work\\shop\\cart.py')).toBe('py')
    expect(languageOfPath('src/App.TSX')).toBe('tsx')
    expect(languageOfPath('deploy/Dockerfile')).toBe('dockerfile')
    expect(languageOfPath('notes.txt')).toBeUndefined()
    expect(languageOfPath('.env')).toBeUndefined()
    expect(languageOfPath('README')).toBeUndefined()
  })

  it('is coloured with the theme’s own variables, and keeps every character', async () => {
    const code = 'const total = items.reduce((sum, item) => sum + item.price, 0) // the cart\nexport default "done"'
    const lines = await colourCode(code, 'ts')
    expect(lines).toBeDefined()
    expect(lines!.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(code)
    const colours = new Set(lines!.flat().map((token) => token.color).filter((colour) => colour !== undefined))
    expect([...colours].every((colour) => /^var\(--shiki-token-[a-z-]+\)$/.test(colour!))).toBe(true)
    expect(colours).toContain('var(--shiki-token-keyword)')
    expect(colours).toContain('var(--shiki-token-comment)')
    expect(colours).toContain('var(--shiki-token-string-expression)')
  })

  it('stays plain in a language it does not carry, or when too large', async () => {
    expect(await colourCode('++++[>++<-]', 'brainfudge')).toBeUndefined()
    expect(await colourCode('x'.repeat(MAX_COLOURED_CHARACTERS + 1), 'ts')).toBeUndefined()
  })

  it('draws plain first, and coloured at once when it was coloured before; never while it is being written', async () => {
    const code = 'def total(items):\n    return sum(items)'
    expect(renderToStaticMarkup(<ColouredCode code={code} language="py" />)).toBe(`<code>${code}</code>`)
    await colourCode(code, 'py')
    expect(colouredAlready(code, 'python')).toBeDefined()
    const shown = renderToStaticMarkup(<ColouredCode code={code} language="py" />)
    expect(shown).toContain('class="lc-code__coloured"')
    expect(shown).toContain('style="color:var(--shiki-token-keyword)"')
    expect(renderToStaticMarkup(<ColouredCode code={code} language="py" live />)).toBe(`<code>${code}</code>`)
  })
})
