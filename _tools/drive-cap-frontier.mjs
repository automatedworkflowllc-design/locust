// Independent, free-only measurement. Existing drives and production limits
// are not edited by this harness. Raise BOTH limits locally before N > 8.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

// Isolate drive-lib's scratch housekeeping from all earlier user sessions.
process.env.LOCUST_SCRATCH = join(homedir(), 'Documents', 'locust-frontier-scratch-20260909')
const { FREE_ROUTE, scratchRepository, startDrive, sleep } = await import('./drive-lib.mjs')
const { createFileMissionLedger } = await import('../packages/mission-store/dist/index.js')
const run = promisify(execFile)
const n = Number(process.env.COUNT ?? 1)
const mode = process.env.CAP_MODE ?? 'ask'
assert.ok(Number.isInteger(n) && n >= 1 && n <= 16)
assert.ok(['ask', 'accept-edits'].includes(mode))
assert.equal(FREE_ROUTE.runtime, 'opencode')
assert.match(FREE_ROUTE.model, /-free$/)
const brief = 'This is an isolated throughput fixture. Follow the requested output length exactly. Do not shorten, summarise, or impose a one-paragraph limit. Do not send peer messages or delegate. If asked to write, touch only your own named output file.\n'
const count = 500
const names = ['Wren', 'Booty', 'Gem', 'Fen', 'Otto', 'Pike', 'Ash', 'Bryn', 'Cove', 'Dell', 'Ember', 'Flint', 'Gale', 'Hollis', 'Iver', 'Juno'].slice(0, n)
// With memory/swarm off the room briefing lists everyone EXCEPT the recipient,
// but never names the recipient. The first solo refused because of that. Make
// the fixture assignment explicit without changing production or enabling peers.
const assignment = `The complete test roster is ${names.join(', ')}. Your assigned filename label is ${n === 1 ? 'Wren' : 'the ONE name in that roster absent from the room briefing\'s list after "with"'}. This is a test assignment, not a claim about your model identity. Use that label for your output filename. `
const prompt = mode === 'ask'
  ? `Count from 1 to ${count}, one number per line, in order. Output all ${count} lines; no commentary, no summarising, no omissions. Do not use tools or edit files.`
  : assignment + `Write numbers 1 to ${count}, one number per line, to your assigned label's .txt file: Wren.txt for Wren, Booty.txt for Booty, and so on. Use FIVE SEPARATE sequential tool calls: write 1-100, then append 101-200, then 201-300, then 301-400, then 401-500. After each call give one short progress sentence. Do not combine these into one tool call. Do not touch another teammate's file or any other file. Finally print the entire count 1 to ${count}, one number per line, with no omissions or summary. The five progress sentences before the final answer are allowed.`

function numbers(text) {
  return [...text.matchAll(/^\s*(\d{1,4})\s*$/gm)].map((m) => Number(m[1]))
}
function complete(text) {
  const actual = numbers(text)
  return actual.length === count && actual.every((value, index) => value === index + 1)
}
function transcript(events) {
  const items = new Map()
  for (const event of events) {
    if (event.type !== 'message.delta') continue
    const { itemId, text, operation } = event.payload
    items.set(itemId, operation === 'append' ? (items.get(itemId) ?? '') + text : text)
  }
  return [...items.values()].join('\n')
}
function sameEvents(a, b) { return JSON.stringify(a) === JSON.stringify(b) }
const good = Array.from({ length: count }, (_, i) => i + 1).join('\n')
// Answers allow progress prose. Output FILES must contain only the requested
// lines; extracting numeric lines would falsely accept appended garbage.
function exactFile(text) { return text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\n$/,'') === good }
assert.ok(complete(good))
assert.equal(complete(''), false)
assert.equal(complete(good.replace('\n237\n', '\n')), false)
assert.equal(complete(good.replace('\n237\n', '\n238\n')), false)
assert.equal(sameEvents([{ sequence: 1 }], []), false)
assert.equal(sameEvents([{ sequence: 1 }], [{ sequence: 1 }]), true)
assert.ok(exactFile(good+'\n'))
assert.equal(exactFile(good+'\nunrequested prose'),false)
assert.equal(exactFile(''),false)
console.error('CONTROLS: empty, missing, duplicate output and missing event rejected')
if (process.argv.includes('--self-test')) process.exit(0)

const workspace = await scratchRepository('locust-frontier-ws-', brief)
assert.equal(await readFile(join(workspace, 'LOCUST.md'), 'utf8'), brief)
const drive = await startDrive({ name: `frontier-${mode}-${n}`, port: 9441, workspace, keep: true,
  seed: { schemaVersion: 1, teammates: names.map((name, i) => ({ teammateId: `tm_${name.toLowerCase()}`, name,
    hue: ['lime', 'blue', 'clay', 'violet'][i % 4], role: 'Code & Migrations',
    createdAt: `2026-09-09T05:00:${String(i).padStart(2, '0')}.000Z`, route: { ...FREE_ROUTE, mode } })),
    missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
const samples = []
const sampleErrors = []
let watching = true
let rootPid
let postedAt
let finishedAt
let measurementError
const sampler = fileURLToPath(new URL('./cap-process-sample.ps1', import.meta.url))
async function sample() {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-File', sampler, '-ProfilePath', drive.profile], { windowsHide: true, timeout: 10000 })
  const data = JSON.parse(stdout)
  assert.ok(data.rootPid > 0 && data.processes.length > 0 && data.totalBytes > 0 && data.cores > 0, 'No process data')
  if (rootPid !== undefined) assert.equal(data.rootPid, rootPid)
  rootPid = data.rootPid
  samples.push(data)
  return data
}
let watch
const result = { n, mode, route: { ...FREE_ROUTE, mode }, brief, prompt, workspace, profile: drive.profile,
  pinnedMain: 'e05ac6ddcf6b4fb9936533753067fed06a590b53', count, workloadRevision: 2, notes: [] }
try {
  await drive.ready()
  // Keep the public readiness result rather than interpreting the connected
  // count as proof that this particular runtime can start. Do not refresh or
  // bypass the host's discovery policy during the measured dispatch loop.
  result.readinessBeforeRun = await drive.evaluate('window.desktop.getLocalRuntimes()')
  await sample()
  watch = (async () => { while (watching) { await sleep(1000); if (!watching) break
    try { await sample() } catch (error) { sampleErrors.push(String(error)) }
  } })()
  await drive.evaluate(`(() => {
    window.__frontier = { updates: [], ticks: [], startedAt: Date.now() };
    window.desktop.onCodexMissionUpdate(u => window.__frontier.updates.push({ atMs: Date.now(), update: u }));
    window.__frontier.timer = setInterval(() => window.__frontier.ticks.push(Date.now()), 250);
    return true;
  })()`)
  await drive.capture('idle sidebar', () => `N=${n}; ${mode}; brief=${JSON.stringify(brief)}`)
  const made = await drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', ctrlKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    const input = document.querySelector('input[aria-label="Room name"]');
    if (!input) throw new Error('No room input');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, 'Frontier'); input.dispatchEvent(new Event('input', { bubbles: true }));
    const members = [...document.querySelectorAll('[role=group][aria-label="Teammates in the room"] [role=checkbox]')];
    if (members.length !== ${n}) throw new Error('Wrong room roster ' + members.length);
    for (const member of members) if (member.getAttribute('aria-checked') !== 'true') member.click();
    await new Promise(r => setTimeout(r, 300));
    const create = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Create room');
    if (!create || create.disabled) throw new Error('Room blocked');
    create.click(); await new Promise(r => setTimeout(r, 900));
    return document.querySelector('.lc-roomcompose__box') !== null;
  })()`)
  assert.equal(made, true, 'No room means no measurement')
  postedAt = Date.now()
  assert.equal(await drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-roomcompose__box');
    if (!box) throw new Error('No composer');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(prompt)});
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    document.querySelector('.lc-roomcompose').requestSubmit(); return true;
  })()`), true)
  let activeCaptured = false
  let settled = false
  for (let attempt = 0; attempt < 210; attempt += 1) {
    await sleep(1000)
    const status = await drive.evaluate(`(() => ({
      phases: [...document.querySelectorAll('.lc-roomanswer__phase')].map(e => e.textContent.trim()),
      events: window.__frontier.updates.length
    }))()`)
    assert.ok(status && Array.isArray(status.phases), 'No live status data')
    if (status.phases.some(p => /did not start/i.test(p)) && !result.dispatchRefusal) {
      result.dispatchRefusal = { count:status.phases.filter(p=>/did not start/i.test(p)).length,
        text:await drive.evaluate('document.body.innerText') }
      console.error('PARTIAL DISPATCH: ' + result.dispatchRefusal.count + ' refused; allow accepted missions to finish')
      // A refused member disproves the requested-N premise, but aborting the
      // others would manufacture partial files. Keep their completion evidence.
      if (result.dispatchRefusal.count === n) throw new Error('All missions refused; no concurrency data')
    }
    if (!activeCaptured && status.phases.length === n && status.events > n) {
      await drive.capture('active room and sidebar', () => JSON.stringify(status)); activeCaptured = true
      console.error(`ACTIVE N=${n}, events=${status.events}`)
    }
    if (status.phases.length === n && status.phases.every(p => /completed|failed|cancelled|did not start/i.test(p))) { settled = true; finishedAt = Date.now(); break }
    if (attempt % 15 === 0) console.error(`N=${n} elapsed=${Math.round((Date.now()-postedAt)/1000)}s ${JSON.stringify(status)}`)
    if (samples.at(-1)?.freeBytes < 1.5 * 1024 ** 3) throw new Error('SAFETY STOP: free RAM below 1.5 GiB')
  }
  if (!settled) throw new Error('Timed out after observation budget; not a completed run')
  await sleep(2500)
  const captured = await drive.evaluate(`(() => {
    clearInterval(window.__frontier.timer);
    return { ...window.__frontier, cards: [...document.querySelectorAll('.lc-roomanswer')].map(c => ({
      name: c.querySelector('.lc-face')?.getAttribute('aria-label')?.trim(),
      phase: c.querySelector('.lc-roomanswer__phase')?.textContent.trim(),
      text: c.querySelector('.lc-roomanswer__text')?.textContent ?? ''
    })) };
  })()`)
  assert.ok(captured?.updates.length > 0, 'No events; cannot conclude')
  await writeFile(join(drive.out, 'observed-updates.json'), JSON.stringify(captured, null, 2))
  await drive.capture('settled room', () => JSON.stringify(captured.cards.map(c => ({ name: c.name, phase: c.phase, numbers: numbers(c.text).length }))))
  await drive.capture('missions overview', () => drive.evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 900)); return document.querySelector('.lc-screen__meta')?.innerText;
  })()`))
  const ledger = createFileMissionLedger({ rootDirectory: join(drive.profile, 'mission-ledger') })
  const snapshot = await ledger.listMissions({ limit: 30 })
  assert.equal(snapshot.missions.length, n-(result.dispatchRefusal?.count??0), 'Missing accepted ledger mission')
  result.ledgerIssues = snapshot.issues
  result.cards = captured.cards.map(c => ({ ...c, exactCount: complete(c.text), numberCount: numbers(c.text).length }))
  result.missions = []
  for (const mission of snapshot.missions) {
    assert.equal(mission.metadata.runtime, 'opencode', 'Unexpected paid runtime')
    assert.equal(mission.metadata.model, FREE_ROUTE.model, 'Wrong model')
    const seen = captured.updates.filter(u => u.update.kind === 'event' && u.update.missionId === mission.metadata.missionId)
    const text = transcript(mission.events)
    result.missions.push({ missionId: mission.metadata.missionId, phase: mission.phase, model: mission.metadata.model,
      sandbox: mission.metadata.sandbox, events: mission.events.length, identicalObservedEvents: sameEvents(seen.map(u => u.update.event), mission.events),
      sequencesContiguous: mission.events.every((e, i) => e.sequence === i + 1), issues: mission.issues,
      exactCount: complete(text), numberCount: numbers(text).length,
      firstObservedMs: seen[0]?.atMs, lastObservedMs: seen.at(-1)?.atMs,
      eventLagsMs: seen.map(u => u.atMs - Date.parse(u.update.event.occurredAt)),
      failures: mission.events.filter(e => /failed|limit|error/.test(e.type)), hostFailures: mission.hostFailures,
      processReceipt: mission.events.findLast(e => e.payload?.process)?.payload.process,
      transportSequences: [...new Set(mission.events.map(e => e.payload?.evidence?.transportSequence).filter(Number.isInteger))],
      textSha256: createHash('sha256').update(text).digest('hex') })
  }
  result.nonEventUpdates = captured.updates.filter(u => u.update.kind !== 'event')
  result.maxRendererTickGapMs = Math.max(0, ...captured.ticks.slice(1).map((t,i) => t-captured.ticks[i]))
  // Do not infer concurrency from mission-started: room dispatch batches those
  // notifications after starting everyone. The summarizer uses receipt times.
  result.notes.push('Use receipt interval overlap, not batched mission-started notifications, for concurrency.')
  result.writes = []
  if (mode === 'accept-edits') for (const name of names) {
    const path = join(workspace, `${name}.txt`)
    try { const text = await readFile(path, 'utf8'); result.writes.push({ name, exactCount: exactFile(text), numberCount: numbers(text).length,
      textSha256:createHash('sha256').update(text).digest('hex') }) }
    catch (error) { result.writes.push({ name, missing: true, error: String(error) }) }
  }
  result.workspaceFiles = await readdir(workspace)
} catch (error) {
  measurementError = String(error); result.error = measurementError; console.error(measurementError); process.exitCode = 1
  // Preserve the failure BEFORE harness cancellation changes the evidence.
  const failed = await drive.evaluate(`(async () => ({ updates: window.__frontier?.updates ?? [], text: document.body.innerText,
    readiness: await window.desktop.getLocalRuntimes() }))()`)
  await writeFile(join(drive.out, 'failure-before-cancel.json'), JSON.stringify(failed,null,2))
  await drive.capture('failure before harness cancellation', () => measurementError)
} finally {
  watching = false; await watch
  // Cancel only this profile's observed runs before closing its process tree.
  if (measurementError) await drive.evaluate(`(async () => {
    const ids = [...new Set((window.__frontier?.updates ?? []).map(u => u.update.runId).filter(Boolean))];
    return Promise.all(ids.map(runId => window.desktop.cancelCodexMission({ runId })));
  })()`)
  result.postedAt = postedAt; result.finishedAt = finishedAt
  result.wallMs = finishedAt === undefined ? undefined : finishedAt - postedAt
  result.sampleErrors = sampleErrors
  result.captures = drive.record
  result.samples = samples
  const totals = samples.map(s => s.processes.reduce((sum,p) => sum+p.rssBytes,0))
  result.peakRssBytes = Math.max(0,...totals)
  result.baselineRssBytes = totals[0]
  result.minFreeBytes = Math.min(...samples.map(s => s.freeBytes))
  const cpu = []; const previous = new Map()
  for (const s of samples) {
    let usedMs = 0
    for (const p of s.processes) { const key = `${p.pid}:${p.created}`; const prev = previous.get(key)
      if (previous.size > 0) usedMs += Math.max(0, p.cpuMs-(prev ?? 0))
      previous.set(key,p.cpuMs)
    }
    cpu.push({ atMs: s.atMs, usedMs })
  }
  result.cpuIntervals = cpu.slice(1).map((s,i) => ({ atMs:s.atMs, coresUsed:s.usedMs/(s.atMs-cpu[i].atMs) }))
  await writeFile(join(drive.out,'measurement.json'), JSON.stringify(result,null,2))
  // Reconfirm the profile-owned root before terminating it. Doing this after
  // finish() killed the parent could orphan children or target a reused PID.
  try { if (rootPid) { await sample(); await run('taskkill.exe', ['/PID',String(rootPid),'/T','/F'], {windowsHide:true}) } }
  catch (error) { console.error('Profile cleanup check: ' + String(error)) }
  await drive.finish({ intro: `Pinned e05ac6d; free route ${FREE_ROUTE.model}; N=${n}; mode=${mode}; exact brief and prompt in measurement.json. Temporary local cap build, not a release.` })
  console.error(JSON.stringify({out:drive.out,n,mode,wallMs:result.wallMs,peakRssMiB:result.peakRssBytes/1048576,
    issues:result.ledgerIssues?.length,cards:result.cards?.map(c=>[c.name,c.phase,c.exactCount]),error:result.error}))
}
