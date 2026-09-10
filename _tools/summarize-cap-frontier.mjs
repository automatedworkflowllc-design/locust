// Derived measurements from saved evidence, not another run and not a model call.
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../docs/user-session/', import.meta.url))
const names = (await readdir(root)).filter(n => /^2026-09-(09|10)T.*-frontier-(ask|accept-edits)-\d+$/.test(n)).sort()
assert.ok(names.length > 0, 'No frontier evidence; cannot conclude')
function quantile(values, fraction) {
  assert.ok(values.length > 0, 'No latency data')
  return [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))]
}
assert.throws(()=>quantile([],0.95), /No latency data/)
assert.equal(quantile([10,30,20],0.5),20)
// Room IPC announces starts only after the sequential dispatch loop returns.
// Those notifications can arrive AFTER a process completes. Receipt intervals,
// not notification ordering, are the evidence for simultaneous runtimes.
function overlap(intervals) {
  assert.ok(intervals.length > 0, 'No process intervals')
  const edges = intervals.flatMap(([start,end]) => {
    assert.ok(Number.isFinite(start) && Number.isFinite(end) && end > start, 'Invalid process interval')
    return [[start,1],[end,-1]]
  }).sort((a,b)=>a[0]-b[0]||a[1]-b[1])
  let live=0,peak=0
  for(const [,delta] of edges){live+=delta;peak=Math.max(peak,live)}
  return peak
}
assert.throws(()=>overlap([]), /No process intervals/)
assert.throws(()=>overlap([[NaN,1]]), /Invalid process interval/)
assert.equal(overlap([[0,5],[5,10]]),1)
assert.equal(overlap([[0,6],[5,10]]),2)
const rows = []
for (const name of names) {
  const d = JSON.parse(await readFile(join(root,name,'measurement.json'),'utf8'))
  if (d.error) { rows.push({ name,n:d.n,mode:d.mode,error:d.error }); continue }
  const observed = JSON.parse(await readFile(join(root,name,'observed-updates.json'),'utf8'))
  assert.ok(d.samples.length >= 2 && observed.updates.length > 0, 'No process/event data')
  const completions = observed.updates.filter(u => u.update.kind === 'event' && u.update.event.payload?.process)
  const receipts = completions.map(u => u.update.event.payload.process)
  assert.equal(receipts.length,d.missions.length,'Not all accepted processes have a completion receipt')
  const peakLive = overlap(receipts.map(r=>[Date.parse(r.startedAt),Date.parse(r.finishedAt)]))
  const activeSamples = d.samples.filter(s => s.atMs >= d.postedAt && s.atMs <= d.finishedAt)
  assert.ok(activeSamples.length >= 2,'Not enough active process samples')
  let cpuMs=0,elapsedMs=0;const peaks=[]
  for (let i=1;i<d.samples.length;i++) {
    const b=d.samples[i],a=d.samples[i-1]
    if(b.atMs<d.postedAt||b.atMs>d.finishedAt)continue
    const old=new Map(a.processes.map(p=>[`${p.pid}:${p.created}`,p.cpuMs]))
    const used=b.processes.reduce((sum,p)=>sum+Math.max(0,p.cpuMs-(old.get(`${p.pid}:${p.created}`)??0)),0)
    const dt=b.atMs-a.atMs;cpuMs+=used;elapsedMs+=dt;peaks.push(used/dt)
  }
  const lags=d.missions.flatMap(m=>m.eventLagsMs)
  const durations=receipts.map(r=>Date.parse(r.finishedAt)-Date.parse(r.startedAt))
  const events=observed.updates.filter(u=>u.update.kind==='event').map(u=>u.update.event)
  const startVisibilityDelays=observed.updates.filter(u=>u.update.kind==='mission-started').map(u=>{
    const r=completions.find(c=>c.update.runId===u.update.runId)?.update.event.payload.process
    assert.ok(r,'Start notification without process receipt')
    return u.atMs-Date.parse(r.startedAt)
  })
  assert.equal(startVisibilityDelays.length,d.missions.length)
  const transportCoverage = receipts.map((r,i) => {
    const runId = completions[i].update.runId
    const seq = [...new Set(events.filter(e=>e.runId===runId).map(e=>e.payload?.evidence?.transportSequence).filter(Number.isInteger))].sort((a,b)=>a-b)
    return { expected:r.recordCount,observed:seq.length,contiguous:seq.length===r.recordCount&&seq.every((s,j)=>s===j+1) }
  })
  rows.push({ name,n:d.n,started:d.missions.length,refused:d.dispatchRefusal?.count??0,mode:d.mode,workloadRevision:d.workloadRevision??1,wallSeconds:d.wallMs/1000,
    slowestProcessSeconds:Math.max(...durations)/1000,peakLive,
    peakRssMiB:d.peakRssBytes/1048576,baselineRssMiB:d.baselineRssBytes/1048576,
    amortizedIncrementPerRequestedMemberMiB:(d.peakRssBytes-d.baselineRssBytes)/1048576/d.n,
    minFreeGiB:d.minFreeBytes/1024**3,cores:d.samples[0].cores,
    sustainedCores:cpuMs/elapsedMs,peakCores:Math.max(...peaks),
    sampleCount:d.samples.length,sampleErrors:d.sampleErrors.length,
    maxSampleGapMs:Math.max(...d.samples.slice(1).map((s,i)=>s.atMs-d.samples[i].atMs)),
    rendererMaxTickGapMs:d.maxRendererTickGapMs,p95EventLagMs:quantile(lags,0.95),maxEventLagMs:Math.max(...lags),
    maxStartVisibilityDelayMs:Math.max(...startVisibilityDelays),
    ledgerIssues:d.ledgerIssues.length,observedEventMismatches:d.missions.filter(m=>!m.identicalObservedEvents).length,
    eventSequenceGaps:d.missions.filter(m=>!m.sequencesContiguous).length,
    exactReplies:d.cards.filter(c=>c.exactCount).length,exactLedgerTranscripts:d.missions.filter(m=>m.exactCount).length,
    exactWrites:d.writes?.filter(w=>w.exactCount).length??0,writeChecks:d.writes?.length??0,
    providerRecords:receipts.map(r=>r.recordCount),textRecords:events.filter(e=>e.type==='message.delta').length,
    toolEvents:events.filter(e=>e.type.startsWith('tool.')).length,
    toolCalls:receipts.map((r,i)=>events.filter(e=>e.type==='tool.completed'&&e.runId===completions[i].update.runId).length),
    transportCoverage,
    outputLimitFailures:receipts.filter(r=>r.outputLimitExceeded).length,
    oversizedRecordsDropped:receipts.reduce((sum,r)=>sum+r.oversizedRecordsDropped,0),
    nonzeroExits:receipts.filter(r=>r.exitCode!==0).length,
    failedMissions:d.missions.filter(m=>m.phase!=='completed').length,
    hostFailures:d.missions.reduce((sum,m)=>sum+m.hostFailures.length,0)
  })
}
for (const row of rows) {
  const solo=rows.find(r=>r.mode===row.mode&&r.workloadRevision===row.workloadRevision&&r.n===1&&!r.error)
  if(solo&&!row.error)row.slowestVsSolo=row.slowestProcessSeconds/solo.slowestProcessSeconds
}
console.log(JSON.stringify(rows,null,2))
if(process.argv.includes('--save'))await writeFile(new URL('../docs/cap-frontier-measurements-2026-09-09.json',import.meta.url),JSON.stringify(rows,null,2)+'\n')
