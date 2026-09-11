// Does a memory stay where it happened, or slide to the foot of the thread?
//
//   LOCUST_SPEND=1 node _tools/probe-memory-sits-in-place.mjs
//
// Colin, 2026-09-11: "the remembered tab should stay at where the memory
// happened, not permanently at the bottom."
//
// The gathering was already right -- a memory stops vanishing when you reply,
// fixed earlier by matching the whole conversation rather than the shown turn
// -- but the turn was dropped on the way out and the thread drew ONE card
// after everything. A memory learned on turn one appeared under turn five,
// reading as something the last reply had just done.
//
// The assertion is about DOCUMENT ORDER, which is the only thing "where it
// happened" can mean on a thread: the card must come before the second turn's
// prompt bubble, not after it.
//
// SPENDS two turns on OpenCode's free model, which needs no account.

import { say, scratchRepository, startDrive, FREE_ROUTE } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('refusing to run: this spends two turns. Set LOCUST_SPEND=1 to allow it.')
  process.exit(1)
}

const workspace = await scratchRepository('locust-memplace-ws-')
const drive = await startDrive({
  name: 'memory-sits-in-place',
  port: 9491,
  workspace,
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      {
        teammateId: 'tm_wren',
        name: 'Wren',
        hue: 'lime',
        role: 'Code & Migrations',
        createdAt: '2026-09-05T05:00:00.000Z',
        route: { ...FREE_ROUTE, mode: 'ask' }
      }
    ],
    missionOwners: {},
    // "Keep and tell me": a teammate may write a memory and it is kept.
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'auto', autoMode: false }
  }
})

// No backticks inside these template literals.
const send = (text) => `(async () => {
  const field = document.querySelector('form.command-dock textarea')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
  setter.call(field, ${JSON.stringify(text)})
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 200))
  field.form.requestSubmit()
  for (let i = 0; i < 300; i += 1) {
    await new Promise(r => setTimeout(r, 500))
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) break
  }
  await new Promise(r => setTimeout(r, 1200))
  return true
})()`

/**
 * Where the card sits, in the only terms that matter: is it before or after
 * the second turn's prompt? Read with compareDocumentPosition rather than by
 * counting pixels, because the thread scrolls and a y-coordinate would be
 * about the viewport instead of the order.
 */
const placement = `(() => {
  const cards = [...document.querySelectorAll('.lc-memorycard, [class*=memorycard], .lc-memory')]
  const bubbles = [...document.querySelectorAll('.lc-bubble')]
  if (cards.length === 0) return JSON.stringify({ cards: 0, why: 'no memory card in the thread' })
  if (bubbles.length < 2) return JSON.stringify({ cards: cards.length, bubbles: bubbles.length, why: 'fewer than two turns on screen' })
  const card = cards[0]
  const secondPrompt = bubbles[1]
  const beforeSecondTurn = (card.compareDocumentPosition(secondPrompt) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  return JSON.stringify({
    cards: cards.length,
    bubbles: bubbles.length,
    cardText: card.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80),
    secondPromptText: secondPrompt.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60),
    beforeSecondTurn
  }, null, 1)
})()`

try {
  await drive.capture('turn one: ask it to remember something', async () => {
    await drive.ready()
    await drive.evaluate(`[...document.querySelectorAll('button')].find(b => b.getAttribute('title')?.startsWith('Message Wren'))?.click()`)
    await drive.evaluate(`new Promise(r => setTimeout(r, 700))`)
    await drive.evaluate(send('Remember for this project: the build command is "pnpm build". Write it as a memory, then reply with just: ok'))
    return drive.evaluate(`JSON.stringify({ thread: (document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-160) })`)
  })

  // The premise, OUTSIDE capture(): a memory has to exist, or placement is
  // not what is being measured.
  const wrote = await drive.evaluate(`document.querySelectorAll('.lc-memorycard, [class*=memorycard], .lc-memory').length > 0`)
  if (wrote !== true) throw new Error('NOT THE TEST: the model wrote no memory, so there is nothing to place')

  await drive.capture('turn two: the card stays with turn one', async () => {
    await drive.evaluate(send('Now reply with just: second'))
    return drive.evaluate(placement)
  })
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({
    intro: 'Build: whatever `pnpm build` last wrote to out/. One teammate on OpenCode free, memory mode "Keep and tell me". Two turns: the first writes a memory, the second is ordinary. The card must sit before the second turn prompt in document order.'
  })
}
