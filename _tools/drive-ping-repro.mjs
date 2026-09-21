// Job B Reproduction: Finding 3b, the stale pending line
//
// 1. Free OpenCode route, memory and auto off.
// 2. Send: Reply with exactly PING and nothing else.
// 3. Let it finish completely. Wait ten seconds past the last change.
// 4. Capture the whole thread, and separately the activity fold expanded.
// 5. Copy the mission's ledger records for the run.
// 6. Inspect DOM: Which element draws that line, and what is its state when completed?

import { cp, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FREE_ROUTE, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-ping-ws-')
const drive = await startDrive({
  name: 'ping-repro',
  port: 9341,
  workspace,
  keep: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: { ...FREE_ROUTE, mode: 'accept-edits' }
      }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let missionProfilePath = ''
let sessionOutPath = ''

try {
  await drive.capture('01-launch', () => drive.ready())

  // Select Wren or send message in composer directly
  await drive.capture('02-send-ping-prompt', () => drive.evaluate(`(async () => {
    // Open Wren's hub or click teammate avatar if available
    const avatar = [...document.querySelectorAll('button')].find(b => 
      b.getAttribute('aria-label')?.includes('Wren') || b.getAttribute('title')?.includes('Wren')
    )
    if (avatar) avatar.click()
    await new Promise(r => setTimeout(r, 400))

    const field = document.querySelector('form.command-dock textarea')
    if (!field) return 'no composer textarea found'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(field, 'Reply with exactly PING and nothing else.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 300))

    for (let i = 0; i < 40; i += 1) {
      const startBtn = document.querySelector('button[aria-label="Start mission"]')
      if (startBtn && !startBtn.disabled) {
        startBtn.click()
        return 'started via button'
      }
      await new Promise(r => setTimeout(r, 100))
    }
    field.form?.requestSubmit()
    return 'submitted form'
  })()`))

  // Wait until run completes
  say('waiting for run to finish...')
  await drive.capture('03-run-completes', () => drive.evaluate(`(async () => {
    for (let i = 0; i < 720; i += 1) {
      await new Promise(r => setTimeout(r, 500))
      const stopBtn = document.querySelector('button[aria-label^="Stop the running"]')
      const header = document.querySelector('.lc-workroom__header')?.innerText ?? ''
      if (!stopBtn && /completed|failed|cancelled/i.test(header)) {
        return 'finished in ' + (i * 0.5) + 's: ' + header.replace(/\\s+/g, ' ').trim()
      }
    }
    return 'timed out waiting for completion'
  })()`))

  // Job B Requirement 3: Wait ten seconds past the last change!
  say('waiting 10 seconds past completion...')
  await sleep(10_000)

  // Job B Requirement 4: Capture whole thread, and DOM element inspection
  await drive.capture('04-whole-thread-settled', () => drive.evaluate(`(() => {
    const thread = document.querySelector('.lc-thread')
    if (!thread) return 'no thread found'
    
    // Detailed element analysis of the thread
    const items = [...thread.querySelectorAll('*')].map(el => {
      const cls = el.className || ''
      const text = el.innerText ? el.innerText.trim() : ''
      return {
        tag: el.tagName.toLowerCase(),
        class: typeof cls === 'string' ? cls : '',
        id: el.id || '',
        textSnippet: text.slice(0, 100),
        isPending: /pending/i.test(cls) || /pending/i.test(text),
        isPlan: /plan/i.test(cls),
        isLiveStep: /livestep|live-step/i.test(cls)
      }
    })

    const pendingMatches = items.filter(it => it.isPending)
    const planMatches = items.filter(it => it.isPlan)
    const liveStepMatches = items.filter(it => it.isLiveStep)

    return JSON.stringify({
      threadText: thread.innerText.replace(/\\s+/g, ' ').trim(),
      pendingElements: pendingMatches,
      planElements: planMatches,
      liveStepElements: liveStepMatches
    }, null, 2)
  })()`))

  // Expand activity fold if folded
  await drive.capture('05-activity-fold-expanded', () => drive.evaluate(`(async () => {
    const foldButton = document.querySelector('.lc-activity button, .lc-fold button, [aria-expanded]')
    if (foldButton) {
      const expanded = foldButton.getAttribute('aria-expanded')
      if (expanded !== 'true') {
        foldButton.click()
        await new Promise(r => setTimeout(r, 600))
      }
    }
    const thread = document.querySelector('.lc-thread')
    return thread ? thread.innerText.replace(/\\s+/g, ' ').trim() : 'no thread'
  })()`))

  // Deep DOM dump of every child in thread
  await drive.capture('06-thread-dom-hierarchy', () => drive.evaluate(`(() => {
    const thread = document.querySelector('.lc-thread')
    if (!thread) return 'no thread'

    function dumpNode(node, depth = 0) {
      if (depth > 6) return ''
      let out = '  '.repeat(depth) + '<' + node.tagName.toLowerCase()
      if (node.className) out += ' class="' + node.className + '"'
      if (node.getAttribute('aria-label')) out += ' aria-label="' + node.getAttribute('aria-label') + '"'
      out += '>'
      
      const directText = [...node.childNodes]
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .filter(t => t.length > 0)
        .join(' ')
      if (directText) out += ' ' + JSON.stringify(directText)

      out += '\\n'
      for (const child of node.children) {
        out += dumpNode(child, depth + 1)
      }
      return out
    }

    return dumpNode(thread)
  })()`))

} catch (err) {
  say('ping-repro error: ' + (err instanceof Error ? err.stack : String(err)))
} finally {
  const handoff = await drive.finish({
    intro: 'Job B Reproduction: Free OpenCode route, memory/auto off, "Reply with exactly PING and nothing else". Wait 10s past last change, capture thread and expanded activity fold, copy mission ledger.',
    last: true
  })
  sessionOutPath = handoff.out
  missionProfilePath = handoff.profile
}

// Copy mission ledger files
try {
  const ledgerDir = join(missionProfilePath, 'mission-ledger')
  const destDir = join(sessionOutPath, 'mission-ledger')
  await mkdir(destDir, { recursive: true })
  await cp(ledgerDir, destDir, { recursive: true })
  say('copied mission ledger to: ' + destDir)
} catch (e) {
  say('failed to copy mission ledger: ' + String(e))
}
