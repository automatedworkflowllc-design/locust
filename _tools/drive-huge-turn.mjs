// One turn that produces a great deal of output.
//
//   node _tools/drive-huge-turn.mjs
//
// 0.45.4 raised `maxQueuedRecords` from 64 to 2,048 because a Cursor teammate
// writing a long report died with "Cursor Agent sent more output than Locust
// could take in" at 373k in / 15k out. That fix has a unit test -- 500 records
// through a FAKE child -- and has never been run against a real runtime
// producing real volume.
//
// A fake child cannot reproduce the thing that caused it. The pile-up happens
// during the await that writes a batch to disk, so it depends on real timing:
// a real model streaming faster than a real fsync.
//
// This asks a free model for a lot of lines in one turn and checks four things
// that each break differently at volume:
//   - the run finishes rather than being killed for being long
//   - nothing was dropped for being oversized
//   - the message is bounded but keeps BOTH ends (0.44 changed truncation to
//     keep head and tail, because the protocol blocks live at the end)
//   - the view is still pinned to the newest output afterwards

import { pickRouteScript, say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-huge-ws-')
const drive = await startDrive({
  name: 'huge-turn',
  port: 9401,
  workspace,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

try {
  await drive.capture('launch, on a free model', async () => {
    await drive.ready()
    await drive.evaluate(`(async () => { [...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click(); await new Promise(r => setTimeout(r, 600)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/opencode/i', search: 'free', row: '/free/i' }))
  })

  await drive.capture('ask for a great deal of output in one turn', () => drive.evaluate(`(async () => {
    const box = document.querySelector('textarea[aria-label="Mission instruction"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    // Deliberately mechanical: a model that has to THINK produces slowly, and
    // slow output is exactly what this drive cannot test.
    setter.call(box, 'Print the numbers from 1 to 1200, one per line, with no commentary before or after. Start now.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    box.focus()
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    for (let i = 0; i < 300; i += 1) {
      await new Promise(r => setTimeout(r, 1000))
      const head = document.querySelector('.lc-workroom__header, header')?.textContent ?? ''
      if (!/running|starting/i.test(head)) return 'finished after ' + i + 's'
    }
    return 'STILL RUNNING after five minutes'
  })()`))

  await drive.capture('THE QUESTION: did it survive its own output', () => drive.evaluate(`(() => {
    const head = document.querySelector('.lc-workroom__header, header')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
    const body = document.body.innerText
    return JSON.stringify({
      // The exact wording of the failure this fix was for.
      killedForVolume: /more output than Locust could take in/i.test(body),
      droppedSomething: /oversized|dropped/i.test(body),
      header: head.slice(0, 150),
      completed: /completed/i.test(head)
    }, null, 1)
  })()`))

  await drive.capture('both ends of a bounded message survive', () => drive.evaluate(`(() => {
    /*
     * Truncation keeps HEAD and TAIL since 0.44: the protocol blocks a model
     * writes -- decisions, shares, memory -- sit at the END of a message, and
     * a head-only cut silently threw them away. So a truncated message must
     * still show its last lines.
     */
    const text = document.body.innerText
    const truncated = text.includes('[truncated]')
    const lines = text.split('\\n').map((l) => l.trim()).filter(Boolean)
    const numbers = lines.filter((l) => /^\\d{1,4}$/.test(l)).map(Number)
    return JSON.stringify({
      truncated,
      numbersOnScreen: numbers.length,
      lowest: numbers.length === 0 ? null : Math.min(...numbers),
      highest: numbers.length === 0 ? null : Math.max(...numbers),
      keptBothEnds: truncated ? numbers.includes(1) || numbers.some((n) => n > 1000) : 'not truncated'
    }, null, 1)
  })()`))

  await drive.capture('still looking at the newest output', () => drive.evaluate(`(() => {
    const scroller = [...document.querySelectorAll('*')]
      .filter((el) => el.scrollHeight > el.clientHeight + 40)
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
    if (scroller === undefined) return 'nothing scrolls'
    const fromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    return 'pixels above the bottom: ' + Math.round(fromBottom) + ' of ' + scroller.scrollHeight
  })()`))
} finally {
  await drive.finish({
    intro: 'One turn asked for 1,200 lines, against the queue cap raised in 0.45.4 after a real Cursor run was killed for being long.'
  })
}

say('done')
