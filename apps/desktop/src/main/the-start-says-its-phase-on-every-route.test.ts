import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * "STARTING <RUNTIME>" ON EVERY ROUTE (0.699).
 *
 * The live line says which phase a start is in (0.602), and the run's end
 * writes where the seconds went. Only the plain-process route said
 * `starting-runtime`: Codex's app server, OpenCode's server (every OpenCode
 * mode since 0.677) and Copilot's ACP went from "Reading the folder" -- long
 * done -- straight to "Working", and their note could not tell the CLI's own
 * boot from Locust's. Found by drive-the-start-says-its-phase on packaged
 * 0.698 (OpenCode: ["Reading the folder…","Working…"]).
 *
 * Each route is started by a different function against a different fake,
 * so this reads the one place they branch: every branch says the phase
 * before it starts its process.
 */
const source = readFileSync(fileURLToPath(new URL('./codex-mission.ts', import.meta.url)), 'utf8')

describe('the start says "Starting" on every route', () => {
  const branches: readonly [string, string, string][] = [
    ["Codex's app server", 'if (codexStreams) {', 'startCodexAppServerRun('],
    ["OpenCode's server", '} else if (opencodeServes) {', 'startOpenCodeServeRun('],
    ["Copilot's ACP", '} else if (copilotAcp) {', 'startAcpRun('],
    ['a plain process', "say('starting-runtime')\n              process = options.runner.start(", 'options.runner.start(']
  ]
  for (const [route, opens, starts] of branches) {
    it(`${route}: the phase is said before the process starts`, () => {
      const at = source.indexOf(opens)
      expect(at, `no branch "${opens}"`).toBeGreaterThan(-1)
      const said = source.indexOf("say('starting-runtime')", at)
      const started = source.indexOf(starts, at)
      expect(started, `no "${starts}" after "${opens}"`).toBeGreaterThan(-1)
      expect(said).toBeGreaterThan(-1)
      expect(said).toBeLessThan(started)
    })
  }
})
