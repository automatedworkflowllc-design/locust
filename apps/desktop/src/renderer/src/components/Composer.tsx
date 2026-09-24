import mark from '../assets/locust-mark.svg'
import { useCallback, useMemo, useRef, useState } from 'react'
import { usagePercent, usageWindowSentence } from '../missionView.js'
import { useDismissOnOutsidePress } from '../useDismissOnOutsidePress.js'
import type { ClipboardEvent, FormEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react'

import type {
  MissionMode,
  MissionRouteSummary,
  PublicModel,
  PublicRuntimeStatus
} from '../../../shared/ipc.js'
import { hostCanRunMission, isMissionRuntime, runtimeDisplayName } from '../../../shared/runtimes.js'
import type { ModeFacts } from '../status.js'
import {
  MODE_FACTS,
  handoffAvailability,
  handoffTitle,
  modeRunsOn,
  modesFor,
  modeUnavailableReason,
  modelFamily,
  runtimeIsUsable
} from '../status.js'
import { defaultEffort, sendBlockedReason } from '../status.js'
import { freeTagOf, routeModelName, shortRuntimeName } from '../routeName.js'
import type { MissionRuntimeId } from '@teammate/runtime-adapters'
import { AttachedImage } from './AttachedImage.js'
import { MetalSend } from './MetalSend.js'
import type { MetalMotion, MetalPreset, MetalStrength } from '../../../shared/ipc.js'
import { isImagePath } from '../../../shared/image-files.js'
import { ContextRing } from './ContextRing.js'
import { ArrowUpGlyph, ChevronGlyph } from './ChatGlyphs.js'
import { PlusMenu } from './PlusMenu.js'
import type { ContextReading } from '../cost.js'
import { Icon } from './Icon.js'
import { Beam } from './Beam.js'
import { effortFooter, effortName } from '../effortLevels.js'
import { EffortSlider } from './EffortSlider.js'
import { effortScale, joinEffort, splitEffort } from '../effortScale.js'
import { ATTACHMENT_DIR, attachmentLabel, MAX_ATTACHMENTS, withAttachments } from '../../../shared/attachments.js'
import { availableCommands, matchingCommands, slashQuery } from '../slashCommands.js'
import type { SlashCommand } from '../slashCommands.js'
import { RoutePicker } from './RoutePicker.js'
import type { RouteChoice } from './RoutePicker.js'

const MAX_PROMPT_LENGTH = 8_000

/**
 * Each mode states its consequence, not just its name. There are two because
 * there are two the runtime can actually honour: `codex exec` has no
 * interactive approval channel, so "plan first" and "automatic" would be
 * labels over behaviour that does not differ.
 */
/*
 * The picker's rows, from the one table. They used to be written out here,
 * which is how the same mode came to be `Ask` in this list and `ask` in a
 * receipt -- see `MODE_FACTS` for the rest of that history.
 */
const MODES: readonly ModeFacts[] = MODE_FACTS

/**
 * What this mode does to a connector, in one sentence, measured.
 *
 * THREE wrong versions of this shipped on 2026-09-09 before the facts were
 * all in, and the history is kept because each was wrong in an instructive
 * way.
 *
 *  1. "Only Auto can reach an MCP server." The reason given was
 *     `--restricted`, which never blocked MCP at all -- its own help names
 *     `--strict-mcp-config` as the flag that would.
 *  2. "Your connectors are available in every mode." Removing our
 *     `--disallowedTools mcp__*` made them OFFERED, and driving the built app
 *     in Ask showed the rest: Claude Code asks before using one, and a
 *     printed run has nowhere to put that question, so the call was denied.
 *  3. "A connector call will be refused in this mode." True at the time, and
 *     wrong the moment Locust began passing an allow rule per connector.
 *
 * What is true now, measured by running the argv by hand and then by driving
 * the built app: every connector the person's own Claude Code can reach is
 * named in an allow rule on every run, so it is used without asking. Colin,
 * 2026-09-10: "honestly just let them have access to the mcp tools if the
 * client have access to it -- it only makes sense and is way less muddy."
 *
 * Which leaves the one thing a person genuinely cannot infer, and it is the
 * thing worth the line: a connector acts somewhere that is not this machine.
 * "Ask -- reads and explains, every write is refused" is a promise about
 * DISK. A teammate in Ask can still send mail or place an order through a
 * connector, because no sandbox on this machine reaches the far end of one.
 *
 * Claude Code only, for the MODE sentence: it is the only runtime whose
 * command builder mentions MCP at all, so the same words elsewhere would be a
 * claim nothing behind them makes.
 *
 * ELSEWHERE, THE SILENCE WAS THE PROBLEM. Locust reads connectors from the
 * person's Claude Code (`connector-reader.ts` -- `claude mcp list` is the
 * only source that has the claude.ai ones) and builds allow rules only for
 * Claude Code runs. On any other route this said nothing at all, so a person
 * with connectors set up had no way to learn that the route they had chosen
 * was not where they live.
 *
 * MEASURED 2026-09-11, and it cost Colin an evening: Robinhood is signed in
 * and `Connected` on his Claude Code, while `cursor-agent mcp list` reports
 * `requires_authentication` for the same URL and its `mcp login` persists
 * nothing at all -- so a teammate on Cursor failed every call, and, having
 * nothing else to go on, explained the failure by inventing reasons about
 * desktop OAuth. One sentence here would have ended it in a minute.
 *
 * The sentence must not overclaim in the other direction either. A teammate
 * on Cursor is NOT without connectors -- Cursor's own plugins were ready in
 * that same session -- it is a DIFFERENT SET, signed in separately. That is
 * the fact, and it is the one a person cannot see from here.
 */
export function connectorsNote(
  runtime: string,
  mode: MissionMode,
  /** Whether this machine's Claude Code has any, from `listConnectors`. */
  hasConnectors = false
): string | undefined {
  /*
   * Cursor's print mode has nobody to answer an approval, so a connector
   * call outside Auto resolves to "no". MEASURED in Colin's own ledger,
   * 2026-09-15/16: 17, 5, 3 and 2 `user rejected MCP` per run in Accept
   * edits (`--approve-mcps` approves the SERVER, not each call); the same
   * connector, same teammate, on Auto: 0. His question -- "wouldnt accept
   * edits hypothetically give you a prompt for the mcp call" -- yes in
   * Cursor's own app, where someone is there to answer; here there is not.
   */
  // 0.168.0: Locust writes the answer down where Cursor reads it -- an allow
  // rule per configured server in this workspace's `.cursor/cli.json` -- so
  // the question is never asked. The sentence says what a person cannot
  // infer from the mode: the rule is a file in their workspace.
  if (runtime === 'cursor' && mode !== 'auto') {
    return 'Your connectors work in this mode too: Locust allows each server you configured in this workspace\'s Cursor settings, since nobody is here to answer Cursor\'s per-call prompt. What this mode limits is this machine.'
  }
  if (runtime !== 'claude') {
    if (!hasConnectors) return undefined
    return `Your connectors are signed in on Claude Code. A teammate on ${shortRuntimeName(runtime as MissionRuntimeId)} uses that program's own instead — a different set, signed in separately.`
  }
  return mode === 'auto'
    ? 'Your connectors work here, and so does everything else on this machine.'
    : 'Your connectors work in this mode too. What this mode limits is this machine — a connector acts on the service it reaches, so it is outside the sandbox either way.'
}

export interface ComposerProps {
  /**
   * Whether this machine's Claude Code has any connectors, so the mode menu
   * can say where they live when the route is not Claude. See
   * `connectorsNote`.
   */
  readonly hasConnectors?: boolean
  readonly runtimes: readonly PublicRuntimeStatus[]
  /** Discovery asked its four times and nobody answered; the rows say NOT ANSWERING. */
  readonly runtimesGaveUp?: boolean
  /** Runtimes whose last run ended on the account's usage limit, with its own words. */
  readonly limitedRuntimes: ReadonlyMap<string, string>
  /** The latest still-allowed rate-limit reading per runtime, for the route chip's tooltip. */
  readonly usageWindows?: ReadonlyMap<string, string>
  /**
   * How full this conversation's context is, drawn left of the route.
   *
   * It lived here as a bare glyph beside the swarm mark, moved to the mission
   * header on the design agent's read (2026-09-10) -- "a fact about THIS
   * conversation, and that line is where the conversation's other facts are"
   * -- and is back, at Colin's word on 2026-09-11: "theres no more
   * context/usage circle, we can just put it on the left of the model
   * picker." Left of the ROUTE, not loose on the row, which is the part that
   * answers the original objection: it now belongs to the control it is about.
   */
  readonly context?: ContextReading
  /** The conversation's total spend, for the ring's hover or its slot. */
  readonly conversationCost?: string
  readonly discoveryPhase: 'loading' | 'ready' | 'error'
  readonly running: boolean
  readonly cancelling: boolean
  readonly activeRoute: MissionRouteSummary | undefined
  readonly error: string | undefined
  readonly mode: MissionMode
  readonly onModeChange: (mode: MissionMode) => void
  /** How full the model's context is, when the runtime reported its size. */
  /** Whether this workspace has Auto switched on. Picking Auto here switches it on. */
  readonly autoMode?: boolean
  /** Turn Auto on for the workspace, because the person just chose it. */
  readonly onEnableAutoMode?: () => void
  readonly route: RouteChoice
  readonly onRouteChange: (route: RouteChoice) => void
  readonly models: readonly PublicModel[]
  /** What each route's model resolved to last time, keyed `runtime:model`. */
  readonly resolvedModels: ReadonlyMap<string, string>
  /** Routes this person has run, newest first, as `runtime:model`. */
  readonly recentRoutes: readonly string[]
  /** Where this build is running; some containment is platform specific. */
  readonly platform: string | undefined
  /** The send button's metal; see `MetalSend` and Settings. */
  readonly metal?: MetalPreset
  readonly metalStrength?: MetalStrength
  readonly metalMotion?: MetalMotion
  readonly metalBend?: boolean
  readonly effort: string | undefined
  readonly onEffortChange: (effort: string | undefined) => void
  readonly swarm: boolean
  readonly onSwarmChange: (swarm: boolean) => void
  /** True when it started; false, or the words saying why not (M27), when it did not. */
  readonly onStart: (prompt: string) => Promise<boolean | string>
  readonly onCancel: () => void
  readonly onOpenRoutePicker: () => void
  /**
   * Move the RUNNING mission to another route. Distinct from `onRouteChange`,
   * which only decides what the next mission starts on: this one stops the
   * current run, reconciles it, and starts a briefed continuation. Two very
   * different consequences, so they are two different callbacks rather than one
   * that quietly means something else while a run is live.
   */
  readonly onHandOff: (route: RouteChoice) => void
  readonly handingOff: boolean
  /** The folder the next mission runs in, by its last segment; undefined when none is chosen. */
  readonly workspaceName: string | undefined
  /** The whole path, for the chip's tooltip -- a name alone is ambiguous across projects. */
  readonly workspacePath: string | undefined
  readonly workspaceMade?: boolean
  readonly onChooseFolder: () => void
  /** Who the next mission is messaged to; the placeholder says so. */
  readonly teammateName: string | undefined
  /**
   * Set when the addressed teammate already has a live mission somewhere.
   * Starting is refused for THEM, not for the workspace: another teammate's
   * run being on screen does not block this one.
   */
  readonly busyWith: string | undefined
  /**
   * Said above the box when the next message continues a stopped run on a
   * DIFFERENT runtime: the person is told, before sending, that the new
   * runtime starts from the old one's checkpoint rather than its memory.
   */
  readonly continuationNote: string | undefined
  /**
   * What is waiting to be sent when the running mission finishes, if anything.
   *
   * Already FOLDED: the strip shows the one instruction that will actually go,
   * not the pieces it was typed in, because that is what the teammate will
   * receive and therefore what a person is deciding about.
   */
  readonly queued: string | undefined
  /** How many separate things are waiting, so the strip can say so. */
  readonly queuedCount?: number
  /** Why a queued message has not gone yet, when it is not simply still running. */
  readonly queuedNote: string | undefined
  readonly onQueue: (text: string) => void
  readonly onUnqueue: () => void
  readonly onSendQueued: () => void
  /** The queued message belongs to a conversation that is NOT the one on screen. */
  readonly queuedElsewhere: boolean
}

/**
 * The composer: one field, one border, controls underneath.
 *
 * The design puts mode, add, route, effort and swarm on this row. Mode, add,
 * effort and swarm are drawn as disabled here on purpose -- each needs a
 * capability that does not exist yet, and a control that silently does nothing
 * is worse than one that says it is not ready. The route control is real: it
 * opens the picker, and what it displays comes from the running mission or from
 * discovery, never from a constant.
 */
/**
 * The mode Shift+Tab moves to, or undefined when there is nowhere to go.
 *
 * M33 (the code review): Auto is in the cycle only when the workspace's Auto
 * switch is already on. Landing on it used to turn that saved safety switch
 * on, and nothing turned it off when the next press moved on -- so going
 * from Accept edits round to Ask left Auto allowed for good. Turning it on is
 * the menu's choice, with its warning, never a side effect of a key.
 */
export function shiftTabMode<M extends string>(current: M, usable: readonly M[], autoAllowed: boolean): M | undefined {
  const cycle = usable.filter((mode) => mode !== 'auto' || autoAllowed)
  if (cycle.length < 2) return undefined
  const at = cycle.indexOf(current)
  return cycle[(at + 1) % cycle.length]
}

export function Composer({
  hasConnectors = false,
  continuationNote,
  workspaceName,
  workspacePath,
  workspaceMade = false,
  onChooseFolder,
  runtimes,
  runtimesGaveUp = false,
  limitedRuntimes,
  usageWindows,
  context,
  conversationCost,
  discoveryPhase,
  running,
  cancelling,
  activeRoute,
  error,
  mode,
  onModeChange,
  autoMode,
  onEnableAutoMode,
  route,
  onRouteChange,
  models,
  resolvedModels,
  recentRoutes,
  platform,
  metal,
  metalStrength,
  metalMotion,
  metalBend,
  effort,
  onEffortChange,
  swarm,
  onSwarmChange,
  onStart,
  onCancel,
  onOpenRoutePicker,
  onHandOff,
  handingOff,
  teammateName,
  busyWith,
  queued,
  queuedCount,
  queuedNote,
  onQueue,
  onUnqueue,
  onSendQueued,
  queuedElsewhere
}: ComposerProps): ReactElement {
  const [value, setValue] = useState('')
  /*
   * The box's words came off the queue by Edit. Claude Code does the same --
   * a queued message pulled back into the box is no longer queued -- but it
   * said nothing, and the outside recheck of 0.303 read Edit as "keep it
   * queued until I save": a run that finished mid-edit sent nothing, and the
   * words sat in the box. Said now, where the queued card was.
   */
  const [offTheQueue, setOffTheQueue] = useState(false)
  // Emptied -- sent, or cleared -- it is just the box again.
  if (offTheQueue && value.trim().length === 0) setOffTheQueue(false)
  /** Why the last press of Enter did nothing. Cleared as soon as one lands. */
  /**
   * What the box has to say about the last press, and in which register.
   *
   * `plain` is the difference between "that did not work" and "here is what I
   * did": a file copied in from outside the workspace is reported, not
   * refused, and drawing it in the red of a failure taught the eye to read a
   * success as a problem (seen in a drive, 2026-09-08).
   */
  const [refusal, setRefusal] = useState<{ readonly text: string; readonly plain?: boolean }>()
  const type = (next: string): void => {
    setValue(next)
    // Typing leaves the history. Without this, editing a recalled message and
    // then pressing up again would walk further back and throw the edit away.
    if (recallAt >= 0) setRecallAt(-1)
    // The refusal was about the press, not about the text. Typing again is
    // the person trying something; leaving the old sentence up implies it
    // still applies.
    if (refusal !== undefined) setRefusal(undefined)
  }
  /** Say something, or -- with no text -- say nothing. */
  const setNote = (text: string | undefined, plain = false): void => {
    setRefusal(text === undefined ? undefined : { text, ...(plain ? { plain: true } : {}) })
  }
  const [modeOpen, setModeOpen] = useState(false)
  /**
   * Files this message will point the runtime at, workspace-relative.
   *
   * Cleared on send, like the box itself: an attachment belongs to the message
   * it was chosen for, and carrying it silently into the next one would attach
   * a file nobody asked for.
   */
  const [attached, setAttached] = useState<readonly string[]>([])
  /**
   * Which attached files were brought in from outside the workspace.
   *
   * The mark appears only where something actually happened: a file already
   * inside the folder gets a plain tile, because marking it would claim a copy
   * that never took place.
   */
  const [copiedIn, setCopiedIn] = useState<ReadonlySet<string>>(new Set())
  const [attaching, setAttaching] = useState(false)
  /**
   * Which slash command the arrow keys are on.
   *
   * Typing narrows the list under it, so this index can outlive the entry it
   * pointed at. Every read clamps to the last row rather than resetting on
   * every keystroke: resetting would drag the highlight back to the top mid-typing,
   * and clamping means the index can never name a command that is not there.
   */
  const [slashAt, setSlashAt] = useState(0)
  const [effortOpen, setEffortOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  /*
   * These three panels closed only by pressing their own control again,
   * which is not how a menu behaves anywhere else in this app or on the
   * machine. Reported by the first outside tester on 0.55.0: "you to click
   * out of it you have to click the button again instead of just clicking
   * anywhere on the page."
   *
   * The ref is on the ANCHOR, which holds the panel and the control that
   * opens it, so a press on the control still toggles rather than being
   * swallowed by the close.
   */
  /*
   * What you have sent, so the up arrow can bring it back.
   *
   * Claude Code recalls the previous message on an empty prompt and it is one
   * of the highest-frequency things in the whole program -- resend, tweak a
   * word, resend. Locust's composer bound the arrows only while the slash
   * menu was open, so on an empty box they did nothing at all.
   *
   * Kept in the composer rather than the record because it is a property of
   * this box in this session, the same as it is there: it recalls what YOU
   * typed, not what the mission holds.
   */
  const sent = useRef<string[]>([])
  const [recallAt, setRecallAt] = useState(-1)

  const modeAnchor = useRef<HTMLSpanElement>(null)
  const pickerAnchor = useRef<HTMLSpanElement>(null)
  const effortAnchor = useRef<HTMLSpanElement>(null)
  /** The chips the send's metal is cast onto -- see `reflectOnto`. */
  const routeChip = useRef<HTMLButtonElement>(null)
  const effortChip = useRef<HTMLButtonElement>(null)
  const closeMode = useCallback(() => setModeOpen(false), [])
  const closePicker = useCallback(() => setPickerOpen(false), [])
  const closeEffort = useCallback(() => setEffortOpen(false), [])
  useDismissOnOutsidePress(modeOpen, closeMode, modeAnchor)
  useDismissOnOutsidePress(pickerOpen, closePicker, pickerAnchor)
  useDismissOnOutsidePress(effortOpen, closeEffort, effortAnchor)

  // A mode the chosen route cannot run is not the mode a mission would start
  // in, so it is not the mode the control shows either. Switching route used
  // to leave "Approve each action" selected against a runtime that refuses
  // it, and every message was then rejected before it began.
  const effectiveMode: MissionMode = modeRunsOn(mode, route.runtime, platform)
    ? mode
    : modesFor(route.runtime, platform)[0] ?? 'accept-edits'
  /*
   * Slash commands. Every one maps to a control already on this row, so the
   * menu is a keyboard path to things that exist rather than a new capability
   * -- and the list is filtered by what is actually possible, so a command can
   * never be offered and then refused.
   */
  const slashing = slashQuery(value)
  const slashChoices = slashing === undefined
    ? []
    : matchingCommands(slashing, availableCommands({
        modes: modesFor(route.runtime, platform),
        running,
        canSwarm: !running
      }))
  const runSlash = (command: SlashCommand): void => {
    setValue('')
    setSlashAt(0)
    switch (command.action.kind) {
      case 'mode':
        // Exactly what choosing the mode in the menu does, including the part
        // that is easy to miss: Auto is refused unless the workspace switch is
        // on, and App turns it straight back to Accept edits. A drive on
        // 2026-09-08 typed `/auto`, watched the box clear, and watched the
        // mode not change -- a command offered and then quietly undone, which
        // is the one thing this menu promises cannot happen.
        if (command.action.mode === 'auto' && autoMode !== true) onEnableAutoMode?.()
        onModeChange(command.action.mode)
        break
      case 'route':
        onOpenRoutePicker()
        break
      case 'stop':
        onCancel()
        break
      case 'swarm':
        onSwarmChange(!swarm)
        break
    }
  }
  const selected = runtimes.find((runtime) => runtime.id === route.runtime)
  // The account's window, from the latest reading (SURFACES-0.22 §3): a
  // sentence in the tooltip always; a dot on the chip only from 80%, when a
  // long run might not finish.
  const usageReading = usageWindows?.get(route.runtime)
  const usagePercentNow = usageReading === undefined ? undefined : usagePercent(usageReading)
  const usageSentence = usageReading === undefined
    ? undefined
    : usagePercentNow !== undefined && usagePercentNow >= 100
      ? `${usageWindowSentence(usageReading)}. This window's limit is used up.`
      : usagePercentNow !== undefined && usagePercentNow >= 80
        ? `${usageWindowSentence(usageReading)}. Long runs may be cut short.`
        : usageWindowSentence(usageReading)
  const usagePressing = usagePercentNow !== undefined && usagePercentNow >= 80
  const selectedReady = selected !== undefined && runtimeIsUsable(selected)
  // A runtime that could run this message even though the route does not
  // point at it. Only consulted when the selected one cannot.
  const readyElsewhere = selectedReady
    ? undefined
    : runtimes.find(
        (runtime) => runtimeIsUsable(runtime) && isMissionRuntime(runtime.id) && hostCanRunMission(runtime.id)
      )
  // A runtime can own a mission once the host can read its events. Readiness
  // still comes from discovery, so a route that is installed but signed out
  // cannot be started.
  const routeCanRun = hostCanRunMission(route.runtime)
  const canStart = selectedReady && routeCanRun && busyWith === undefined && value.trim().length > 0
  // While a mission works, what you type is not lost and not sent into a run
  // that cannot hear it: it waits and goes as the next turn when this one
  // finishes. Before 0.20.0 the box was simply disabled, so the only way to
  // say the next thing was to stop the work first.
  //
  // Keyed on the RUN being live, not on a teammate being busy: a mission
  // that belongs to nobody -- which is every mission until someone makes a
  // teammate -- has no busy teammate, and the first version of this could
  // not be used at all on a fresh profile (steering smoke, 2026-09-05).
  const workingNow = running || busyWith !== undefined
  const canQueue = workingNow && queued === undefined && value.trim().length > 0
  const workingName = busyWith ?? 'this mission'

  // With a message queued the box is shut, and the caption under that
  // message already says when it goes: the box says how to change it.
  const placeholder = workingNow
    ? queued === undefined
      ? `Say what is next — it goes to ${workingName} when this finishes…`
      : 'Edit the queued message to change it…'
    : !routeCanRun
      ? `The ${selected?.displayName ?? 'selected'} adapter is not finished — switch the route to run a mission…`
      : selectedReady
        ? // Just the invitation. Three of these used to restate the
          // permission mode -- "it may edit files in this workspace" -- which
          // the mode control says in two words directly underneath, so the
          // box was the second voice saying the same thing (Colin,
          // 2026-09-05). Every OTHER line here survives, because each says
          // something no other part of the screen does.
          // Asking several says so; asking one is the sentence it always was.
          teammateName === undefined ? 'Write a message…' : `Message ${teammateName}…`
        : discoveryPhase === 'loading'
          ? 'Checking local runtimes…'
          : discoveryPhase === 'error'
            ? 'Runtime discovery is unavailable…'
            : // Something on this machine CAN run; it just is not the route
              // this box is pointing at. Telling the person to install a
              // coding agent when they have just installed one -- and been
              // told by Settings to -- is the wall the whole first run hits
              // (QA, 2026-09-06, reproduced live). The route normally moves
              // itself; this covers the case where the person has chosen one
              // deliberately and it has since stopped being usable.
              readyElsewhere !== undefined
              ? `${readyElsewhere.displayName} is ready — switch the route to it…`
              : // "and sign in" only when there is something to sign in to.
                // Pass 4 took this instruction off the roster; pass 5 found
                // it still in the box you type into, two inches under a
                // welcome saying OpenCode needs no account (Grok, 0.154.0).
                // And "installed" was not enough either: five CLIs that
                // hang on PATH count as installed, and the box then asked
                // for a sign-in beside a row saying no account is needed
                // (Grok, pass 11). Only a runtime that has SAID it wants a
                // sign-in earns the words.
                runtimes.some((runtime) => runtime.status === 'auth-required' || runtime.auth === 'unauthenticated')
                ? 'Install a coding agent and sign in to start a mission…'
                : // And "install" is wrong under five rows that say installed
                  // and not answering (Fable, pass 1, finding 9): the box
                  // names what the screen above it offers, Check again.
                  runtimes.some((runtime) => runtime.installed)
                  ? runtimesGaveUp
                    ? /*
                       * COUNTED, because the rest of the screen is plural.
                       *
                       * This said "A coding agent is installed but not
                       * answering" over FIVE rows that each said so and each
                       * carried their own Check again (Grok, pass 16, the
                       * extra finding). The list was plural, the buttons were
                       * plural, and the box you type into was not.
                       *
                       * Only the ones this sentence is ABOUT: installed, and
                       * still not usable after discovery gave up. A machine
                       * with one working CLI and one hung one is not
                       * "2 coding agents are not answering".
                       */
                      (() => {
                        const silent = runtimes.filter(
                          (runtime) => runtime.installed && !runtimeIsUsable(runtime)
                        ).length
                        return silent === 1
                          ? 'A coding agent is installed but not answering — Check again above…'
                          : `${String(silent)} coding agents are installed but not answering — Check again above…`
                      })()
                    : // Installed and still being asked: say that, not "install".
                      'Checking the coding agents on this machine…'
                  : 'Install a coding agent to start a mission…'

  const submit = (submitEvent: FormEvent<HTMLFormElement>): void => {
    submitEvent.preventDefault()
    const prompt = value.trim()
    if (prompt.length === 0) return
    if (canQueue) {
      onQueue(prompt)
      setValue('')
      return
    }
    if (!canStart) {
      // Silence here is the single worst thing this box can do: the person
      // types, presses Enter, and the app neither sends nor explains. It cost
      // the whole first run in the QA pass. Every refusal now names itself.
      setNote(
        !routeCanRun
          ? `The ${selected?.displayName ?? 'selected'} adapter is not finished, so a mission cannot start on it. Switch the route.`
          : readyElsewhere !== undefined
            ? `This message would go to ${selected?.displayName ?? 'the selected runtime'}, which is not ready. ${readyElsewhere.displayName} is — switch the route to it.`
            : 'No runtime on this machine can run a mission yet. Settings lists what to install.'
      )
      return
    }
    setRefusal(undefined)
    // Newest last, and never the same line twice running -- pressing up
    // after sending the same thing twice should go back one message, not
    // one keystroke.
    if (sent.current[sent.current.length - 1] !== prompt) sent.current = [...sent.current, prompt].slice(-50)
    setRecallAt(-1)
    // Cleared NOW, not when the host answers. The turn is already on screen as
    // a bubble the instant it is sent, so waiting for the round trip left the
    // same sentence in two places for the whole "Starting..." window and read
    // as lag (Colin, 2026-09-05, screenshot). If the send never happened at
    // all, the words come straight back rather than being lost.
    setValue('')
    const sending = attached
    setAttached([])
    void onStart(withAttachments(prompt, sending)).then((started) => {
      if (started !== true) {
        setValue(prompt)
        setAttached(sending)
        // M27: and say why, when the host said.
        if (typeof started === 'string') setNote(started)
      }
    })
  }

  /**
   * Ctrl+V a file or a screenshot straight into the message.
   *
   * Colin, 2026-09-10: "lets add the ability to ctrl+v a file or photo into
   * the chat."
   *
   * A pasted SCREENSHOT is what decides the shape. The clipboard holds a
   * bitmap, not a file, so there is no path anywhere for the + button's route
   * to take -- the bytes have to travel. Electron also stopped exposing
   * `File.path` some versions ago, so a real file copied out of Explorer
   * arrives with no path either. One route serves both: read the bytes, let
   * the host name and place them.
   *
   * Text pastes fall through untouched. `clipboardData.files` is empty for
   * those, so pasting a paragraph still just types it.
   */
  /**
   * THE WHOLE BOX TAKES A CLICK.
   *
   * Colin, 2026-09-23: "only a very small portion of the chat window is
   * actually clickable to begin chatting". The field is one line at the top
   * of a box six times its height -- measured, 728x16 inside 760x108 -- and a
   * press on the padding or between the chips did nothing: 61 of 468 points
   * off the controls started a message (probe-composer-click). Claude Code's
   * input takes a click anywhere in its frame. So a press on the box that is
   * not on one of its controls puts the caret in the field, at the end; a
   * control keeps its press, and a press on the field itself is the field's.
   */
  const field = useRef<HTMLTextAreaElement>(null)
  const pressBox = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    const input = field.current
    if (input === null || input.disabled || target === input) return
    if (target.closest('button, a, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"]') !== null) return
    // Kept from landing on the box, where it would only leave again.
    event.preventDefault()
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const bridge = window.desktop
    const files = [...(event.clipboardData?.files ?? [])]
    if (bridge === undefined || files.length === 0 || running) return
    // Only once there is something to attach: calling this on every text
    // paste would swallow the paste.
    event.preventDefault()
    setAttaching(true)
    void (async () => {
      for (const file of files.slice(0, MAX_ATTACHMENTS)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        // A pasted bitmap has no name of its own -- the browser calls it
        // `image.png` at best -- so it gets one that says where it came from
        // and cannot collide with a file the person chose.
        const named = file.name.length > 0 ? file.name : `pasted-${String(Date.now())}.png`
        const answer = await bridge.attachPasted(named, bytes)
        if (answer.ok) {
          setAttached((current) => [...new Set([...current, ...answer.paths])].slice(0, MAX_ATTACHMENTS))
          if (answer.copied !== undefined && answer.copied.length > 0) {
            setCopiedIn((current) => new Set([...current, ...(answer.copied ?? [])]))
          }
        } else if (answer.message.length > 0) {
          setNote(answer.message)
        }
      }
    })()
      .catch(() => setNote('That could not be attached. Your message is untouched.'))
      .finally(() => setAttaching(false))
  }

  const keyDown = (keyEvent: KeyboardEvent<HTMLTextAreaElement>): void => {
    // While the slash menu is open the arrows and Enter belong to it. Enter
    // must NOT fall through to submit: sending "/plan" as a message to a
    // teammate is the one outcome this feature exists to prevent.
    if (slashChoices.length > 0) {
      if (keyEvent.key === 'ArrowDown') {
        keyEvent.preventDefault()
        setSlashAt((at) => (at + 1) % slashChoices.length)
        return
      }
      if (keyEvent.key === 'ArrowUp') {
        keyEvent.preventDefault()
        setSlashAt((at) => (at - 1 + slashChoices.length) % slashChoices.length)
        return
      }
      if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
        keyEvent.preventDefault()
        const chosen = slashChoices[Math.min(slashAt, slashChoices.length - 1)]
        if (chosen !== undefined) runSlash(chosen)
        return
      }
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault()
        setValue('')
        return
      }
    }
    /*
     * Shift+Tab cycles the permission mode, the way it does in Claude Code.
     *
     * The mode is the highest-consequence control on this screen -- it is
     * the difference between a teammate that explains and one that writes --
     * and reaching it meant a menu every time. Tab alone is left alone,
     * because moving focus out of a text box is what Tab is for everywhere.
     *
     * Only through modes this route can ACTUALLY run. `modeUnavailableReason`
     * is what the menu greys an option out with, so cycling past those keeps
     * the key from landing somewhere the menu would have refused -- offered
     * and then refused is the pattern this app keeps paying for.
     */
    if (keyEvent.key === 'Tab' && keyEvent.shiftKey) {
      const usable = MODES.filter(
        (option) => modeUnavailableReason(option.mode, route.runtime, platform) === undefined
      ).map((option) => option.mode)
      const next = shiftTabMode(mode, usable, autoMode === true)
      if (next !== undefined) {
        keyEvent.preventDefault()
        onModeChange(next)
        return
      }
    }
    /*
     * Escape stops the run, the way it does in Claude Code.
     *
     * Only while this box has focus and no panel is open. A panel's own
     * Escape closes it -- and a keystroke that both dismissed a menu and
     * killed a mission would be the worst kind of surprise, since one of
     * those is free and the other is not.
     */
    if (keyEvent.key === 'Escape' && running && !modeOpen && !pickerOpen && !effortOpen) {
      keyEvent.preventDefault()
      onCancel()
      return
    }
    /*
     * The up arrow brings back what you sent.
     *
     * Only from an empty box, or once already walking the history. This is a
     * TEXTAREA and messages here are often several lines, so an up arrow in
     * the middle of one has to keep moving the caret -- which is also what
     * Claude Code does.
     */
    if (keyEvent.key === 'ArrowUp' && sent.current.length > 0 && (value.length === 0 || recallAt >= 0)) {
      keyEvent.preventDefault()
      const next = recallAt < 0 ? sent.current.length - 1 : Math.max(0, recallAt - 1)
      setRecallAt(next)
      setValue(sent.current[next] ?? '')
      return
    }
    if (keyEvent.key === 'ArrowDown' && recallAt >= 0) {
      keyEvent.preventDefault()
      const next = recallAt + 1
      // Past the newest is the empty box you started from, not a wrap.
      if (next >= sent.current.length) {
        setRecallAt(-1)
        setValue('')
        return
      }
      setRecallAt(next)
      setValue(sent.current[next] ?? '')
      return
    }
    if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
      keyEvent.preventDefault()
      keyEvent.currentTarget.form?.requestSubmit()
    }
  }

  // Effort is offered ONLY where the chosen model says it is supported. The
  // design's rule is that an unsupported effort must show as unsupported
  // rather than be sent as a silent no-op.

  // While a mission runs, the control states what IT is on. Otherwise it
  // states what the next mission will use -- which is what the person just
  // picked. Reading the live run's model when nothing is running left a
  // finished mission's `account-default` on screen over a chosen model.
  const shownRuntime = running ? activeRoute?.runtime ?? route.runtime : route.runtime
  const shownModel = running ? activeRoute?.model ?? route.model : route.model
  // Keyed to the route the chip is SHOWING, which while a mission runs is the
  // live one rather than the next one. It used to read the next route's
  // levels under the live route's name -- two models on one chip. The control
  // is disabled during a run, so this is display only and has to agree with
  // the label beside it; when nothing is running the two are the same route.
  // Through `modelFamily`, not a bare id match: once a run resolves a Cursor
  // route to a variant, an id match finds no family and the chip vanishes.
  /*
   * What this model reports -- and, separately, whether we have been told yet.
   *
   * These were one value, and an empty list meant both "this model has no
   * levels" and "the catalog has not arrived". So a composer opened before the
   * model list loaded stated "effort · fixed", which reads as a fact about the
   * runtime ("it uses its own") when nothing was known at all. Caught by the
   * approve-each drive on 2026-09-08: three runs of the same seed showed
   * `medium`, then `low`, then `effort · fixed`.
   */
  const shownFamily = modelFamily(models, shownRuntime, shownModel)
  const supportedEfforts = shownFamily?.supportedEfforts ?? []
  /** Only true once the catalog has actually answered for THIS model. */
  const effortIsGenuinelyFixed = shownFamily !== undefined && shownFamily.supportedEfforts.length === 0
  // Swarm means "this model's maximum", and the catalog orders efforts lowest
  // to highest, so the maximum is the last one THIS model reported -- not a
  // fixed name that some models do not have.
  const swarmEffort = supportedEfforts[supportedEfforts.length - 1]
  // What the chip states. Swarm overrides it, and otherwise an unchosen
  // level shows the model's default rather than nothing -- the same value
  // App.tsx sets on a route change, so the chip says what the run gets.
  /*
   * The effort a VARIANT ID already encodes, when no separate one was chosen.
   *
   * Cursor states its effort in the model name -- `cursor-grok-4.6-high` and
   * `cursor-grok-4.6-low` are two ids for one model -- so a route carrying
   * only that id already says which level it is. Falling straight through to
   * `defaultEffort` made a teammate stored on `cursor-grok-4.6-high` read as
   * `medium` and, worse, run as medium (MEASURED 2026-09-11: seeded `-high`,
   * the panel said `medium`). The catalog's own variant map is the answer;
   * nothing is guessed from the string.
   */
  const effortOfShownId = Object.entries(shownFamily?.variants ?? {})
    .find(([, id]) => id === shownModel)?.[0]
  const shownEffort = swarm ? swarmEffort : effort ?? effortOfShownId ?? defaultEffort(supportedEfforts, shownFamily?.defaultEffort)
  // The scale this model actually offers, and where the current level sits on
  // it. Four stops and a switch rather than eight rows; see `effortScale.ts`.
  const { bases: effortBases, hasFast: effortHasFast } = effortScale(supportedEfforts)
  const { base: effortBase, fast: effortIsFast } = splitEffort(shownEffort ?? effortBases[0] ?? '')
  const effortIndex = Math.max(0, effortBases.indexOf(effortBase))
  const shownRuntimeStatus = runtimes.find((runtime) => runtime.id === shownRuntime)
  /** Nothing on this machine can take work, so no route is a real answer. */
  const nothingConnected = !runtimes.some(runtimeIsUsable)
  // The chip is a label on a control, not the Settings row that tells you
  // which program this is -- so `Cursor`, not `Cursor Agent`. See `routeName`.
  const runtimeLabel = shortRuntimeName(shownRuntime)
  // The whole thing, for the tooltip: a chip drops repetition, and the exact
  // string you would type somewhere else must still be reachable.
  const exactRoute = `${shownRuntimeStatus?.displayName ?? runtimeDisplayName(shownRuntime)} / ${shownModel}`
  // A family known only through its effort variants is listed under its
  // family name; showing the stand-in variant's id ("cursor-grok-4.6-high-fast")
  // beside "effort · low" read as two different answers (2026-09-06). Found
  // through its variants as well, so a route on a sibling id -- a teammate
  // saved on `claude-opus-5-5-high` -- reads "Claude Opus 5.5 1M" too, not
  // its own id spelled out.
  const namedModel = routeModelName(
    shownRuntime,
    shownFamily?.variants !== undefined ? shownFamily.displayName : shownModel,
    resolvedModels.get(`${shownRuntime}:${shownModel}`)
  )
  /*
   * Not twice on one row. Cursor carries the effort INSIDE the id
   * (`cursor-grok-4.6-medium`), and the control immediately to the right of
   * this chip is the effort. Normally the catalog resolves the family and the
   * question never arises; when it has not loaded yet, the id is all there is
   * and the row read `Grok 4.6 Medium` beside a slider saying `medium`.
   */
  const effortWord = (shownEffort ?? '').split('-')[0] ?? ''
  const trailing = effortWord.length === 0 ? '' : ` ${effortWord.charAt(0).toUpperCase()}${effortWord.slice(1)}`
  const modelLabel =
    trailing.length > 0 && namedModel.endsWith(trailing) && namedModel.length > trailing.length
      ? namedModel.slice(0, -trailing.length)
      : namedModel
  /*
   * "Free" is its own tag, outside the part that truncates.
   *
   * The name ends in it -- "Muse Spark 1.3 Contributor Free" -- and the chip
   * cuts names at 18 characters, so the one word that says this route costs
   * nothing was the word cut: "OpenCode / Muse Spark 1.3 C..." on every free
   * run (Yurt's beta report, #12; the 0.268 design recheck asked for this).
   */
  const { name: modelName, free: freeModel } = freeTagOf(modelLabel)
  // What the RUNNING mission is actually on, which is not always what the
  // composer's next-run route says. A handoff has to be measured against the
  // live run, or picking "the same" route would still stop it.
  const handoff = handoffAvailability(running, activeRoute !== undefined, handingOff)
  const activeChoice: RouteChoice =
    activeRoute === undefined
      ? route
      : { runtime: activeRoute.runtime, model: activeRoute.model }

  /** Attaching, as the + menu's first satellite does it. */
  const attachFiles = (): void => {
    const bridge = window.desktop
    if (bridge === undefined) return
    setAttaching(true)
    void bridge
      .attachFiles()
      .then((answer) => {
        if (answer.ok) {
          // Deduplicated and capped: the same file twice is one
          // reference, and the cap is what keeps a stray
          // multi-select out of the prompt budget.
          setAttached((current) => [...new Set([...current, ...answer.paths])].slice(0, MAX_ATTACHMENTS))
          /*
           * The "copied in" fact goes on the TILE, not in a note.
           *
           * It was a full-width bordered box above the composer,
           * the same shape as a text input and directly above
           * one -- two objects for one event, three stacked rows
           * above the box, and a transient object carrying a
           * permanent fact. The file stays copied for as long as
           * the tile exists, so dismissing the note lost
           * something still true (design, 2026-09-08).
           *
           * Remembered across picks rather than replaced: two
           * separate attaches each copying one file must leave
           * both tiles marked.
           */
          if (answer.copied !== undefined && answer.copied.length > 0) {
            setCopiedIn((current) => new Set([...current, ...(answer.copied ?? [])]))
          }
        } else if (answer.message.length > 0) {
          setNote(answer.message)
        }
      })
      .catch(() => setNote('Those files could not be attached. Your message is untouched.'))
      .finally(() => setAttaching(false))
  }

  /*
   * What the send's metal reflects onto: the chip beside it. Held in a memo so
   * the shader is not handed a new list -- and re-registering -- on every
   * keystroke.
   */
  const effortShown = shownEffort !== undefined && supportedEfforts.length > 0
  const reflectOnto = useMemo(() => [effortShown ? effortChip : routeChip], [effortShown])
  return (
    <div className="lc-composer">
      <div className="lc-composer__inner">
        {error !== undefined && (
          <div className="lc-notice" role="status" aria-live="polite">
            <Icon name="shield" size={13} />
            {error}
          </div>
        )}
        {/*
          * Why the last Enter did nothing. Same surface as the host's own
          * errors: one place the box speaks, rather than a second voice.
          */}
        {refusal !== undefined && (
          <div className={`lc-notice${refusal.plain === true ? ' is-plain' : ''}`} role="status" aria-live="polite">
            {/* The shield says "refused". A note about what the host DID is
                not a refusal, so it gets the icon for the thing it is. */}
            <Icon name={refusal.plain === true ? 'file' : 'shield'} size={13} />
            {refusal.text}
          </div>
        )}
        {/*
          * A QUEUED MESSAGE IS YOUR NEXT MESSAGE, WAITING.
          *
          * Colin, 2026-09-23, with a frame of it: "lets clean this up, looks
          * a bit trashy compared to the rest of the app". It was a label in
          * the mono face at body size, the message at full strength beside
          * it, a caption in mono under that, a lone rule down the side and
          * two buttons floating at the far right -- five voices for one
          * fact, over a box saying the same "when Pip finishes" again.
          *
          * Claude Code shows a queued message as the person's own message,
          * dimmed, just over the box. Here that is the thread's own bubble,
          * on the person's side and outlined where a sent one is filled --
          * what you will see in the thread once it goes -- and one quiet line
          * under it: when it goes, or why it is held, and what can be done.
          */}
        {queued === undefined && offTheQueue && (
          <div className="lc-queued is-editing" role="status" aria-live="polite">
            <div className="lc-queued__meta">
              <Icon name="clock" size={12} />
              <span className="lc-queued__note">
                {workingNow
                  ? `Off the queue while you edit — Enter queues it again for when ${workingName} finishes`
                  : 'Off the queue — Enter sends it'}
              </span>
            </div>
          </div>
        )}
        {queued !== undefined && (
          <div className="lc-queued" role="status" aria-live="polite">
            <div className="lc-queued__bubble">
              <span className="lc-queued__text">{queued}</span>
            </div>
            <div className="lc-queued__meta">
              <Icon name="clock" size={12} />
              {/*
                * The reason, or what will happen -- never a description of
                * the button. "ready to send" was the one state a person could
                * not act on intelligently (design pass, objection 1), and it
                * is unreachable: a queue that is ready has already gone. The
                * count only once there is more than one: several lines typed
                * during one run go as one message.
                */}
              <span className={`lc-queued__note${queuedNote === undefined ? '' : ' is-held'}`}>
                {queuedCount !== undefined && queuedCount > 1 ? `${String(queuedCount)} messages, sent as one · ` : ''}
                {queuedNote === undefined
                  ? `Sends when ${workingName} finishes`
                  : `${queuedNote.charAt(0).toUpperCase()}${queuedNote.slice(1)}`}
              </span>
              {!workingNow && (
                <button type="button" className="lc-queued__action" onClick={onSendQueued}>
                  {/* It always goes into the conversation ON SCREEN, so where
                      that is not the one it was typed at, the button says so
                      rather than reading as "send it where it was going". */}
                  {queuedElsewhere ? 'Send here' : 'Send now'}
                </button>
              )}
              {/*
                * Fixing one word meant discarding the sentence and retyping
                * it from memory: while a message is queued the box is
                * disabled, so Discard was the only way back to the text
                * (design pass, gap 2). Edit is those same two operations in
                * the order people want them.
                */}
              <button
                type="button"
                className="lc-queued__action"
                onClick={() => {
                  setValue(queued)
                  setOffTheQueue(true)
                  onUnqueue()
                }}
              >
                Edit
              </button>
              <button type="button" className="lc-queued__action" onClick={onUnqueue} aria-label="Discard the queued message">
                Discard
              </button>
            </div>
          </div>
        )}
        {continuationNote !== undefined && (
          <div className="lc-continuation lc-mono" role="status">
            <Icon name="route" size={12} />
            <span>{continuationNote}</span>
          </div>
        )}
        {/*
          * The command menu, above the box, reading what is being typed.
          *
          * Every entry maps to a control already on the row below it, so this
          * is a keyboard path to what exists rather than a second way to do
          * something new -- and `availableCommands` drops any command that
          * would be refused, so nothing here can be chosen and then fail.
          */}
        {slashChoices.length > 0 && (
          <div className="lc-slash" role="listbox" aria-label="Commands">
            {slashChoices.map((command, index) => (
              <button
                key={command.name}
                type="button"
                role="option"
                aria-selected={index === Math.min(slashAt, slashChoices.length - 1)}
                /*
                 * A weighted command gets its own section rather than only its
                 * own colour: hairline above, tinted ground, shield glyph.
                 * Amber text alone announced "this one is different" only once
                 * the row had already been read.
                 */
                className={`lc-slash__item${command.weighted === true ? ' is-weighted' : ''}${index === Math.min(slashAt, slashChoices.length - 1) ? ' is-active' : ''}`}
                onMouseEnter={() => setSlashAt(index)}
                onClick={() => runSlash(command)}
              >
                <span className="lc-slash__name lc-mono">
                  {command.weighted === true && <Icon name="shield" size={11} />}/{command.name}
                </span>
                <span className={`lc-slash__detail${command.weighted === true ? ' lc-tone-amber' : ''}`}>
                  {command.detail}
                </span>
              </button>
            ))}
          </div>
        )}
            {/*
          * Attached files, above the message rather than on the button row.
          *
          * They were a `1 file` chip beside the mode and folder controls,
          * and that row does not wrap on purpose -- so a new fixed-width
          * control on it had nowhere to go. Measured: 14px over, with the
          * effort chip running under the swarm mark. Colin, 2026-09-08:
          * "maybe just copy or use your own UI for inspiration, they just
          * put the file square in the chat."
          *
          * So: a tile per file, inside the box, where what is being sent
          * belongs -- and each one removes itself, because attaching four
          * files and wanting three was previously all-or-nothing.
          */}
        {attached.length > 0 && (
          <div className="lc-attached" aria-label={`${attachmentLabel(attached.length)} attached`}>
            {attached.map((path) => {
              const wasCopied = copiedIn.has(path)
              return (
                <button
                  key={path}
                  type="button"
                  className="lc-attached__tile"
                  title={
                    wasCopied
                      ? `${path} — copied into ${ATTACHMENT_DIR} so your teammate can read it. Click to remove.`
                      : `${path} — click to remove`
                  }
                  aria-label={wasCopied ? `Remove ${path}, copied into the workspace` : `Remove ${path}`}
                  onClick={() => setAttached((current) => current.filter((entry) => entry !== path))}
                >
                  {/* The picture where there is one, the file icon where there
                      is not -- never both, and never a broken image in place of
                      either. */}
                  {isImagePath(path) ? <AttachedImage path={path} /> : <Icon name="file" size={13} />}
                  <span className="lc-attached__name">{path.split('/').pop() ?? path}</span>
                  {/* The fact, as a segment of the tile behind a hairline. Two
                      words on screen; the whole sentence on the title, and only
                      if asked. */}
                  {wasCopied && (
                    <span className="lc-attached__copied">
                      <Icon name="copy" size={10} />
                      copied in
                    </span>
                  )}
                  <Icon name="close" size={11} />
                </button>
              )
            })}
          </div>
        )}
        <form className="command-dock lc-composer__form" onSubmit={submit}>
          <div className="lc-composer__box" onMouseDown={pressBox}>
            <textarea
              ref={field}
              value={value}
              onChange={(changeEvent) => type(changeEvent.target.value)}
              onKeyDown={keyDown}
              onPaste={paste}
              placeholder={placeholder}
              aria-label="Mission instruction"
              rows={1}
              maxLength={MAX_PROMPT_LENGTH}
              disabled={workingNow && queued !== undefined}
            />
            {/*
              * The "Shift+Enter for a new line" hint is GONE, on Colin's word
              * (2026-09-07): "everyone knows that and it takes up half the
              * chat box." It was added the same week because an outside tester
              * lost their opening mission to it -- a two-line prompt whose
              * first Enter submitted the first line -- so do not restore it
              * citing that tester without asking him again.
              *
              * The fact itself is not lost: it is on the send button's title,
              * where it costs no space in the box.
              */}
          <div className="lc-composer__controls">
            <div className="lc-composer__group">
              {/*
                * The `+`, back as the real thing.
                *
                * It was removed in the 0906 design review because it was a
                * permanently disabled control titled "not built yet" on the
                * most-visited surface in the app -- "a dead plus costs more
                * than a missing one". It only returns now because attaching
                * actually works: the picker is limited to the workspace and
                * the chosen paths are named in the message, which every
                * runtime can act on (docs/ATTACHMENTS-INTAKE-2026-09-08.md).
                */}
              {/*
                * The + is libraries.dev's gooey plus menu since the metal
                * composer (PlusMenu.tsx): Attach files, and Choose a folder,
                * which left the row with it.
                */}
              <PlusMenu
                disabled={running || attaching}
                folderMissing={workspacePath === undefined}
                onAttach={attachFiles}
                onChooseFolder={onChooseFolder}
              />
              <span className="lc-control__anchor" ref={modeAnchor}>
                {modeOpen && (
                  <div className="lc-menu" role="menu" aria-label="Permission mode">
                    {MODES.map((option) => {
                      const unavailable = modeUnavailableReason(option.mode, route.runtime, platform)
                      return (
                        <button
                          key={option.mode}
                          type="button"
                          role="menuitemradio"
                          aria-checked={mode === option.mode}
                          className="lc-menu__item"
                          disabled={unavailable !== undefined}
                          title={unavailable}
                          onClick={() => {
                            // Choosing Auto is what turns it on. Settings shows
                            // the same state and takes it back; this is that
                            // decision made where it is needed, rather than a
                            // trip to another screen before the mode works.
                            if (option.mode === 'auto' && autoMode !== true) onEnableAutoMode?.()
                            onModeChange(option.mode)
                            setModeOpen(false)
                          }}
                        >
                          <span className="lc-menu__text">
                            <span className="lc-menu__name">{option.name}</span>
                            <span
                              className={`lc-menu__desc${unavailable === undefined && option.mode === 'auto' ? ' lc-tone-amber' : ''}`}
                            >
                              {unavailable ?? option.consequence}
                            </span>
                          </span>
                          {mode === option.mode && <Icon name="check" size={13} />}
                        </button>
                      )
                    })}
                    {/*
                      * Say when a mode has taken the person's connectors away.
                      *
                      * `--restricted` is what keeps a person's own Claude Code
                      * settings out of a mission, and Auto is the one mode that
                      * drops it -- it cannot be combined with
                      * `bypassPermissions`. So in every other mode the MCP
                      * servers are never loaded, and the run then also denies
                      * `mcp__*` outright.
                      *
                      * Nothing said so. Colin asked a teammate in Accept edits
                      * to check Robinhood twice on 2026-09-09; it answered,
                      * correctly and unhelpfully, that it had no connection --
                      * and the only way to learn why was to read the launcher.
                      * A refusal a person cannot act on is the app's fault, not
                      * the model's.
                      *
                      * Claude Code only, because it is the only runtime whose
                      * command builder touches MCP at all. Said whatever the
                      * settings hold: an account connector from claude.ai never
                      * appears in `~/.claude.json`, so counting configured
                      * servers would have hidden this in exactly the case that
                      * raised it.
                      */}
                    {connectorsNote(route.runtime, mode, hasConnectors) !== undefined && (
                      <p className="lc-menu__foot">{connectorsNote(route.runtime, mode, hasConnectors)}</p>
                    )}
                  </div>
                )}
                {/* The permission mode is the most consequential control on
                  * the bar, and read as a label (design review, 2026-09-05).
                  * Boxed like the route and effort chips, with a chevron. */}
                <button
                  type="button"
                  className="lc-control lc-control--boxed"
                  aria-haspopup="menu"
                  aria-expanded={modeOpen}
                  aria-label="Permission mode"
                  title={connectorsNote(route.runtime, effectiveMode, hasConnectors) ?? 'Permission mode'}
                  disabled={running}
                  onClick={() => setModeOpen(!modeOpen)}
                >
                  {MODES.find((option) => option.mode === effectiveMode)?.chip ?? 'Ask'}
                  <ChevronGlyph />
                </button>
              </span>
              {/*
                * NO SWARM BUTTON ON THE ROW, since the metal composer.
                *
                * Colin put it back once (2026-09-07: "its a good indicator ...
                * it just looks cool, its our logo"), and let it go on
                * 2026-09-23: "its going to cause a cache reread for most
                * models, and is very very niche. we can leave it as a
                * command maybe?" So it is `/swarm` and Settings, and while
                * it is on, the effort chip it holds wears the mark.
                */}
              {/*
                * Which folder this message runs in. Stated on the bar that
                * says what the message will do, because it is the same kind
                * of fact as the mode and the model -- and because an app
                * launched from the Start menu had no folder at all and no
                * surface said so (Colin, 2026-09-05).
                *
                * The metal composer (2026-09-23) kept it on the row only when
                * there was none -- the chosen folder's name in the title bar,
                * choosing another on the + menu. BACK ON THE ROW (0.306),
                * Colin: "our workspace folder asset is gone ... we just can
                * use what we used to have until we find a better idea".
                */}
              <button
                type="button"
                className={`lc-control lc-control--folder${workspacePath === undefined ? ' is-missing' : ''}`}
                disabled={running}
                title={
                  workspacePath === undefined
                    ? 'No folder chosen. Every teammate works inside one project folder.'
                    : workspaceMade
                      ? `Teammates work in ${workspacePath}. Locust made this folder; pick any other to work there instead.`
                      : `Teammates work in ${workspacePath}`
                }
                onClick={onChooseFolder}
              >
                <Icon name="folder" size={13} />
                <span className="lc-control__folder">{workspaceName ?? 'No folder'}</span>
              </button>
            </div>
            <div className="lc-composer__group">
              {context !== undefined ? (
                <span className="lc-composer__context">
                  <ContextRing reading={context} {...(conversationCost === undefined ? {} : { conversationCost })} />
                </span>
              ) : null}
              <span className="lc-control__anchor" ref={pickerAnchor}>
                {pickerOpen && (
                  <RoutePicker
                    runtimes={runtimes}
                    limitedRuntimes={limitedRuntimes}
                    models={models}
                    resolvedModels={resolvedModels}
                    recentRoutes={recentRoutes}
                    active={running ? activeChoice : route}
                    onSelect={(choice) => {
                      setPickerOpen(false)
                      if (handoff !== 'available') {
                        onRouteChange(choice)
                        return
                      }
                      // Picking the route the run is already on would stop it
                      // and buy nothing, so it is not an action here.
                      if (choice.runtime === activeChoice.runtime) return
                      onHandOff(choice)
                    }}
                    onClose={() => setPickerOpen(false)}
                    {...(handoff === 'available'
                      ? {
                          notice:
                            'This mission is running. Choosing another runtime stops it, writes a checkpoint, and hands the work over — it cannot be undone.'
                        }
                      : {})}
                  />
                )}
                {/*
                  A running mission CAN change route now: the host stops it,
                  reconciles it, and briefs a continuation. Only an in-flight
                  handoff locks this control, because a second switch would
                  race the first.
                */}
                <button
                  ref={routeChip}
                  type="button"
                  className={`lc-control lc-control--boxed${usagePressing ? ' is-pressing' : ''}`}
                  /*
                   * Hover said "OpenCode / account-default" while the chip
                   * itself read "No runtime" -- the label was fixed in pass 2
                   * and the tooltip was not (outside tester, 0.164.0). What
                   * the mouse says and what the eye reads are now one thing.
                   */
                  title={[
                    nothingConnected ? 'No runtime on this machine can run a mission yet.' : exactRoute,
                    handoffTitle(handoff),
                    usageSentence
                  ]
                    .filter((part) => part !== undefined && part.length > 0)
                    .join('\n')}
                  onClick={() => {
                    onOpenRoutePicker()
                    setPickerOpen(!pickerOpen)
                  }}
                  disabled={handoff === 'starting' || handoff === 'switching'}
                  aria-haspopup="listbox"
                  aria-expanded={pickerOpen}
                >
                  <span className={`lc-dot ${selectedReady ? 'lc-tone-lime' : 'lc-tone-muted'}`} />
                  {/*
                    * With NOTHING connected, this chip names no route.
                    *
                    * Grok's beta drive, 2026-09-14, finding 6: on a machine
                    * with every coding CLI off PATH, the footer said "0
                    * runtimes connected", the banner said to install one, the
                    * send button was disabled, the placeholder said "Install
                    * a coding agent..." -- and this chip said `OpenCode /
                    * Account Default`. First contact, and the one control on
                    * the screen that cannot work was the one claiming a route
                    * was already chosen.
                    *
                    * The muted dot was carrying that distinction alone, which
                    * is far too much weight for a 6px circle beside two
                    * confident words. The picker still opens, because that is
                    * where a person goes to see what could be installed.
                    */}
                  {nothingConnected ? (
                    <span className="lc-control__model">No runtime</span>
                  ) : (
                    <>
                      {runtimeLabel}
                      <span className="lc-separator">/</span>
                      <span className="lc-control__mono lc-control__model">{modelName}</span>
                      {freeModel && <span className="lc-control__free">Free</span>}
                    </>
                  )}
                  {/*
                    * The chevron the mode chip beside it has, and that the
                    * reference draws on this one too: `Codex CLI / gpt-5.6 ·
                    * high ⌄`. Without it nothing said the chip opens
                    * anything, and effort now lives behind it -- so a person
                    * looking for effort had no reason to press here. Colin,
                    * on the reference: "allows the user to see effort and
                    * still has dropdown for it."
                    */}
                  <ChevronGlyph />
                </button>
              </span>
              {/*
                * Effort, as its own control again.
                *
                * The design review folded it onto the route chip; that made
                * it invisible until chosen and it vanished entirely whenever
                * a model was picked, because choosing a model cleared it.
                * Colin, 2026-09-07: "just go back to effort being separate,
                * completely remove it from the model page". So: a chip that
                * always states a real level, beside the model it belongs to,
                * reading `gpt-5.6` `medium` the way the reference image does.
                *
                * Absent only when the model reports no levels -- there is
                * nothing to choose then, and a control that says so would be
                * the dead chip this replaced.
                */}
              {/*
                * A model with no levels never draws the pickable chip, even if
                * an effort is still set from a previous route. It used to draw
                * one showing that stale level with an empty menu behind it, so
                * there was no way to clear it -- Colin, 2026-09-08: "it has an
                * effort set and wont let me switch out of it". `startRoute`
                * refuses to send it either way; this stops the app offering a
                * choice that does not exist.
                */}
              {shownEffort !== undefined && supportedEfforts.length > 0 && (
                <span className="lc-control__anchor" ref={effortAnchor}>
                  {effortOpen && (
                    /*
                      * A SLIDER and a switch, not a list.
                      *
                      * Cursor lists eight levels and a menu of eight rows ran
                      * off the window (Colin, 2026-09-08, with a screenshot).
                      * His fix, and the right one: "you could just use claudes
                      * since you already have access to it, and then if there
                      * is a fast option just have a toggle for it." Those eight
                      * are not eight things -- they are four, each with a
                      * faster variant. The stops are whatever THIS model
                      * listed, in the order it listed them, so right is more.
                      */
                    <div className="lc-menu lc-menu--right lc-effortpanel" role="group" aria-label="Reasoning effort">
                      <EffortSlider
                        bases={effortBases}
                        index={effortIndex}
                        fast={effortIsFast}
                        hasFast={effortHasFast}
                        footer={effortFooter(route.runtime)}
                        onPick={(base) => {
                          const level = joinEffort(base, effortIsFast, supportedEfforts)
                          if (level !== undefined) onEffortChange(level)
                        }}
                        onFast={(next) => {
                          const level = joinEffort(effortBase, next, supportedEfforts)
                          if (level !== undefined) onEffortChange(level)
                        }}
                      />
                    </div>
                  )}
                  <button
                    ref={effortChip}
                    type="button"
                    className="lc-control lc-control--boxed"
                    aria-haspopup="menu"
                    aria-expanded={effortOpen}
                    aria-label="Reasoning effort"
                    title={
                      swarm
                        ? `Swarm is holding this at ${swarmEffort ?? 'the model maximum'}`
                        : 'How hard the model thinks'
                    }
                    disabled={running || swarm}
                    onClick={() => setEffortOpen(!effortOpen)}
                  >
                    {swarm && <img className="lc-control__swarmmark" src={mark} alt="" aria-hidden="true" />}
                    {/* The level in words, as the panel says it: "High", "High · Fast". */}
                    <span className="lc-control__effort">
                      {effortName(effortBase)}
                      {effortIsFast ? ' · Fast' : ''}
                    </span>
                    <ChevronGlyph />
                  </button>
                </span>
              )}
              {/*
                * A model with no levels to choose says so, rather than leaving
                * a gap where the chip was. Taken from Colin's reference image
                * (2026-09-07), which reads `effort - fixed`.
                *
                * Not a disabled control: there is nothing here to press, so it
                * is a label. A DISABLED chip would be the dead plus this
                * composer already removed once -- something that looks like it
                * should work and never does. This one just states a fact about
                * the runtime, which is the same fact the route chip beside it
                * is there to give.
                */}
              {effortIsGenuinelyFixed && (
                <span
                  className="lc-control lc-control--boxed is-static"
                  title="This runtime does not let the effort be chosen; it uses its own."
                >
                  <span className="lc-control__effort">Fixed</span>
                </span>
              )}
              {running && !canQueue ? (
                // A mono beam travels the stop button while the run goes --
                // Colin: "a loading hue for their stop button ... make it mono
                // instead to make it subtle". It stops with the stopping.
                // Colin, 2026-09-23: "slightly raise the intensity for the current
                // mono beam, its not too visible rn" -- full strength here, and
                // the layers lifted in shell.css (.lc-stopbeam).
                <Beam size="sm" strength={1} active={!cancelling} className="lc-stopbeam">
                  <button
                    type="button"
                    className="send-button lc-send is-stop"
                    onClick={onCancel}
                    disabled={cancelling}
                    aria-label="Stop the running mission"
                  >
                    {/* A small rounded square, as drawn -- not a pause icon. */}
                    <span className="lc-stopsquare" />
                  </button>
                </Beam>
              ) : canQueue ? (
                // Typed text turns the control into "queue this", so the stop
                // button is still one click away with an empty box. What the
                // button does is what the placeholder just promised.
                <button
                  type="submit"
                  className="send-button lc-send is-queue"
                  aria-label="Send this when the mission finishes"
                  title="Send this when the mission finishes"
                >
                  <ArrowUpGlyph />
                </button>
              ) : (
                /*
                 * ONE send control, which grows a label when it is about to
                 * do more than send.
                 *
                 * The drawing gives the multi-teammate case a button reading
                 */
                /*
                 * METAL, AND ONLY ON THIS ONE.
                 *
                 * The design agent's answer to "use it more widely" is no, and
                 * the reason is worth keeping next to the one place it is used:
                 * three metal buttons in a view and metal stops meaning
                 * anything — it becomes the button style, which is decoration.
                 * This button earns it by being the only control in the app
                 * that is purely an invitation rather than a state.
                 *
                 * And two of the candidates are worse than redundant: `Deny` is
                 * destructive and `Approve once` is consequential. Making
                 * either delightful to hover is the wrong nudge on a card whose
                 * whole job is to slow a person down.
                 *
                 * The stop and queue variants above stay plain for the same
                 * reason: one is a state, the other is a deferral.
                 */
                <MetalSend
                  /*
                   * As the page's composer draws it: a rim of light along the
                   * ring's top inside edge, and the metal cast onto the chip
                   * beside it (there the Auto chip; here whichever sits next
                   * to the send -- the effort chip, or the route when a model
                   * has no effort to choose).
                   */
                  innerShadow
                  reflectionTargets={reflectOnto}
                  {...(metal === undefined ? {} : { preset: metal })}
                  {...(metalStrength === undefined ? {} : { strength: metalStrength })}
                  {...(metalMotion === undefined ? {} : { motion: metalMotion })}
                  {...(metalBend === undefined ? {} : { bend: metalBend })}
                  type="submit"
                  className="send-button lc-send"
                  disabled={!canStart}
                  aria-label="Start mission"
                  /*
                    * A disabled control says why. Sol's beta finding 6: with
                    * nothing installed, Send was grey and its only word about
                    * itself was the thing it would not do.
                    */
                  title={
                    sendBlockedReason({
                      nothingInstalled: nothingConnected,
                      runtimeReady: selectedReady,
                      routeCanRun,
                      busy: busyWith !== undefined,
                      empty: value.trim().length === 0
                    }) ?? 'Start mission — Shift+Enter for a new line'
                  }
                >
                  <ArrowUpGlyph />
                </MetalSend>
              )}
            </div>
          </div>
          </div>
        </form>
      </div>
    </div>
  )
}
