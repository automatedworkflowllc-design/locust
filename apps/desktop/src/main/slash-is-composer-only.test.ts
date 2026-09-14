import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * A leading `/` is a command only where a PERSON typed it.
 *
 * grok-build's rule, read 2026-09-13 and stricter than anything written down
 * here: *"human parent text stays path-closed and still slash-inert"* -- even
 * the person's own words, once they have passed through an agent, may not
 * invoke a command. Authority is a property of the input, and it does not
 * travel with the text.
 *
 * Locust already holds this, by construction rather than by decision:
 * `slashQuery` reads the composer's own input state, and `runSlash` fires
 * only when somebody picks a row out of the composer's menu. A prompt string
 * -- a peer message, a relay hand-off, a routine step, a queued row, a review
 * brief -- reaches `startMission` and is never parsed for commands.
 *
 * That is worth one guard rather than a comment, because it is the kind of
 * invariant a reasonable future change breaks by accident: parsing a command
 * out of a mission prompt "so routines can use /plan" would read as a feature
 * and would hand every teammate the composer's controls. Peer text already
 * cannot carry a protocol block (`shared/protocolTags.ts`); this is the same
 * boundary on the other side of the composer.
 *
 * If a second surface genuinely needs to offer commands, it must take them
 * from what a person typed INTO THAT SURFACE, and this list grows by one with
 * a reason beside it.
 */
const RENDERER = fileURLToPath(new URL('../renderer/src/', import.meta.url))

/** The only files allowed to turn text into a command. */
const ALLOWED = new Set(['components/Composer.tsx', 'slashCommands.ts', 'slashCommands.test.ts'])

/** Every entry point that takes text and decides it is a command. */
const COMMAND_READERS = ['slashQuery', 'matchingCommands', 'availableCommands']

function sources(directory: string = RENDERER, prefix = ''): readonly string[] {
  const out: string[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const relative = prefix === '' ? name : `${prefix}/${name}`
    if (statSync(path).isDirectory()) {
      out.push(...sources(path, relative))
      continue
    }
    if (/\.tsx?$/.test(name)) out.push(relative)
  }
  return out
}

describe('a slash is a command only in the composer', () => {
  for (const reader of COMMAND_READERS) {
    it(`${reader} is called nowhere else`, () => {
      const callers = sources().filter((relative) => {
        if (ALLOWED.has(relative)) return false
        const text = readFileSync(join(RENDERER, relative), 'utf8')
        return new RegExp(`\\b${reader}\\s*\\(`).test(text)
      })
      expect(callers, `${reader} reached ${callers.join(', ')}`).toEqual([])
    })
  }

  it('the mission path never parses a prompt for commands', () => {
    // The specific accident this exists to stop: a teammate's message, a
    // routine step or a relay hand-off beginning with `/model` must be sent
    // as those words and nothing else.
    const app = readFileSync(join(RENDERER, 'App.tsx'), 'utf8')
    for (const reader of COMMAND_READERS) {
      expect(app, reader).not.toContain(`${reader}(`)
    }
  })
})
