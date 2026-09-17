import type { WorkroomMessage } from '@teammate/mission-store'
import type { MissionRuntimeId, MissionSandbox } from '@teammate/runtime-adapters'

import type { CodexMissionStartResponse, CodexMissionUpdate, MissionMode } from '../shared/ipc.js'
import type { MissionPeerContext, PeerRosterEntry } from './workroom-briefing.js'
import { runtimeDisplayName } from '../shared/runtimes.js'

/**
 * Teammates replying to each other without a person in the loop.
 *
 * Before this, a message from Wren to Booty waited in the workroom until
 * someone next messaged Booty, and Booty's answer waited until someone next
 * messaged Wren. Delivered, attributed, and not a conversation. The relay
 * closes that loop: when a run posts a share, the host may start a run for
 * the recipient with that share as its brief, and when THAT run posts back,
 * start the original sender's next turn so the answer lands in the thread
 * that asked.
 *
 * Three limits, each load-bearing:
 *
 *   - A switch in Settings, on by default. Talking to each other is the
 *     point of having more than one teammate; the cap is what bounds it.
 *   - The exchange ends when a reply carries no message: each hop is asked
 *     to write back only if that helps finish the work, and a run that
 *     posts no share starts nothing. The hop cap is a backstop for two
 *     agents thanking each other until the account is empty, not the
 *     length of a conversation.
 *   - A sender may ask to be taken NOW -- `when="now"` on the share block --
 *     and with the person's switch on, that stops the recipient's run so the
 *     message is their next one. Off by default and off is the ordinary
 *     state: it discards work in flight. The case it exists for is the one
 *     message that is useless late -- "stop, I am editing that file".
 *   - A recipient who is mid-run cannot take a second mission, so their
 *     reply is HELD and started the moment that run ends. Without this an
 *     exchange dies at its first collision: two teammates asked to argue
 *     answer at the same time, each writes to the other while the other is
 *     still working, and both messages sit undelivered forever. MEASURED
 *     2026-09-11 -- two participants, hop zero, nothing said back.
 *   - The recipient's run uses the RECIPIENT's own runtime, model and mode,
 *     the route a person last started them on. Grok answers as Grok, Fable
 *     as Fable; a teammate who has never run yet borrows the sender's route,
 *     and the thread says so. A route that cannot start is refused, not
 *     widened -- with one exception, said in the thread: Cursor lent `ask`
 *     on a machine that cannot hold it read-only runs as Accept edits,
 *     because `ask` there is a start the mission service refuses outright.
 *
 * Nothing about the record changes. A relayed run is an ordinary mission,
 * owned by the recipient, whose prompt is the host's brief; the messages it
 * was shown are recorded by id exactly as they are for a person's mission.
 */

/**
 * Automatic runs per exchange before the host stops and waits for a person.
 *
 * A backstop, not a target, and it had stopped being one: six was firing as
 * the ordinary way an exchange ended (MEASURED 2026-09-11, five runs of a
 * one-word question: 6, 6, 3, 6, 7). A limit that fires in the normal case is
 * a timer, and a teammate cut off mid-thought is the worse failure. The fix
 * was to make exchanges END -- the brief now names what a reply costs -- and
 * then to raise this out of the way. See `DEFAULT_RELAY_HOP_CAP`.
 *
 * The default only. The person's own number is read from Settings whenever a
 * share is decided; this is what the relay uses when nobody has said.
 */
export const MAX_RELAY_HOPS = 12

export interface RelayOrigin {
  /** How many automatic runs preceded this one in the exchange. 0 for a person's mission. */
  readonly hop: number
  /**
   * The person-started mission this whole exchange grew from.
   *
   * The budget is counted against THIS, because `hop` counts the depth of one
   * chain and an exchange is not one chain. MEASURED 2026-09-11: seven
   * automatic runs against a cap of six. A reply held for a busy teammate
   * (0.69.0) carries the hop decided when the message was posted, so by the
   * time it starts the exchange may have gone deeper elsewhere -- every
   * decision inside the cap, the total outside it.
   *
   * Absent on a record written before this existed; the sharing mission is
   * then the root, which is right for the exchange it is about to start and
   * merely generous for one already running.
   */
  readonly rootMissionId?: string
  /**
   * Each participant's latest mission in this exchange, so their next hop
   * continues THEIR conversation rather than starting a stranger. The
   * person-started mission is the first entry.
   */
  readonly lastMissionOf: Readonly<Record<string, string>>
}

export type RelayDecision =
  | { readonly start: true; readonly hop: number }
  | { readonly start: false; readonly reason: string }

/**
 * Whether a posted message earns an automatic run for its recipient. Pure,
 * so the cap and the default can be proven without a runtime.
 */
export function decideRelay(input: {
  readonly enabled: boolean
  /**
   * The sender said `when="later"`: tell them, do not page them.
   *
   * Checked before the budget, because a message that was never going to
   * start a run should not spend an exchange's allowance on deciding not to.
   */
  readonly defer?: boolean
  readonly hop: number
  readonly recipientName: string
  /** The person's own budget for one exchange; the constant is only the default. */
  readonly cap?: number
  /**
   * Automatic runs this exchange has ALREADY started, across every chain.
   *
   * The budget is spent per exchange, not per chain. Absent reads as `hop`,
   * which is what this did before it could count -- and is exactly the
   * reading that let seven runs through a cap of six.
   */
  readonly spent?: number
}): RelayDecision {
  const cap = input.cap ?? MAX_RELAY_HOPS
  if (input.defer === true) {
    return {
      start: false,
      reason: `Sent to ${input.recipientName} to read on their next run, rather than starting one.`
    }
  }
  if (!input.enabled) {
    return { start: false, reason: 'Teammate replies are switched off in Settings; the message waits for their next run.' }
  }
  const spent = input.spent ?? input.hop
  if (spent >= cap) {
    return {
      start: false,
      reason: `Stopped after ${String(cap)} automatic ${cap === 1 ? 'reply' : 'replies'}. ${input.recipientName} will see this on their next run.`
    }
  }
  return { start: true, hop: input.hop + 1 }
}

/**
 * The brief a relayed run is started with. It is recorded as that mission's
 * prompt, so it says plainly who asked and what is expected; the message
 * itself is quoted by the ordinary inbound section, marked as a claim like
 * every other teammate message.
 */
export function relayPrompt(input: {
  readonly sender: PeerRosterEntry
  readonly recipient: PeerRosterEntry
  readonly hop: number
  /** The exchange's budget, so the brief can say where in it this reply is. */
  readonly cap?: number
  /**
   * This reply lands in the conversation the PERSON started, which they are
   * reading. Everything the brief says about nobody watching is false there.
   *
   * MEASURED 2026-09-16 in Colin's own ledger. He asked Jimothy: "can you
   * ask wembley to research aadx, assemble a report and get back to you".
   * Wembley ran seven minutes, wrote the brief, shared it back. Jimothy,
   * told "none of that reaches a person" and "nobody is watching this run",
   * ended with a memory block and not one word to Colin. The exchange
   * finished exactly as the brief asked, and the person it was for got
   * nothing.
   */
  readonly readByPerson?: boolean
}): string {
  const who = `${input.sender.name} (${input.sender.role})`
  const opening = input.hop <= 1
    ? `${who} sent you a message; it is quoted below with anything else waiting for you.`
    : `${who} replied to you; it is quoted below.`
  const readByPerson = input.readByPerson === true && input.hop > 1
  return [
    opening,
    // Said only to a REPLY, where the whole failure lives.
    //
    // MEASURED 2026-09-11, `relay-smoke`, five runs: Wren asks Booty for one
    // word, Booty says it -- and then the pair acknowledge each other for 6,
    // 6, 3, 6 and 7 hops. Four of five ran to the budget on a question with a
    // one-word answer. An exchange is SUPPOSED to end when a reply has
    // nothing more to say; in practice it almost never did.
    //
    // The brief said "write back only if that helps finish the work", which a
    // polite model reads as permission rather than as a cost. What it never
    // said is what a reply actually COSTS: a whole mission, on a real model,
    // billed -- and read by nobody, because the thing at the other end is
    // another model that will feel the same pull to answer. Naming the cost
    // is the honest version of the instruction, and it is a fact rather than
    // a plea.
    ...(input.hop <= 1
      ? []
      : readByPerson
        ? [
            `${input.sender.name} is a MODEL, not a person, and every reply you send THEM starts another whole mission that costs money.`,
            `But the person who started this conversation reads it, and this is what they were waiting for: say in a line or two what ${input.sender.name}'s reply means for what they asked -- the answer, where it is, what is still open -- written to them, not about what you are going to write -- and then stop.`,
            `Write back to ${input.sender.name} only when the work needs it; thanks and receipts reach nobody.`
          ]
        : [
            `${input.sender.name} is a MODEL, not a person, and every reply you send starts another whole mission that costs money.`,
            // Said as what a reply IS worth, then the one case that ends it.
            //
            // This was a list: "Do not thank them, do not confirm receipt, do
            // not summarise what you both agreed". Every item was earned by a
            // measured failure and they worked -- exchanges stopped running to
            // the cap. But a brief that is mostly "do not" produces a model
            // writing to avoid mistakes rather than to be understood, which is
            // the "dumbed down" Colin hears (2026-09-17). Grok Build's rule for
            // the same reply: "Open with what is true or what to do. Do not
            // open answers or sections with negations." Same facts, opposite
            // register; the cure -- the exchange ends, and ending is normal --
            // is kept, and now named as the good outcome it is.
            'A reply is worth that only when it moves the work: an answer with its evidence, a decision, or a question they need answered before they can continue. If their message settles things or needs nothing from you, END HERE with no share block -- that is an exchange finishing, and it is the most common good outcome. Thanks, receipts and recaps reach nobody and cost a run each.'
          ]),
    'Do what it asks if that is within your role and this workspace, using what you actually know, and say plainly what is blocked or unverified rather than implying it is done; if you cannot help, say so and why.',
    `When a reply is needed, end with one <locust-share to="${input.sender.name}"> block holding it, written for a capable colleague who has not seen your turn: lead with the answer, said as what is true rather than as a negation, then the evidence by name (paths, numbers, names), then what you need from them, if anything, in complete sentences.`,
    // The one case where waiting is worse than interrupting, said as a rule
    // rather than as a feature -- a model told it has an urgent channel will
    // find reasons to use it.
    'Add when="now" to a share ONLY if waiting for them to finish would make it useless or cause a conflict, such as telling them to stop touching a file you are changing; an ordinary answer never needs it.',
    // MEASURED 2026-09-05, three runs of relay-smoke: the recipient sometimes
    // declined the request as a possible prompt injection and asked for
    // context -- good judgement -- but asked it with a <locust-ask> block,
    // which reaches a PERSON, and a relayed run has none. The question sat in
    // a thread nobody was watching, no share went back, and the exchange
    // ended in silence. The right recipient of that question is the
    // teammate who asked, and the share block is how to reach them.
    readByPerson
      ? `If you need the person's decision, a <locust-ask> block reaches them here; anything for ${input.sender.name} goes in the share block.`
      : noPersonHere(input.sender.name),
    'If nothing more is needed, end with no share block -- that is how an exchange finishes.',
    budgetSentence(input.hop, input.cap),
    'Stay on what was asked.'
  ].join(' ')
}

/**
 * Where this reply sits in the budget, said to the teammate spending it.
 *
 * MEASURED 2026-09-11, `relay-smoke`: Wren asks Booty for one word, Booty
 * says it -- and the pair then acknowledged each other until the cap fired.
 * Six relayed runs for a question with a one-word answer. The brief already
 * says "if nothing more is needed, end with no share block", and every hop
 * got that same sentence whether it was the first or the fifth.
 *
 * The host knows how much budget is left and the teammate does not. That is
 * the same shape as everything else fixed today: the app holding a fact the
 * reader needed. It is not a cure for politeness, but a model told it is on
 * the last automatic reply has a reason to stop that "if nothing more is
 * needed" does not give it.
 *
 * The last hop says the thing that is actually true and actually load-
 * bearing: a share written HERE starts nothing. `decideRelay` refuses at the
 * cap, so a teammate that writes one has written to a person who may not
 * look for hours -- and it has no way to know that unless it is told.
 */
export function budgetSentence(hop: number, cap: number | undefined): string {
  const budget = cap ?? MAX_RELAY_HOPS
  const left = budget - hop
  if (left <= 0) {
    return (
      'This is the LAST automatic reply in this exchange: anything you send back now waits for a person '
      + 'rather than reaching them, so finish what you can say here.'
    )
  }
  if (left === 1) {
    return (
      `This is automatic reply ${String(hop)} of ${String(budget)}. One more would be the last, so do not write back `
      + 'unless it genuinely needs saying.'
    )
  }
  return `This is automatic reply ${String(hop)} of ${String(budget)}.`
}

/**
 * Said in every relayed briefing. A runtime that reaches a fork on a normal
 * mission is told to stop and ask the person; on a relayed run that
 * instruction is still in its prompt, and following it strands the exchange.
 */
function noPersonHere(sender: string): string {
  // "nobody is watching this run" was true and licensed machine register: a
  // writer told nobody is reading writes like nobody is reading. The fact
  // that matters is where the question came from and where an ask would go.
  return (
    `The person is not in this exchange: ${sender} is a teammate, and the question came from them. `
    + `If you need a decision or more context before you can help, ask ${sender} inside that share block. `
    + 'A <locust-ask> block reaches only a person, so here it would strand the exchange.'
  )
}

/** What a mission that just shared looks like to the relay. */
export interface SharingMission {
  readonly runId: string
  readonly missionId: string
  readonly runtime: MissionRuntimeId
  readonly sandbox: MissionSandbox
  readonly model: string | undefined
  readonly peer: MissionPeerContext
  readonly relay: RelayOrigin | undefined
}

export interface RelayOptions {
  readonly enabled: () => Promise<boolean>
  /** The autonomy budget for one exchange, read when a share is decided. Absent means the default. */
  readonly hopCap?: () => Promise<number>
  readonly peerContextFor: (teammateId: string) => Promise<MissionPeerContext | undefined>
  /**
   * Whether Cursor Agent can be held read-only on this machine. Absent
   * reads as yes. On Windows it cannot (its sandbox needs macOS or Linux),
   * and a relayed start in `ask` there is refused by the mission service --
   * measured 2026-09-17: "Booty could not reply on their own: Cursor Agent
   * cannot be held read-only on this system." A reply that can only run as
   * Accept edits runs as Accept edits, and the thread says so.
   */
  readonly cursorHoldsReadOnly?: () => boolean
  readonly start: (input: {
    readonly prompt: string
    readonly runtime: MissionRuntimeId
    readonly mode: MissionMode
    readonly model: string | undefined
    readonly peer: MissionPeerContext
    readonly followUpOf: string | undefined
    readonly relay: RelayOrigin
  }) => Promise<CodexMissionStartResponse>
  readonly assignOwner: (teammateId: string, missionId: string) => Promise<void>
  /**
   * Whether anything is still waiting to be shown to this teammate.
   *
   * A held reply is not the only way a message gets delivered: anything a
   * teammate has not read is folded into the brief of whatever run starts
   * next, whoever started it. So if a person messaged them while the reply
   * was held, the message has already arrived and starting a second run
   * would brief them on an empty inbox. Absent means start anyway.
   */
  readonly stillWaiting?: (teammateId: string) => Promise<boolean>
  /** Whether one teammate may stop another's run to be heard now. Read per message. */
  readonly mayInterrupt?: () => Promise<boolean>
  /**
   * Stop whatever this teammate is running, and say whether anything stopped.
   *
   * Deliberately nothing more: the reply itself is started by the ordinary
   * held-message path when the run ends, so an interruption is only ever
   * "make the wait short", never a second way to start a mission.
   */
  readonly stopWorkOf?: (teammateId: string) => Promise<boolean>
  /** Reaches the window, addressed to the SENDER's run, so notices land in the thread that shared. */
  readonly notify: (update: CodexMissionUpdate) => void
  /**
   * Write a notice into a mission's own record, so it survives being looked
   * away from.
   *
   * A relay notice was a LIVE UPDATE ONLY. "Stopped after 12 automatic
   * replies" reached the window and nowhere else, so a person watching a
   * different conversation when an exchange ended never learned it had, and
   * reopening the thread later showed nothing at all -- the exchange simply
   * appeared to stop for no reason (MEASURED 2026-09-11, `relay-smoke`:
   * no thread carried the sentence).
   *
   * Only ENDINGS are written. "Still waiting on Booty" is true for a moment
   * and false after it; a record of it would be a record of something that
   * is no longer so.
   */
  readonly note?: (input: {
    readonly missionId: string
    readonly message: string
  }) => Promise<void>
}

/** A run the relay may care about ending: who it belonged to and what exchange it was in. */
export interface EndedMission {
  readonly missionId: string
  readonly peer: MissionPeerContext | undefined
  readonly relay: RelayOrigin | undefined
}

/** A message as the relay receives it: the record, plus what its sender asked for. */
export type RelayedMessage = WorkroomMessage & { readonly urgent?: boolean; readonly defer?: boolean }

export interface Relay {
  onShared(mission: SharingMission, posted: readonly RelayedMessage[]): Promise<void>
  /** Any run ending, however it ended. A meeting counts a recipient who left without answering. */
  onRunEnded(mission: EndedMission): Promise<void>
}

/**
 * A meeting: one teammate wrote to several at once, and their next turn
 * waits until every one of them has answered or given up, then starts ONCE
 * with all the replies quoted -- the minutes -- instead of once per reply,
 * which a teammate who runs one mission at a time could not take anyway.
 */
/** An ordinary one-to-one exchange, from the asker's side. */
interface OpenExchange {
  readonly askerRunId: string
  readonly askerMissionId: string
  readonly askerId: string
  readonly recipientName: string
}

/** A reply that could not start because its recipient was already running. */
interface DeferredReply {
  readonly recipient: MissionPeerContext
  readonly prompt: string
  readonly from: SharingMission
  readonly origin: RelayOrigin
  /** Addressed to the thread that shared, so the wait is visible where it was caused. */
  readonly notice: (message: string) => void
  /** Registered once the held run actually starts, so the asker still hears silence. */
  readonly exchange: OpenExchange | undefined
}

interface Meeting {
  readonly askerId: string
  readonly askerName: string
  readonly askerRunId: string
  readonly askerMissionId: string
  /** The exchange the reply-back hop belongs to. */
  readonly origin: RelayOrigin
  readonly awaiting: Map<string, string>
  readonly answered: string[]
  /** Those who finished without a word to the asker; named in the minutes. */
  readonly silent: string[]
}

/**
 * The brief for the turn after a meeting. Every reply is quoted by the
 * ordinary inbound section; this only says what the person's teammate is
 * looking at.
 */
export function meetingPrompt(input: { readonly repliers: readonly string[]; readonly silent: readonly string[] }): string {
  const who = input.repliers.length === 1 ? input.repliers[0] : `${input.repliers.slice(0, -1).join(', ')} and ${input.repliers[input.repliers.length - 1]}`
  return [
    `${who} replied to your message; the replies are quoted below.`,
    ...(input.silent.length === 0 ? [] : [`${input.silent.join(', ')} finished without replying.`]),
    'Take them together. Write back to anyone only if that helps finish the work: one <locust-share to="Name"> block per teammate.',
    'There is no person in this exchange to answer you; a question for any of them goes in their share block, never in a <locust-ask> block, which reaches only a person.',
    'If nothing more is needed, end with no share block -- that is how an exchange finishes.',
    'Do not start unrelated work.'
  ].join(' ')
}

export function createRelay(options: RelayOptions): Relay {
  /** Open meetings by the asker's mission id. */
  const meetings = new Map<string, Meeting>()
  /**
   * One-to-one exchanges the host started and is still waiting on, keyed by
   * the RECIPIENT's mission. A meeting keeps minutes and says who stayed
   * silent; an ordinary exchange kept nothing, so when a recipient answered
   * in prose instead of a reply block the asker's thread simply showed
   * nothing at all -- Colin, 2026-09-05: "wren answered it but only in his
   * own chat, we never got the reply in booty's chat".
   */
  const exchanges = new Map<string, OpenExchange>()
  /** Which meeting a relayed run is answering, by that run's mission id. */
  const answering = new Map<string, Meeting>()
  /**
   * Automatic runs started per exchange, keyed by the mission a person began.
   *
   * `hop` counts the depth of ONE chain, and an exchange is not one chain --
   * a reply held for a busy teammate starts later, on its own branch, with
   * the hop it was given when the message was posted. Seven runs got through
   * a cap of six that way (MEASURED 2026-09-11). This counts what is actually
   * being spent.
   *
   * Bounded, because nothing tells the relay an exchange is over: the oldest
   * entries are dropped past a few hundred, which cannot under-count a LIVE
   * exchange -- a live one is, by definition, the most recently touched.
   */
  const spentByExchange = new Map<string, number>()
  const EXCHANGES_REMEMBERED = 400
  /**
   * What an exchange has spent, never less than the chain already proves.
   *
   * The counter is the real total when it knows -- but it cannot know about
   * an exchange that began before this code, or one whose count was lost to a
   * restart or an eviction. `hop` survives all three, because it is written
   * into the mission record, and the depth of one chain is a FLOOR on the
   * number of runs the exchange has had. Taking the larger is right in every
   * case and cannot let the budget through, which is the failure that
   * mattered.
   */
  const spendOf = (root: string | undefined, hop: number): number =>
    Math.max(hop, root === undefined ? 0 : spentByExchange.get(root) ?? 0)
  const recordSpend = (root: string): void => {
    // Read BEFORE deleting. The delete-then-set is only to move the key to
    // the end of the insertion order so the eviction below drops the least
    // recently touched exchange; reading after it would reset the count to
    // one every time and the cap would never fire at all.
    const next = (spentByExchange.get(root) ?? 0) + 1
    spentByExchange.delete(root)
    spentByExchange.set(root, next)
    while (spentByExchange.size > EXCHANGES_REMEMBERED) {
      const oldest = spentByExchange.keys().next().value
      if (oldest === undefined) break
      spentByExchange.delete(oldest)
    }
  }
  /**
   * Replies whose recipient was mid-run, by that recipient's teammate id.
   *
   * One entry per teammate, not one per message: everything waiting for them
   * is folded into one brief, so a second held reply would start a second
   * run that had already been told everything.
   */
  const deferred = new Map<string, DeferredReply>()

  const notify = (runId: string, missionId: string, message: string): void => {
    options.notify({ kind: 'relay-notice', runId, missionId, message })
  }

  /**
   * Say it, and keep it.
   *
   * For the notices a person needs AFTER the moment: why an exchange stopped,
   * and that a teammate finished without writing back. Both are facts about
   * how the work ended, and both used to exist only for as long as the window
   * was pointed at the right thread.
   */
  const notifyAndKeep = (runId: string, missionId: string, message: string): void => {
    notify(runId, missionId, message)
    void options.note?.({ missionId, message }).catch(() => undefined)
  }

  /**
   * What came of asking for a run.
   *
   * `busy` is split out from every other refusal because it is the only one
   * that resolves itself: the recipient is working, and will not be shortly.
   * Collapsing it into "could not start" is what ended exchanges at hop zero.
   */
  type StartOutcome =
    | { readonly kind: 'started'; readonly missionId: string }
    | { readonly kind: 'busy' }
    | { readonly kind: 'refused' }

  const startFor = async (input: {
    readonly recipient: MissionPeerContext
    readonly prompt: string
    readonly from: SharingMission
    readonly origin: RelayOrigin
    readonly notice: (message: string) => void
  }): Promise<StartOutcome> => {
    const { recipient, from } = input
    const followUpOf = input.origin.lastMissionOf[recipient.self.teammateId]
    // Their own route, so each teammate stays the model a person made
    // them. Only a teammate who has never run borrows the sender's.
    const own = recipient.self.route
    // A borrowed route never borrows the sender's PERMISSION beyond editing
    // the workspace: a sender on Auto lends `ask`, not the run of the whole
    // machine. Conservative on purpose -- the recipient never chose Auto --
    // and the notice below now says which mode was lent, because a person
    // whose sender could edit anything and whose reply could not write at
    // all had no way to find out why (QA, 2026-09-06).
    const lent = own ?? {
      runtime: from.runtime,
      model: from.model ?? 'account-default',
      mode: from.sandbox === 'workspace-write' ? ('accept-edits' as const) : ('ask' as const)
    }
    // Cursor on a machine that cannot hold it read-only: the mission service
    // refuses `ask` and `plan` outright, so a reply lent either would never
    // run. Accept edits is the least it can be started as, said below.
    const cursorWidened =
      lent.runtime === 'cursor'
      && (lent.mode === 'ask' || lent.mode === 'plan')
      && options.cursorHoldsReadOnly?.() === false
    const route = cursorWidened ? { ...lent, mode: 'accept-edits' as const } : lent
    if (cursorWidened) {
      input.notice(
        `${recipient.self.name} replies in Accept edits rather than read-only: Cursor Agent cannot be held read-only on this system.`
      )
    }
    if (own === undefined) {
      input.notice(
        `${recipient.self.name} has not run on a route of their own yet, so this reply runs on ${from.peer.self.name}'s ${runtimeDisplayName(route.runtime)} / ${route.model}, ${
          route.mode === 'accept-edits' ? 'and may edit this folder' : 'read-only'
        }. Message ${recipient.self.name} once on the route they should keep.`
      )
    }
    /*
     * Say it is coming before it exists.
     *
     * A cold runtime takes seconds to boot, and `mission-started` waits for a
     * run id -- so for those seconds the window knew nothing and the room the
     * argument was happening in read as finished. The pair is emitted around
     * the start whatever it returns, including a throw.
     */
    options.notify({
      kind: 'relay-starting',
      teammateId: recipient.self.teammateId,
      name: recipient.self.name,
      answering: from.missionId,
      hop: input.origin.hop
    })
    const settled = (): void => options.notify({ kind: 'relay-start-settled', teammateId: recipient.self.teammateId })
    let response: CodexMissionStartResponse
    try {
      response = await options.start({
        prompt: input.prompt,
        runtime: route.runtime,
        mode: route.mode,
        model: route.model === 'account-default' ? undefined : route.model,
        peer: recipient,
        followUpOf,
        relay: input.origin
      })
    } catch {
      settled()
      input.notice(`${recipient.self.name} could not reply on their own: the run could not be started.`)
      return { kind: 'refused' }
    }
    settled()
    if (!response.ok) {
      // Mid-run is not a refusal. A teammate runs one mission at a time, so
      // answering while they work is impossible and answering when they
      // finish is ordinary; the caller holds the reply until then.
      if (response.error.code === 'RUN_ALREADY_ACTIVE') return { kind: 'busy' }
      input.notice(`${recipient.self.name} could not reply on their own: ${response.error.message} The message waits for their next run.`)
      return { kind: 'refused' }
    }
    // Counted HERE, not at the decision: a decision that never became a run
    // spends nothing, and a held reply that starts minutes later spends then.
    // This is the one place every relayed run passes through.
    if (input.origin.rootMissionId !== undefined) recordSpend(input.origin.rootMissionId)
    await options.assignOwner(recipient.self.teammateId, response.data.missionId).catch(() => undefined)
    options.notify({
      kind: 'mission-started',
      runId: response.data.runId,
      missionId: response.data.missionId,
      teammateId: recipient.self.teammateId,
      prompt: input.prompt,
      data: response.data,
      startedBy: { kind: 'relay', hop: input.origin.hop }
    })
    return { kind: 'started', missionId: response.data.missionId }
  }

  /**
   * Stop a teammate's run so a waiting message is their next one.
   *
   * Said in the sender's thread either way: an interruption that was asked
   * for and refused by a switch is exactly the case where silence reads as
   * the message never arriving.
   */
  const interruptFor = async (recipient: MissionPeerContext, notice: (message: string) => void): Promise<void> => {
    let allowed = false
    try {
      allowed = (await options.mayInterrupt?.()) === true
    } catch {
      allowed = false
    }
    if (!allowed) {
      notice(
        `${recipient.self.name} was asked to take this before finishing. Teammates interrupting each other is switched off in Settings, so it waits for their run to end.`
      )
      return
    }
    let stopped = false
    try {
      stopped = (await options.stopWorkOf?.(recipient.self.teammateId)) === true
    } catch {
      stopped = false
    }
    if (stopped) {
      notice(`${recipient.self.name} was stopped part-way so they can take this next. Whatever they had done is in their own conversation.`)
    }
  }

  /** Hold a reply for a teammate who is mid-run. The first one held wins. */
  const defer = (entry: DeferredReply): void => {
    const teammateId = entry.recipient.self.teammateId
    if (deferred.has(teammateId)) return
    deferred.set(teammateId, entry)
    entry.notice(`${entry.recipient.self.name} is part-way through another mission. Their reply starts when it ends.`)
  }

  /**
   * Start a held reply, now that its recipient's run has ended.
   *
   * The switch and the cap are read again rather than remembered: a person
   * who turned replies off while a teammate was working meant it, and a hop
   * budget they lowered should bind the hop it was lowered before.
   */
  const deliverDeferred = async (teammateId: string): Promise<void> => {
    const entry = deferred.get(teammateId)
    if (entry === undefined) return
    deferred.delete(teammateId)
    let enabled = false
    try {
      enabled = await options.enabled()
    } catch {
      enabled = false
    }
    let cap = MAX_RELAY_HOPS
    try {
      cap = (await options.hopCap?.()) ?? MAX_RELAY_HOPS
    } catch {
      cap = MAX_RELAY_HOPS
    }
    const decision = decideRelay({
      enabled,
      hop: entry.origin.hop - 1,
      recipientName: entry.recipient.self.name,
      cap,
      // Against what the exchange has spent NOW, not when this was held. That
      // gap is the leak: every decision was inside the cap and the total was
      // not, because a held reply carried a hop the exchange had moved past.
      spent: spendOf(entry.origin.rootMissionId, entry.origin.hop - 1)
    })
    if (!decision.start) {
      entry.notice(decision.reason)
      return
    }
    if (options.stillWaiting !== undefined) {
      let waiting = true
      try {
        waiting = await options.stillWaiting(teammateId)
      } catch {
        // Unknown means send: a reply shown twice is recoverable, one never
        // shown is the bug this whole path exists to fix.
        waiting = true
      }
      if (!waiting) return
    }
    const outcome = await startFor({
      recipient: entry.recipient,
      prompt: entry.prompt,
      from: entry.from,
      origin: entry.origin,
      notice: entry.notice
    })
    // Free for a moment and taken again -- by a person, or by another
    // teammate's reply that landed first. Wait for the next ending.
    if (outcome.kind === 'busy') {
      deferred.set(teammateId, entry)
      return
    }
    if (outcome.kind === 'started' && entry.exchange !== undefined) exchanges.set(outcome.missionId, entry.exchange)
  }

  /** The asker's next turn, once, briefed with everyone's reply. */
  const closeMeeting = async (meeting: Meeting, from: SharingMission): Promise<void> => {
    meetings.delete(meeting.askerMissionId)
    const asker = await options.peerContextFor(meeting.askerId)
    if (asker === undefined) return
    if (meeting.answered.length === 0) {
      notify(meeting.askerRunId, meeting.askerMissionId, 'Nobody replied. Your message waits with them for their next run.')
      return
    }
    const silent = [...meeting.silent, ...meeting.awaiting.values()]
    const origin: RelayOrigin = {
      hop: meeting.origin.hop + 1,
      ...(meeting.origin.rootMissionId === undefined ? {} : { rootMissionId: meeting.origin.rootMissionId }),
      lastMissionOf: { ...meeting.origin.lastMissionOf, [from.peer.self.teammateId]: from.missionId }
    }
    // The PERSON'S cap, and the exchange's actual spend -- this checked the
    // constant, so a workspace that lowered its budget still got six here.
    let cap = MAX_RELAY_HOPS
    try {
      cap = (await options.hopCap?.()) ?? MAX_RELAY_HOPS
    } catch {
      cap = MAX_RELAY_HOPS
    }
    const spent = spendOf(origin.rootMissionId, origin.hop)
    if (spent >= cap) {
      notifyAndKeep(
        meeting.askerRunId,
        meeting.askerMissionId,
        `Stopped after ${String(cap)} automatic ${cap === 1 ? 'reply' : 'replies'}. The replies wait for your next run.`
      )
      return
    }
    const notice = (message: string): void => notify(meeting.askerRunId, meeting.askerMissionId, message)
    const outcome = await startFor({
      recipient: asker,
      prompt: meetingPrompt({ repliers: meeting.answered, silent }),
      from,
      origin,
      notice
    })
    // The asker picked up another mission while the meeting ran. The minutes
    // keep until they are free rather than being dropped on the floor.
    if (outcome.kind === 'busy') {
      defer({
        recipient: asker,
        prompt: meetingPrompt({ repliers: meeting.answered, silent }),
        from,
        origin,
        notice,
        exchange: undefined
      })
    }
  }

  return {
    async onShared(mission, posted) {
      if (posted.length === 0) return
      let enabled = false
      try {
        enabled = await options.enabled()
      } catch {
        enabled = false
      }
      let cap = MAX_RELAY_HOPS
      try {
        cap = (await options.hopCap?.()) ?? MAX_RELAY_HOPS
      } catch {
        cap = MAX_RELAY_HOPS
      }
      const hop = mission.relay?.hop ?? 0
      // The exchange this belongs to. A mission a PERSON started is its own
      // root; every relayed one carries the root it was started under.
      const root = mission.relay?.rootMissionId ?? mission.missionId
      const notice = (message: string): void => notify(mission.runId, mission.missionId, message)

      // A reply into an open meeting is held, not relayed: the asker's turn
      // starts once everyone has spoken. The message itself is already in
      // the workroom, so nothing is lost by waiting.
      const meeting = answering.get(mission.missionId)
      const held = new Set<string>()
      if (meeting !== undefined && meeting.awaiting.has(mission.peer.self.teammateId)) {
        if (posted.some((message) => message.to.teammateId === meeting.askerId)) {
          meeting.awaiting.delete(mission.peer.self.teammateId)
          meeting.answered.push(mission.peer.self.name)
          held.add(meeting.askerId)
          if (meeting.awaiting.size > 0) {
            notify(
              meeting.askerRunId,
              meeting.askerMissionId,
              `${mission.peer.self.name} replied. Still waiting on ${[...meeting.awaiting.values()].join(', ')}.`
            )
          } else {
            await closeMeeting(meeting, mission)
          }
        }
      }

      // One automatic run per recipient per share, whatever was posted: a
      // run that wrote to the same teammate twice gets one reply, not two.
      // This run answering an exchange it was started for: whatever else it
      // does, the asker is no longer waiting in silence.
      const waiting = exchanges.get(mission.missionId)
      if (waiting !== undefined && posted.some((message) => message.to.teammateId === waiting.askerId)) {
        exchanges.delete(mission.missionId)
      }

      const seen = new Set<string>()
      const started: { readonly teammateId: string; readonly name: string; readonly missionId: string }[] = []
      for (const message of posted) {
        const recipientId = message.to.teammateId
        if (seen.has(recipientId) || held.has(recipientId)) continue
        seen.add(recipientId)

        const decision = decideRelay({
          enabled,
          hop,
          recipientName: message.to.name,
          cap,
          spent: spendOf(root, hop),
          ...(message.defer === true ? { defer: true } : {})
        })
        if (!decision.start) {
          // Kept: this is the sentence that explains why a conversation the
          // person comes back to simply stopped.
          void options.note?.({ missionId: mission.missionId, message: decision.reason }).catch(() => undefined)
          // Every message that goes nowhere is said, off included: replies
          // are on by default now, so off is a choice the person made and
          // may have forgotten -- and a share with no answer and no word
          // was the one thing a drive could not explain (2026-09-05).
          notice(decision.reason)
          continue
        }

        try {
          const recipient = await options.peerContextFor(recipientId)
          if (recipient === undefined) {
            notice(`${message.to.name} is no longer on the roster; nothing was started.`)
            continue
          }
          const origin: RelayOrigin = {
            hop: decision.hop,
            rootMissionId: root,
            lastMissionOf: { ...(mission.relay?.lastMissionOf ?? {}), [mission.peer.self.teammateId]: mission.missionId }
          }
          // The person-started mission is the first entry in `lastMissionOf`
          // (documented on RelayOrigin), so its teammate is the one whose
          // conversation the person is reading.
          const readByPerson = Object.keys(origin.lastMissionOf)[0] === recipientId
          const prompt = relayPrompt({ sender: mission.peer.self, recipient: recipient.self, hop: origin.hop, cap, readByPerson })
          const result = await startFor({ recipient, prompt, from: mission, origin, notice })
          if (result.kind === 'busy') {
            defer({
              recipient,
              prompt,
              from: mission,
              origin,
              notice,
              exchange: {
                askerRunId: mission.runId,
                askerMissionId: mission.missionId,
                askerId: mission.peer.self.teammateId,
                recipientName: recipient.self.name
              }
            })
            /*
             * Asked to be taken now, and allowed to be.
             *
             * Stopping is the WHOLE action. The reply is started by the held-
             * message path when the run ends, which is the same path every
             * other waiting message takes -- so an interruption can only ever
             * shorten a wait, never become a second way to start a mission,
             * and it cannot outrun the hop cap or the relay switch because it
             * does not go near either.
             */
            if (message.urgent === true) await interruptFor(recipient, notice)
            continue
          }
          if (result.kind === 'started') started.push({ teammateId: recipientId, name: recipient.self.name, missionId: result.missionId })
        } catch (error) {
          // Whatever failed between the decision and the start, the thread
          // says so. The service that called us swallows anything thrown
          // here, which is how a failure became silence.
          notice(`${message.to.name} could not reply on their own: ${error instanceof Error ? error.message : String(error)} The message waits for their next run.`)
        }
      }

      // Writing to several teammates at once opens a meeting: their answers
      // are collected, and the asker's next turn starts once, with all of
      // them. One recipient is an ordinary exchange and needs no minutes.
      if (started.length >= 2) {
        const opened: Meeting = {
          askerId: mission.peer.self.teammateId,
          askerName: mission.peer.self.name,
          askerRunId: mission.runId,
          askerMissionId: mission.missionId,
          origin: {
            hop,
            rootMissionId: root,
            lastMissionOf: { ...(mission.relay?.lastMissionOf ?? {}), [mission.peer.self.teammateId]: mission.missionId }
          },
          awaiting: new Map(started.map((entry) => [entry.teammateId, entry.name])),
          answered: [],
          silent: []
        }
        meetings.set(mission.missionId, opened)
        for (const entry of started) answering.set(entry.missionId, opened)
        notice(`Waiting on ${started.map((entry) => entry.name).join(', ')} to reply before your next turn.`)
      } else {
        for (const entry of started) {
          exchanges.set(entry.missionId, {
            askerRunId: mission.runId,
            askerMissionId: mission.missionId,
            askerId: mission.peer.self.teammateId,
            recipientName: entry.name
          })
        }
      }
    },

    async onRunEnded(mission) {
      // An ordinary exchange that ended with nothing written back. The reply
      // is not lost -- it is in the recipient's own conversation -- and the
      // person watching the thread that asked is told where to find it,
      // rather than being left to conclude the message never arrived.
      const exchange = exchanges.get(mission.missionId)
      exchanges.delete(mission.missionId)
      if (exchange !== undefined) {
        notifyAndKeep(
          exchange.askerRunId,
          exchange.askerMissionId,
          `${exchange.recipientName} finished without writing back. Anything they said is in their own conversation.`
        )
      }
      const meeting = answering.get(mission.missionId)
      answering.delete(mission.missionId)
      const teammateId = mission.peer?.self.teammateId
      if (meeting !== undefined && mission.peer !== undefined && teammateId !== undefined && meeting.awaiting.has(teammateId)) {
        // Ended without a word to the asker: counted, not waited for forever.
        meeting.awaiting.delete(teammateId)
        meeting.silent.push(mission.peer.self.name)
        if (meeting.awaiting.size > 0) {
          notify(
            meeting.askerRunId,
            meeting.askerMissionId,
            `${mission.peer.self.name} finished without replying. Still waiting on ${[...meeting.awaiting.values()].join(', ')}.`
          )
        } else {
          await closeMeeting(meeting, {
            runId: '',
            missionId: mission.missionId,
            runtime: 'codex',
            sandbox: 'read-only',
            model: undefined,
            peer: mission.peer,
            relay: mission.relay
          })
        }
      }
      // Whatever this run was and however it ended, its teammate is free now.
      // This is the line that makes an argument alternate: the reply that
      // arrived mid-run starts here instead of waiting for a person.
      if (teammateId !== undefined) await deliverDeferred(teammateId)
    }
  }
}
