// What the compare-layout frames show (2026-10-05): three answers to one
// question, of very different lengths, the way Colin's three-column Blind
// RPG compare read (docs/colin-compare-overflow-2026-10-05.png). Shared by
// _tools/drive-compare-layout-frames.mjs (the app, seeded) and
// _tools/look-compare-layout.mjs (the view alone, running and done).

export const PROMPT = 'Make a small browser RPG in one HTML file: three classes, a boss with a second phase, and a way to tell when he enrages.'

export const COLUMNS = [
  {
    slot: 'a', runtime: 'opencode', model: 'opencode/mimo-v2.6-flash-free', label: 'Mimo V2.6 Flash',
    // Short: done early, so with the shared scroll its column is empty for most of the others' length.
    parts: [
      { say: 'I will build it as one `index.html` with a canvas and a small state machine for the boss.' },
      { tools: [['Bash', 'ls -la'], ['Read', null]] },
      { say: 'Done. `index.html` has the three classes (Knight, Ranger, Mage), the Bone King with a second phase at half health, and a red screen tint when he enrages. Open it in a browser to play.' }
    ]
  },
  {
    slot: 'b', runtime: 'opencode', model: 'opencode/ling-3.0-flash-fin-free', label: 'Ling 3.0 Flash',
    // Long: it keeps checking its own work.
    parts: [
      { say: 'Plan:\n\n1. One `index.html`, canvas rendering, no build step.\n2. Classes: **Knight** (block), **Ranger** (kite), **Mage** (burst).\n3. The Bone King: phase 1 telegraphs, phase 2 at 50% with faster swings.\n4. An enrage aura you can read at a glance.' },
      { tools: [['Bash', 'mkdir -p game && cd game && git init'], ['Read', null], ['Read', null]] },
      { say: 'The skeleton is in. Each class is a table of numbers so balance changes stay in one place:\n\n```js\nconst CLASSES = {\n  knight: { hp: 140, speed: 2.2, block: 0.5 },\n  ranger: { hp: 90, speed: 3.4, range: 220 },\n  mage:   { hp: 70, speed: 2.6, burst: 48 }\n}\n```' },
      { tools: [['Bash', 'node scripts/playthrough.mjs --class knight --layout arena --seconds 120'], ['Bash', 'node scripts/playthrough.mjs --class ranger --layout pillars --seconds 120']] },
      { say: 'Both playthroughs finish. The Ranger clears the arena in about 4 minutes, close to the "roughly five minutes" target.' },
      { tools: [['Bash', 'node scripts/playthrough.mjs --class mage --layout pillars --seconds 120'], ['Read', null]] },
      { say: 'The phase-2 transition plays (crit → king swells → "THE KING ENRAGES" → harder hits), but his enrage aura renders as a pale white outline. A pulsing violet glow will read much better:' },
      { tools: [['Bash', 'node scripts/screenshot.mjs --frame enrage --out shots/enrage.png'], ['Read', null]] },
      { say: 'The violet enrage glow looks properly ominous now. Let me run final full playthroughs for each class across different layouts to confirm nothing regressed:' },
      { tools: [['Bash', 'for c in knight ranger mage; do for l in arena pillars maze; do node scripts/playthrough.mjs --class $c --layout $l --seconds 90; done; done']] },
      { say: 'All nine playthroughs pass. Summary:\n\n- **Classes:** Knight, Ranger, Mage, each a row of numbers in `CLASSES`.\n- **Boss:** the Bone King, phase 2 at half health, faster swings, a violet pulsing aura.\n- **Layouts:** arena, pillars, maze.\n- **Check:** `scripts/playthrough.mjs` plays each class through each layout headless.' }
    ]
  },
  {
    slot: 'c', runtime: 'opencode', model: 'opencode/muse-spark-1.3-contributor-free', label: 'Muse Spark 1.3',
    parts: [
      { say: 'Building it in one file. I will keep the boss logic separate from drawing so the second phase is easy to tune.' },
      { tools: [['Bash', 'ls'], ['Read', null]] },
      { say: 'Written `rpg.html` (about 1,270 lines). The boss, **Grimfang**, shifts to phase 2 at 40% health: the arena darkens, his outline turns red, and a banner reads "ENRAGED". Each class has one active ability on Space.' },
      { tools: [['Bash', 'npx --yes serve -l 4173 . & sleep 2 && curl -s localhost:4173/rpg.html | head -5']] },
      { say: 'It serves and loads. One known gap: the Mage has no cooldown indicator yet.' }
    ]
  }
]

/**
 * The column's events, as a runtime reports them: words, then tool calls,
 * oldest first. `running` leaves the newest tool call open and ends with no
 * run.completed, so the live line is on it.
 */
export function columnEvents(column, { missionId, runId, startedAt, running = false, minutes = 77 }) {
  let sequence = 0
  const start = Date.parse(startedAt)
  const total = column.parts.length
  const event = (type, payload, index) => {
    sequence += 1
    const occurredAt = new Date(start + Math.round(((index + 1) / (total + 1)) * minutes * 60_000)).toISOString()
    return { id: `event_${runId}_${String(sequence)}`, runId, missionId, sequence, occurredAt, sourceAdapter: 'opencode', type, payload: { ...payload, evidence: { redacted: true } } }
  }
  const events = [event('run.started', { runtimeThreadId: `session-${runId}` }, -1)]
  column.parts.forEach((part, index) => {
    const last = index === total - 1
    if (part.say !== undefined) {
      if (running && last) return
      events.push(event('message.delta', { itemId: `m${String(index)}`, operation: 'append', text: part.say, final: true }, index))
      return
    }
    part.tools.forEach(([name, command], at) => {
      const itemId = `tool_${String(index)}_${String(at)}`
      const shape = { itemId, toolKind: 'tool_use', name, ...(command === null ? {} : { command }) }
      events.push(event('tool.started', { ...shape, phase: 'started' }, index))
      const open = running && index >= total - 2 && at === part.tools.length - 1
      if (!open) events.push(event('tool.completed', { ...shape, exitCode: 0, status: 'completed', phase: 'completed' }, index))
    })
  })
  if (!running) {
    const finishedAt = new Date(start + minutes * 60_000).toISOString()
    events.push(event('run.completed', {
      usage: { inputTokens: 184_000, outputTokens: 21_400 },
      process: { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: events.length, inputDeliveryFailed: false, outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, startedAt, finishedAt }
    }, total))
  }
  return events
}
