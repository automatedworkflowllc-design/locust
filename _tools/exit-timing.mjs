// How long does a smoke live after its last word?
//
//   node _tools/exit-timing.mjs _smoke/row-menu-smoke.mjs
//
// The 0.21.2 QA pass found six smokes "alive more than seven seconds after
// their final passing message" and had to kill their process trees. Their
// functional assertions were fine; the process just did not end. This
// measures that directly: the gap between the last line a smoke prints and
// the moment its process exits. A clean smoke is under two seconds -- the
// time it takes the app it launched to die.

import { spawn } from 'node:child_process'

const target = process.argv[2]
if (target === undefined) {
  console.error('usage: node _tools/exit-timing.mjs <smoke.mjs>')
  process.exit(2)
}

const started = Date.now()
let lastLineAt = started
let lastLine = ''
const child = spawn(process.execPath, [target], { stdio: ['ignore', 'pipe', 'pipe'] })
const note = (chunk) => {
  const text = String(chunk)
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length > 0) {
    lastLineAt = Date.now()
    lastLine = lines.at(-1)
  }
  process.stderr.write(text)
}
child.stdout.on('data', note)
child.stderr.on('data', note)
child.on('exit', (code) => {
  const tail = (Date.now() - lastLineAt) / 1000
  const total = (Date.now() - started) / 1000
  console.error(`\nEXIT TIMING: exit code ${String(code)} · ${tail.toFixed(1)}s after the last line ("${lastLine.slice(0, 60)}") · ${total.toFixed(0)}s total`)
  process.exit(tail > 3 ? 1 : 0)
})
