// How often a quiet runtime speaks between its steps (0.682).
//
//   node _tools/drive-a-quiet-runtime-narrates.mjs [--packaged <exe>] [--tag <name>] [--runtime antigravity]
//
// Locust asks Antigravity, which otherwise works in silence, to say what it is doing (0.668). The line said
// "before each step", and a run of Colin's had 70 sentences for 69 steps. 0.682 asks for "whenever you start on
// something new". Eight separate commands in a scratch folder, in Auto (Ask lets it read all eight in one step); the record is counted: steps, and how many
// times the reply text broke in between. Prints the counts, and checks only that it still speaks at all. Spends
// one Antigravity turn on the person's own Google account.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { git, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const runtime = arg('--runtime') ?? 'antigravity'
const tag = arg('--tag') ?? (packaged === undefined ? 'local' : 'packaged')
const workspace = await scratchRepository('locust-drive-narrates-ws-')
const files = {
  'cart.py': 'def total(items):\n    return sum(i["price"] * i["qty"] for i in items)\n',
  'tax.py': 'RATE = 0.07\n\ndef with_tax(amount):\n    return round(amount * (1 + RATE), 2)\n',
  'discount.py': 'def apply(amount, code):\n    return amount * 0.9 if code == "SAVE10" else amount\n',
  'shipping.py': 'def cost(weight_kg):\n    return 5 if weight_kg < 1 else 5 + 2 * (weight_kg - 1)\n',
  'receipt.py': 'def line(name, amount):\n    return f"{name:<20}{amount:>8.2f}"\n',
  'inventory.py': 'STOCK = {"apple": 10, "pear": 0}\n\ndef available(name):\n    return STOCK.get(name, 0) > 0\n',
  'users.py': 'def greet(user):\n    return "Hello, " + user["name"]\n',
  'config.py': 'DEBUG = False\nCURRENCY = "USD"\n'
}
for (const [name, text] of Object.entries(files)) await writeFile(join(workspace, name), text, 'utf8')
await git(['add', '.'], workspace)
await git(['commit', '-q', '-m', 'shop'], workspace)

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-quiet-runtime-narrates-${tag}`, port: 9817, workspace, spends: true,
  outPath: join(recordRoot('a-quiet-runtime-narrates-2026-10-06'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_flash', name: 'Flash', hue: 'clay', role: 'Code & Migrations', createdAt: '2026-10-06T00:00:00.000Z', route: { runtime, model: 'account-default', mode: 'auto' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})
let failures = 0
try {
  await drive.ready()
  await drive.resize(1200, 820)
  say(`  ${String(await drive.evaluate(openTeammateScript('Flash')))}`)
  await drive.capture('Flash reads the shop', () => drive.evaluate(sendAndWaitScript('For each of the eight .py files in this folder, one file at a time, run python -m py_compile on it as its own command. Then tell me in a short list which ones compiled.', { waitSeconds: 360 })))
  const ledger = join(drive.profile, 'mission-ledger')
  let tools = 0
  let breaks = 0
  let last = ''
  for (const file of (await readdir(ledger)).filter((name) => name.endsWith('.jsonl'))) {
    for (const line of (await readFile(join(ledger, file), 'utf8')).split('\n')) {
      let event
      try { event = JSON.parse(line).event } catch { continue }
      if (event?.type === 'tool.started') { tools += 1; last = 'T' }
      if (event?.type === 'message.delta' && last !== 'M') { breaks += 1; last = 'M' }
    }
  }
  say(`  COUNTS ${runtime} ${tag}: ${String(tools)} steps, the reply broke ${String(breaks)} times`)
  if (breaks < 2) { failures += 1; say('  [FAIL] it said nothing between its steps') } else say('  [PASS] it spoke between its steps')
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. ${runtime} in Auto, eight commands in a scratch folder.`, extra: `Checks failed: ${String(failures)}` })
}
process.exit(failures === 0 ? 0 : 1)
