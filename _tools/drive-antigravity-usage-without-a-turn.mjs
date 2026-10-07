// The real CLI's built-in usage command, then Home on the dev build. No turn sent.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { say, startDrive } from './drive-lib.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = join(root, '.tmp', 'antigravity-usage-drive')
await mkdir(scratch, { recursive: true })
// No shell, no credential lookup, no prompt: this is a CLI built-in command.
const result = await new Promise((resolve, reject) => execFile('agy', ['-p', '/usage', '--output-format', 'json'],
  { windowsHide: true, shell: false, timeout: 10_000, maxBuffer: 256 * 1024 },
  (error, stdout) => {
    if (error !== null) { reject(error); return }
    try { resolve(JSON.parse(stdout)) } catch (error) { reject(error) }
  }))
if (result.command?.name !== 'usage' || result.num_turns !== 0
  || !result.usage || Object.values(result.usage).some((count) => count !== 0)) throw new Error('usage was not a zero-turn, zero-token command')
say(`CLI: num_turns ${String(result.num_turns)}, token counts ${JSON.stringify(result.usage)}`)

const workspace = await mkdtemp(join(scratch, 'workspace-'))
const profile = await mkdtemp(join(scratch, 'profile-'))
const drive = await startDrive({
  name: 'antigravity-usage-without-a-turn', port: 9557, workspace, profilePath: profile,
  outPath: join(scratch, new Date().toISOString().replace(/[:.]/g, '-')),
  sendsNothing: true, focused: true,
  seed: { schemaVersion: 1,
    teammates: [{ teammateId: 'tm_usage', name: 'Helper', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-10-07T00:00:00Z' }],
    missionOwners: {}, settings: { swarm: false, relay: false, memoryMode: 'off', autoMode: false }
  }
})
let failures = 0
let checks = 0
const check = (what, ok, detail = '') => {
  checks += 1
  if (!ok) failures += 1
  say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail ? ` -- ${detail}` : ''}`)
}
try {
  await drive.ready()
  await drive.resize(1200, 760)
  // A late Antigravity discovery can patch the model catalog after the first Home frame.
  await drive.waitFor(`Array.from(document.querySelectorAll('.lc-agentmark')).some(mark => /Antigravity/i.test(mark.getAttribute('aria-label') ?? '') && /%.*left/.test(mark.getAttribute('aria-label') ?? ''))`,
    { timeoutMs: 60_000, what: 'the real Antigravity account reading on Home' })
  const seen = JSON.parse(await drive.capture('Antigravity plan usage on Home, without a turn', () => drive.evaluate(`(async () => {
    const mark = [...document.querySelectorAll('.lc-agentmark')].find(node => /Antigravity/i.test(node.getAttribute('aria-label') ?? ''))
    mark.focus()
    await new Promise(resolve => setTimeout(resolve, 300))
    const catalog = await window.desktop.listModels()
    const history = await window.desktop.getMissionHistory()
    return JSON.stringify({ card: mark.querySelector('.lc-agentcard')?.innerText,
      label: mark.getAttribute('aria-label'), reading: catalog.ok ? catalog.data.usageWindows?.antigravity : undefined,
      missions: history.ok ? history.data.missions.length : undefined })
  })()`)))
  check('Home names remaining Gemini windows', /Gemini: 5-hour window\s*\d+% left/.test(seen.card) && /Gemini: weekly window\s*\d+% left/.test(seen.card), seen.card.replace(/\s+/g, ' '))
  check('the screen reader also says left, not used', /% of the Gemini: 5-hour window left/.test(seen.label) && !/%.* used/.test(seen.label), seen.label)
  check('the account reading is timestamped', / · as of \d{4}-/.test(seen.reading ?? ''), seen.reading)
  check('no mission or turn was started', seen.missions === 0, String(seen.missions))
  check('no renderer errors were captured', drive.record.every(step => step.errors.length === 0))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Dev build. Real Antigravity /usage returned num_turns 0 and zero tokens. Home read on a fresh profile; no turn sent.', extra: `${String(checks - failures)} / ${String(checks)} checks passed.` })
}
say(`${String(checks - failures)} / ${String(checks)} CHECKS PASSED`)
process.exit(failures === 0 ? 0 : 1)
