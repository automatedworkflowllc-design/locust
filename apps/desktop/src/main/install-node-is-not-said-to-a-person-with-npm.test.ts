import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * "INSTALL NODE.JS" IS NOT SAID TO A PERSON WHO HAS IT (0.412).
 *
 * Colin, 2026-09-27: "got this popup even though i have everything". The note
 * showed when `npm --version` missed a five-second clock at launch, beside
 * every runtime probe -- one slow answer stood for the session. What the
 * person's terminal would find is looked up on the PATH instead, without the
 * app's own npm folders. drive-node-notice puts a slow npm on the PATH.
 */
const index = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')

describe("the note that the person's terminal needs Node", () => {
  it('is held back whenever the PATH itself has npm', () => {
    expect(index).toContain('npmIsBundled: async () => bundledNpm !== undefined && !(await npmPresent()) && !(await npmOnPath()),')
  })

  it("looks on the PATH alone -- the app's own locator would find the app's own npm", () => {
    expect(index).toContain("npmOnPathSeen = (await createPathExecutableLocator().find('npm').catch(() => undefined)) !== undefined")
  })
})
