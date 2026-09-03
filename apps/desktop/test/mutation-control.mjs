// Mutation control for the renderer's status derivations and the approval layer.
//
// These functions decide whether the shell may call a runtime live, whether a
// teammate reads as blocked, and whether a receipt prints `verified`. The
// product's entire claim is that those words are trustworthy, so a green suite
// over them is not enough -- each invariant must be shown to fail when broken.
//
//   node test/mutation-control.mjs
//
// Breaks one behaviour at a time, requires the NAMED test to fail, rejects any
// mutation that stops the file running, and restores every file it touches.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const STATUS = join(ROOT, 'src', 'renderer', 'src', 'status.ts')
const APPROVALS = join(ROOT, 'src', 'main', 'app-server-mission.ts')
const HANDOFF = join(ROOT, 'src', 'main', 'handoff.ts')
const MISSIONS = join(ROOT, 'src', 'main', 'codex-mission.ts')
const PEERS = join(ROOT, 'src', 'main', 'peer-exchange.ts')
const BRIEFING = join(ROOT, 'src', 'main', 'workroom-briefing.ts')
const SHARE = join(ROOT, 'src', 'shared', 'peer-share.ts')
const VIEW = join(ROOT, 'src', 'renderer', 'src', 'missionView.ts')
const TEAMMATES = join(ROOT, 'src', 'main', 'teammate-store.ts')
const CATALOG = join(ROOT, 'src', 'main', 'model-catalog.ts')
const HISTORY = join(ROOT, 'src', 'main', 'mission-history.ts')
const RUNTIMES = join(ROOT, 'src', 'shared', 'runtimes.ts')
const ROSTER = join(ROOT, 'src', 'main', 'teammate-store.ts')
const UPDATES = join(ROOT, 'src', 'main', 'updates.ts')
const RELAY = join(ROOT, 'src', 'main', 'relay.ts')
const FACES = join(ROOT, 'src', 'renderer', 'src', 'faceState.ts')
const ANTIGRAVITY = join(ROOT, 'src', 'main', 'antigravity-mission.ts')
const COST = join(ROOT, 'src', 'renderer', 'src', 'cost.ts')
const AGENT_TEXT = join(ROOT, 'src', 'renderer', 'src', 'agentText.ts')
const CATALOG_MODELS = join(ROOT, 'src', 'main', 'model-catalog.ts')

const MUTATIONS = [
  {
    file: STATUS,
    name: 'a roster card prints read-only for every teammate again',
    from: "  if (mode === 'accept-edits') return 'accept edits'",
    to: "  if (mode === 'accept-edits') return 'ask · read-only'",
    expect: 'names the mode the teammate actually last ran in'
  },
  {
    file: VIEW,
    name: 'a run in trouble stays hidden until a tool has run, so a retrying mission looks frozen',
    from: '        if (!workBegan && !/\\.runtime_error$/.test(event.payload.code)) break',
    to: '        if (!workBegan) break',
    expect: 'shows a run in trouble even before any tool has run'
  },
  {
    file: VIEW,
    name: 'a mission from another day is labelled with a bare time',
    from: '  if (sameDay) return time',
    to: '  if (true) return time',
    expect: 'carries the date once the mission is not from today'
  },
  {
    file: VIEW,
    name: 'a target that only arrives with the completion never reaches the row',
    from: "              ...(event.payload.command === undefined || open.name !== open.tool",
    to: "              ...(true || event.payload.command === undefined || open.name !== open.tool",
    expect: 'takes the target from the completion when the start had none'
  },
  {
    file: AGENT_TEXT,
    name: 'an unterminated fence is dropped instead of drawn as code still arriving',
    from: '  if (open !== undefined) {',
    to: '  if (false) {',
    expect: 'treats an unclosed fence as code still being written, not as prose'
  },
  {
    file: AGENT_TEXT,
    name: 'a closing fence is accepted even when it carries a language, swallowing the block after it',
    from: "    if (fence !== null && fence[2]!.trim().length === 0 && fence[1]!.length >= open.ticks.length) {",
    to: '    if (fence !== null) {',
    expect: 'keeps a longer fence inside a shorter one as code'
  },
  {
    file: STATUS,
    name: 'a refused send is filed in the mission list as though it were a mission',
    from: '  return run.missionId !== undefined || run.active',
    to: '  return true',
    expect: 'drops a refused send, which settled without ever being given a mission id'
  },
  {
    file: VIEW,
    name: 'a failure card drops the runtime own-stderr line and shows only the host sentence',
    from: '  if (said === undefined) return payload.message',
    to: '  if (said !== undefined) return payload.message',
    expect: "shows the runtime's own last word, because the host's sentence names only the shape"
  },
  {
    file: MISSIONS,
    name: 'a follow-up is only linked when the earlier turn left a session to resume',
    from: '              ? resumedMissionId === undefined',
    to: '              ? resumedMissionId === undefined || resumeThreadId === undefined',
    expect: 'continues a conversation whose earlier turn recorded no session, cold rather than not at all'
  },
  {
    file: UPDATES,
    name: 'install goes back to quitAndInstall, which the shutdown handler cancels',
    from: '      options.requestQuit()\n      return { ok: true, data: state }',
    to: '      options.updater.quitAndInstall(false, true)\n      return { ok: true, data: state }',
    expect: 'installs by asking the app to quit, so the shutdown flush runs first and the updater installs on the real quit'
  },
  {
    file: VIEW,
    name: 'a multi-file edit is counted as one file',
    from: "    .reduce((sum, detail) => sum + Math.max(1, detail.name.split('\\n').filter((line) => line.length > 0).length), 0)",
    to: '    .length',
    expect: 'counts files, not edit calls: one Codex file_change can name several'
  },
  {
    file: COST,
    name: 'a receipt that reported no cost is shown as free',
    from: "  return Object.keys(cost).length === 0 ? undefined : cost",
    to: "  return cost",
    expect: 'says nothing when the receipt carries nothing, rather than zero'
  },
  {
    file: COST,
    name: 'a dollar figure the runtime priced is dropped for a token count',
    from: "  if (cost.usd !== undefined) return cost.usd === 0 ? '$0.00' : cost.usd < 0.01 ? '< $0.01' : `$${cost.usd.toFixed(2)}`",
    to: "",
    expect: 'prefers dollars, then premium requests, then tokens'
  },
  {
    file: ANTIGRAVITY,
    name: "the agent's final answer never ends the watch",
    from: '      if (run.normalizer.latestFinal) {',
    to: '      if (false) {',
    expect: 'opens the conversation with the project id, records the mission, and follows the transcript to the final answer'
  },
  {
    file: ANTIGRAVITY,
    name: "a follow-up replays the earlier turns as its own work",
    from: "          fed = existing === undefined ? 0 : existing.split('\\n').filter((line) => line.trim().length > 0).length",
    to: '          fed = 0',
    expect: 'a follow-up sends into the same conversation and reads only the lines after the earlier turns'
  },
  {
    file: ANTIGRAVITY,
    name: 'a folder Antigravity has not opened is started anyway',
    from: '        if (projectId === undefined) {',
    to: '        if (false) {',
    expect: 'refuses, naming the folder, when Antigravity has not opened the workspace'
  },
  {
    file: ANTIGRAVITY,
    name: 'a mission starts with Antigravity closed',
    from: '        if (host === undefined) {\n          throw new AntigravityStartError',
    to: '        if (false) {\n          throw new AntigravityStartError',
    expect: 'refuses, recording nothing, when Antigravity is not open'
  },
  {
    file: RELAY,
    name: "the asker's turn starts on the first reply instead of waiting for everyone",
    from: '          if (meeting.awaiting.size > 0) {\n            notify(',
    to: '          if (false) {\n            notify(',
    expect: "holds the first reply, and starts the asker's turn once after the last, briefed with everyone"
  },
  {
    file: RELAY,
    name: 'a single recipient opens a meeting',
    from: '      if (started.length >= 2) {',
    to: '      if (started.length >= 1) {',
    expect: 'one recipient is an ordinary exchange, not a meeting'
  },
  {
    file: FACES,
    name: 'an idle face moves',
    from: "  idle: {}\n}",
    to: "  idle: { chip: 'lcBob 2.8s ease-in-out infinite' }\n}",
    expect: 'idle and blocked are the only motionless states, and every other state moves'
  },
  {
    file: FACES,
    name: 'a reasoning step is drawn as working',
    from: "  if (reasoning) return 'thinking'",
    to: "  if (reasoning) return 'working'",
    expect: 'thinks during an open reasoning step'
  },
  {
    file: FACES,
    name: 'waiting on you falls through to the live state or to still',
    from: "  if (input.waitingOnYou) return 'waiting'\n",
    to: '',
    expect: 'waiting on you never resolves to still, and outranks live work'
  },
  {
    file: RELAY,
    name: "a teammate replies on the sender's route instead of their own",
    from: '    const own = recipient.self.route',
    to: '    const own = undefined',
    expect: "starts the recipient's run on the recipient's OWN route, owned by the recipient"
  },
  {
    file: RELAY,
    name: 'teammates reply on their own even when the setting is off',
    from: "  if (!input.enabled) {\n    return { start: false, reason: 'Teammate replies are switched off in Settings; the message waits for their next run.' }\n  }\n",
    to: '',
    expect: 'starts nothing when off, and stays quiet about it'
  },
  {
    file: RELAY,
    name: 'the hop cap lets one extra hop through',
    from: '  if (input.hop >= MAX_RELAY_HOPS) {',
    to: '  if (input.hop > MAX_RELAY_HOPS) {',
    expect: 'stops after the cap and says so in the thread that shared'
  },
  {
    file: RELAY,
    name: 'the reply back starts a stranger instead of the next turn of the thread that asked',
    from: '    const followUpOf = input.origin.lastMissionOf[recipient.self.teammateId]',
    to: '    const followUpOf = undefined',
    expect: 'the reply back follows up the mission that asked, so it lands in that thread'
  },
  {
    file: RELAY,
    name: 'a relayed run runs with write access whatever the sender had',
    from: "      mode: from.sandbox === 'workspace-write' ? ('accept-edits' as const) : ('ask' as const)",
    to: "      mode: 'accept-edits' as const",
    expect: 'a read-only sender gets a read-only reply when the recipient has no route'
  },
  {
    file: VIEW,
    name: 'the activity total is taken from the runtime header instead of the rows',
    from: '    if (entry.kind !== \'file\') continue\n    added += entry.counts.added\n    removed += entry.counts.removed',
    to: '    if (entry.kind !== \'file\') continue\n    added += entry.reported?.added ?? entry.counts.added\n    removed += entry.reported?.removed ?? entry.counts.removed',
    expect: 'sums the card total from the rows it will actually draw'
  },
  {
    file: VIEW,
    name: 'an edit with no recorded patch is dropped from the list',
    from: '      entries.push({\n        kind: detail.kind === \'edit\' ? \'unreported\' : \'tool\',',
    to: '      if (detail.kind === \'edit\') return\n      entries.push({\n        kind: \'tool\',',
    expect: 'keeps an edit whose runtime reported no patch, as a row that says so'
  },
  {
    file: VIEW,
    name: 'a large file still opens by default and buries the rest',
    from: '  return first.large ? undefined : first.key',
    to: '  return first.key',
    expect: 'opens the first file, unless opening it would bury everything after it'
  },
  {
    file: VIEW,
    name: 'the completion patch never reaches the activity row',
    from: '              ...(patch === undefined ? {} : { patch, kind: \'edit\' }),\n',
    to: '',
    expect: 'attaches a completion patch to the tool that opened, and names the runtime that reported it'
  },
  {
    file: STATUS,
    name: 'a read-only Cursor mode is offered where nothing can enforce it',
    from: "  if (mode === 'ask' && runtime === 'cursor' && platform === 'win32') return false",
    to: '  void platform',
    expect: 'does not offer Cursor a read-only mode on Windows, where nothing enforces it'
  },
  {
    file: STATUS,
    name: 'a read-only Cursor mode is refused even where the sandbox is real',
    from: "  if (mode === 'ask' && runtime === 'cursor' && platform === 'win32') return false",
    to: "  if (mode === 'ask' && runtime === 'cursor') return false",
    expect: 'offers it where the sandbox exists'
  },
  {
    file: STATUS,
    name: 'the search field filters nothing, as it did when it was inert',
    from: '  if (needle.length === 0) return rows',
    to: '  return rows; if (needle.length === 0) return rows',
    expect: 'matches the words a person can see, whatever the case'
  },
  {
    file: STATUS,
    name: 'a search that matches nothing shows everything',
    from: '  return rows.filter((row) =>',
    to: '  return rows.length > 0 ? rows : rows.filter((row) =>',
    expect: 'shows nothing when nothing matches, rather than everything'
  },
  {
    file: STATUS,
    name: 'the curated shortlist outranks what this person actually ran',
    from: '    if (used !== undefined) return used',
    to: '    if (used !== undefined) return 3_000_000 + used',
    expect: 'still puts what this person ran above the curated list'
  },
  {
    file: STATUS,
    name: 'the curated shortlist does nothing at all',
    from: '    return flagship === undefined ? 2_000_000 : 1_000_000 + flagship',
    to: '    void flagship; return 2_000_000',
    expect: 'puts the flagship families above the rest when nothing has been run'
  },
  {
    file: VIEW,
    name: 'the picker forgets the order routes were last run in',
    from: '    .sort((left, right) => right[1] - left[1])',
    to: '    .sort((left, right) => left[1] - right[1])',
    expect: 'lists each route once, newest first'
  },
  {
    file: STATUS,
    name: 'a mode the route cannot run is still offered',
    from: "  if (mode === 'approve-each') return runtime === 'codex'",
    to: "  if (mode === 'approve-each') return true",
    expect: 'keeps per-action approvals to the runtime that can stop and ask'
  },
  {
    file: STATUS,
    name: 'the picker forgets what this person has actually run',
    from: '    const used = rank.get(row.key)',
    to: '    const used = undefined',
    expect: 'puts what this person has run first, newest first, inside its own runtime'
  },
  {
    file: STATUS,
    name: 'ordering moves rows out of their own runtime',
    from: '    const byGroup = groups.indexOf(left.group) - groups.indexOf(right.group)',
    to: '    const byGroup = 0',
    expect: 'never moves a row out of its runtime'
  },
  {
    file: CATALOG_MODELS,
    name: 'every effort Cursor lists is offered as its own model again',
    from: '    if (effort === undefined) {',
    to: '    if (true) {',
    expect: 'collapses the efforts Cursor lists as separate models into one model with efforts'
  },
  {
    file: CATALOG_MODELS,
    name: 'an id is split on the shortest effort suffix, losing the rest',
    from: "  'xhigh-fast',\n  'high-fast',\n  'medium-fast',\n  'low-fast',\n",
    to: '',
    expect: 'splits an id into the model and the effort, longest suffix first'
  },
  {
    file: UPDATES,
    name: 'an update installs itself while a mission is running',
    from: '      if (options.liveMissionCount() > 0) {',
    to: '      if (false) {',
    expect: 'refuses to install while a mission is running, and says why'
  },
  {
    file: UPDATES,
    name: 'auto-install at quit is switched back off, so the install never runs',
    from: '    options.updater.autoInstallOnAppQuit = true',
    to: '    options.updater.autoInstallOnAppQuit = false',
    expect: 'downloads on its own, and installs only on a quit the app itself makes'
  },
  {
    file: UPDATES,
    name: 'a check that could not run reports the app as up to date',
    from: "            phase: 'failed',\n            currentVersion: options.currentVersion,\n            message: 'The update check could not complete.'",
    to: "            phase: 'current',\n            currentVersion: options.currentVersion",
    expect: 'says up to date only after a check that finished'
  },
  {
    file: UPDATES,
    name: 'a build that cannot update itself reports itself up to date',
    from: '      if (!options.supported) {',
    to: '      if (false) {',
    expect: 'says a build that cannot update itself cannot, rather than that it is current'
  },
  {
    file: MISSIONS,
    name: 'a command that cannot be built still writes a mission file first',
    from: '        } catch {\n          return error(\n            \'RUNTIME_START_FAILED\',',
    to: '        } catch {\n          command = createCodexExecCommand(chosen.executable, { workspacePath: options.workspacePath })\n        }\n        if (false) {\n          return error(\n            \'RUNTIME_START_FAILED\',',
    expect: 'records nothing when the chosen options cannot be turned into a command'
  },
  {
    file: VIEW,
    name: 'a reply is shown the opening line instead of the words typed for it',
    from: "    if (current.continuesFrom?.reason !== 'route-switch') return current.prompt",
    to: '    if (current.continuesFrom === undefined) return current.prompt',
    expect: 'shows a reply the words that were typed for it, not the opening line'
  },
  {
    file: VIEW,
    name: 'a handed-over mission shows its briefing as typed words',
    from: '    const prior = byId.get(current.continuesFrom.missionId)',
    to: '    const prior = undefined',
    expect: 'shows a handed-over mission the words a person typed, not the briefing written for it'
  },
  {
    file: STATUS,
    name: 'the active tag is drawn on a runtime that is not there',
    from: "  return isActive && status.selectable ? 'ACTIVE' : status.tag",
    to: "  return isActive ? 'ACTIVE' : status.tag",
    expect: 'does not put ACTIVE on a runtime that is not there'
  },
  {
    file: STATUS,
    name: 'a teammate with no work of their own reads as blocked',
    from: '  if (input.runtime !== undefined && !runtimeIsUsable(input.runtime)) {',
    to: '  if (input.runtime === undefined || !runtimeIsUsable(input.runtime)) {',
    expect: 'is idle, not blocked, when something could run'
  },
  {
    file: STATUS,
    name: 'a roster with nothing signed in still says everyone is idle',
    from: '  if (input.anyRuntimeUsable === false) {',
    to: '  if (false) {',
    expect: 'is blocked when nothing is signed in at all'
  },
  {
    file: ROSTER,
    name: 'mission assignments grow without bound, until the file empties itself',
    from: '        if (\n          file.missionOwners[missionId] === undefined\n          && Object.keys(file.missionOwners).length >= MAX_MISSION_OWNERS\n        ) {\n          throw new Error(\'Too many mission assignments\')\n        }\n',
    to: '',
    expect: 'refuses a new assignment past its cap, instead of growing until the file empties itself'
  },
  {
    file: ROSTER,
    name: 'the roster reads more assignments than it would ever write',
    from: '      if (Object.keys(owners).length >= MAX_MISSION_OWNERS) break',
    to: '      void owners',
    expect: 'reads no more assignments than it would write'
  },
  {
    file: MISSIONS,
    name: 'a read-only Cursor mission runs where nothing can hold it read-only',
    from: '          && !cursorCanEnforceReadOnly(hostPlatform)',
    to: '          && false',
    expect: 'refuses a read-only Cursor mission where its sandbox cannot run, rather than mislabelling it'
  },
  {
    file: VIEW,
    name: 'a run that never opened a session still claims one a reply can resume',
    from: "    if (typeof held === 'string' && held.length > 0) return held",
    to: "    return typeof held === 'string' ? held : 'thread-7'",
    expect: 'has nothing to resume when the run failed before its runtime started'
  },
  {
    file: STATUS,
    name: 'a prune preview counts the deletions and stays quiet about what it kept',
    from: "  return `Delete ${missions(preview.deleted.length)} for good${kept.length === 0 ? '' : `, with ${kept.join(' and ')}`}.`",
    to: '  return `Delete ${missions(preview.deleted.length)} for good.`',
    expect: 'states the count that would go, and names everything held back'
  },
  {
    file: STATUS,
    name: 'a prune that would do nothing does not say why',
    from: "    return because.length === 0\n      ? 'Nothing is old enough to delete.'\n      : `Nothing would be deleted: ${because.join(', and ')}.`",
    to: "    return 'Nothing is old enough to delete.'",
    expect: 'says why nothing would go, rather than just saying nothing'
  },
  {
    file: STATUS,
    name: 'a long picker group is truncated without saying so',
    from: '    hidden.set(row.group, (hidden.get(row.group) ?? 0) + 1)\n  }\n  return { rows: kept, hiddenByGroup: hidden }',
    to: '  }\n  return { rows: kept, hiddenByGroup: hidden }',
    expect: 'caps a long group and counts every row it is not showing'
  },
  {
    file: STATUS,
    name: 'the cap hides the route the person is actually on',
    from: "    if (row.tag === 'ACTIVE') {",
    to: '    if (false) {',
    expect: 'never hides the route you are on, and still shows the cap'
  },
  {
    file: STATUS,
    name: 'a search result is capped a second time, under the person',
    from: '  if (searching) return { rows, hiddenByGroup: new Map() }',
    to: '  void searching',
    expect: 'lifts the cap entirely once someone is searching'
  },
  {
    file: MISSIONS,
    name: 'a Cursor mission is launched as a Codex command',
    from: "            : runtime === 'cursor'\n              ? createCursorPrintCommand(executable, {\n                  workspacePath: options.workspacePath,\n                  sandbox: effectiveSandbox,\n                  ...choice\n                })\n",
    to: '',
    expect: 'runs a Cursor mission under its own command and its own normalizer'
  },
  {
    file: MISSIONS,
    name: "a Cursor mission's stream is read by the Codex normalizer",
    from: "          : runtime === 'cursor'\n            ? createCursorEventNormalizer(normalizerContext)\n",
    to: '',
    expect: 'runs a Cursor mission under its own command and its own normalizer'
  },
  {
    file: RUNTIMES,
    name: 'a runtime whose events the host cannot read is started anyway',
    from: "  return runtime === 'codex' || runtime === 'claude' || runtime === 'cursor' || runtime === 'opencode' || runtime === 'copilot'\n",
    to: '  return true\n',
    expect: 'refuses a runtime whose event stream it cannot read yet, by name, recording nothing'
  },
  {
    file: VIEW,
    name: 'a turn opening counts as work, so setup notices land in the thread',
    from: "        if (event.payload.stepKind !== 'turn') workBegan = true",
    to: '        workBegan = true',
    expect: 'keeps a notice raised before any work out of the thread, as setup talk'
  },
  {
    file: HISTORY,
    name: 'a live mission can be deleted out from under its own process',
    from: '  if (isLive(missionId)) {',
    to: '  if (false) {',
    expect: 'refuses to delete a mission that is still running, and names the remedy'
  },
  {
    file: MISSIONS,
    name: 'a reply starts a blank run instead of resuming the conversation',
    from: '            ...(resumeThreadId === undefined ? {} : { resumeThreadId })',
    to: '',
    expect: 'resumes the earlier mission’s own session, and records what it continued'
  },
  {
    file: MISSIONS,
    name: 'a reply crosses runtimes without a handoff',
    from: '          if (prior.metadata.runtime !== runtime) {',
    to: '          if (false) {',
    expect: 'refuses to continue another runtime’s conversation, and says which'
  },
  {
    file: VIEW,
    name: 'a handoff divider is drawn across an ordinary reply',
    from: "  if (link === undefined || link.reason !== 'route-switch') return undefined",
    to: '  if (link === undefined) return undefined',
    expect: 'draws no handoff divider across an ordinary reply'
  },
  {
    file: VIEW,
    name: 'a reply shows only itself, losing the conversation above it',
    from: "    if (link === undefined || link.reason !== 'follow-up') break",
    to: '    break',
    expect: 'walks a reply back to every earlier turn, oldest first'
  },
  {
    file: VIEW,
    name: 'an older mission overwrites the newest resolved model name',
    from: '    if (held === undefined || (Number.isFinite(at) && at > held.at)) {',
    to: '    if (true) {',
    expect: 'prefers the newest mission, so a new release replaces an old name'
  },
  {
    file: VIEW,
    name: 'the alias echoed back is shown as if it were a resolved name',
    from: "    if (typeof name !== 'string' || name.length === 0 || name === mission.model) continue",
    to: "    if (typeof name !== 'string' || name.length === 0) continue",
    expect: 'says nothing about an alias nobody has run, or one that taught it nothing'
  },
  {
    file: CATALOG,
    name: 'a signed-out Claude still offers its models',
    from: "  if (claude?.readiness !== 'ready' || hints === undefined) return []",
    to: '  if (hints === undefined) return []',
    expect: 'offers nothing for a Claude that is not ready, or that advertised nothing'
  },
  {
    file: CATALOG,
    name: 'a Codex failure hides the Claude models too',
    from: "      return advertisedModels.length > 0\n        ? { ok: true, data: { models: advertisedModels } }\n        : { ok: false, error: { code: 'MODELS_UNAVAILABLE', message: 'Codex CLI is not ready.' } }",
    to: "      return { ok: false, error: { code: 'MODELS_UNAVAILABLE', message: 'Codex CLI is not ready.' } }",
    expect: 'lists Claude models even when Codex cannot be read'
  },
  {
    file: APPROVALS,
    name: 'stopping one approve-each run kills every run',
    from: "    run.client?.dispose(why)\n    run.process?.kill()\n  }",
    to: "    run.client?.dispose(why)\n    for (const each of [...runs.values(), run]) each.process?.kill()\n  }",
    expect: 'stops one approve-each run by its id and leaves the other going'
  },
  {
    file: APPROVALS,
    name: 'stopping one approve-each run refuses every pending approval',
    from: '      if (pending.runId !== runId) continue\n',
    to: '',
    expect: 'answers only the stopped run’s approvals with a refusal'
  },
  {
    file: VIEW,
    name: 'the runtime’s setup talk lands in the thread',
    from: '        if (!workBegan && !/\\.runtime_error$/.test(event.payload.code)) break\n        items.push({',
    to: '        items.push({',
    expect: 'keeps a notice raised before any work out of the thread, as setup talk'
  },
  {
    file: TEAMMATES,
    name: 'an edit hands the teammate a new id, orphaning their missions',
    from: '          teammateId: existing.teammateId,\n          name: input.name.trim(),',
    to: "          teammateId: `tm_${randomUUID().replace(/-/g, '').slice(0, 24)}`,\n          name: input.name.trim(),",
    expect: 'changes name, hue, role and face while the id and its missions stay'
  },
  {
    file: VIEW,
    name: 'every running step is filed as action, so thought draws as work',
    from: "          kind: event.payload.stepKind\n        }",
    to: "          kind: 'turn'\n        }",
    expect: 'carries the step kind, so thought and action draw differently'
  },
  {
    file: STATUS,
    name: 'a teammate with no live run is drawn as working',
    from: "    live: input.hasRunningMission ? (input.liveActivity ?? 'working') : 'idle',",
    to: "    live: 'working',",
    expect: 'decides the face from the same inputs as the label, so the two agree'
  },
  {
    file: TEAMMATES,
    name: 'a face is seeded from the name, so a rename would change it',
    from: '          avatar: input.avatar ?? seedAvatar(teammateId),',
    to: '          avatar: input.avatar ?? seedAvatar(input.name.trim()),',
    expect: 'seeds a face from the id, never the name'
  },
  {
    file: TEAMMATES,
    name: 'a persisted face is thrown away on read',
    from: '    avatar: isAvatarSpec(record.avatar) ? record.avatar : seedAvatar(record.teammateId),',
    to: '    avatar: seedAvatar(record.teammateId),',
    expect: 'keeps a persisted face rather than re-seeding it, and seeds one for a record without'
  },
  {
    file: MISSIONS,
    name: 'a handoff waits for every live run, not its own',
    from: '      await settling.get(previous.runId)',
    to: '      await Promise.allSettled([...consumeOperations])',
    expect: 'hands off one teammate’s run without waiting for another teammate’s to finish'
  },
  {
    file: MISSIONS,
    name: 'a teammate may run two missions at once',
    from: '          starting.has(owner) || [...active.values()].some((mission) => ownerKeyOf(mission.peer) === owner)',
    to: '          false',
    expect: 'refuses a second live mission for the same teammate, by name'
  },
  {
    file: MISSIONS,
    name: 'the live-mission cap is never reached',
    from: '        if (starting.size + active.size >= MAX_LIVE_MISSIONS) {',
    to: '        if (starting.size + active.size >= 99) {',
    expect: 'caps how many missions can be live at once, and says the number'
  },
  {
    file: VIEW,
    name: 'a reopened continuation shows the briefing as what the person said',
    from: "    const priorId = current.continuesFrom?.missionId",
    to: "    const priorId = undefined",
    expect: 'shows the words the person typed, not the briefing the host wrote'
  },
  {
    file: VIEW,
    name: 'a reopened divider forgets what was left in doubt',
    from: "    unsettledCount: checkpoint?.unsettledActions.length ?? 0,",
    to: "    unsettledCount: 0,",
    expect: 'rebuilds the divider from the route-switch checkpoint it resumed from'
  },
  {
    file: APPROVALS,
    name: 'an approval-mode run is sent the bare prompt, never the briefing',
    from: "        input: [{ type: 'text', text: runtimePrompt }]",
    to: "        input: [{ type: 'text', text: prompt }]",
    expect: "briefs an approval-mode mission with its teammates' waiting messages"
  },
  {
    file: APPROVALS,
    name: 'an approval-mode run shares before it has completed',
    from: '    if (!wasComplete && run.transcript.completed && run.peer !== undefined && peerExchange !== undefined) {',
    to: '    if (run.peer !== undefined && peerExchange !== undefined) {',
    expect: 'shares from an approval-mode run once it completes, and not before'
  },
  {
    file: BRIEFING,
    name: 'a received message is quoted with its share tags intact',
    from: '  const body = sanitizeInbound(message.text).replace(/\\n/g, \'\\n  \')',
    to: '  const body = message.text.replace(/\\n/g, \'\\n  \')',
    expect: 'defangs a share tag inside a received message so it cannot be echoed as a share'
  },
  {
    file: BRIEFING,
    name: 'messages that do not fit are sent anyway',
    from: '  while (prompt.length > MAX_RUNTIME_PROMPT_LENGTH && delivered.length > 0) {',
    to: '  while (false) {',
    expect: 'leaves out messages that do not fit, from the newest end, and counts them as still waiting'
  },
  {
    file: BRIEFING,
    name: 'a teammate with nobody to share with is still told how',
    from: '  const trailer = input.peer.others.length > 0 ? rosterSection(input.peer) : undefined',
    to: '  const trailer = rosterSection(input.peer)',
    expect: 'lists the other teammates and the exact share form, and only when there is someone to share with'
  },
  {
    file: SHARE,
    name: 'an upper-case share tag in a received message is left armed',
    from: "  return text.replace(/<(\\/?)locust-share/gi, '‹$1locust-share')",
    to: "  return text.replace(/<(\\/?)locust-share/g, '‹$1locust-share')",
    expect: 'defangs an inbound share tag so a received message cannot be echoed as a share'
  },
  {
    file: SHARE,
    name: 'the bubble keeps its share blocks',
    from: "  return text.replace(BLOCK, '').replace(/\\n{3,}/g, '\\n\\n').trimEnd()",
    to: '  return text.trimEnd()',
    expect: 'removes the blocks from the transcript and leaves the prose'
  },
  {
    file: PEERS,
    name: 'a share addressed to a stranger goes to the first teammate instead',
    from: '        const target = peer.others.find((entry) => entry.name.toLowerCase() === block.to.toLowerCase())',
    to: '        const target = peer.others[0]',
    expect: 'refuses a share addressed to someone who is not on the roster, out loud'
  },
  {
    file: MISSIONS,
    name: 'a run that did not complete still shares',
    from: '    if (mission.transcript.completed && mission.peer !== undefined && peerExchange !== undefined) {',
    to: '    if (mission.peer !== undefined && peerExchange !== undefined) {',
    expect: 'shares nothing from a run that did not complete'
  },
  {
    file: MISSIONS,
    name: 'the runtime is sent the bare prompt, never the briefing',
    from: '          process = options.runner.start(command, runtimePrompt, { signal: controller.signal })',
    to: '          process = options.runner.start(command, prompt, { signal: controller.signal })',
    expect: 'quotes a waiting message into the prompt as a claim, records it, and marks it delivered only once the run is live'
  },
  {
    file: MISSIONS,
    name: 'the ledger records the briefing as what the person said',
    from: '            runId,\n            prompt,\n            runtime,',
    to: '            runId,\n            prompt: runtimePrompt,\n            runtime,',
    expect: "keeps the person's own words as the recorded prompt, not the briefing"
  },
  {
    file: MISSIONS,
    name: 'a mission runs on messages its ledger could not record',
    from: '            await peerExchange.recordReceived(missionId, delivered, createdAt)',
    to: '            await Promise.resolve()',
    expect: 'refuses to run on messages the ledger cannot record, and says so'
  },
  {
    file: VIEW,
    name: 'the agent bubble shows the share block too',
    from: '    const text = stripShareBlocks(message.text)',
    to: '    const text = message.text',
    expect: 'hides a share block from the agent bubble, keeping the prose'
  },
  {
    file: VIEW,
    name: 'a received exchange is filed as sent-only',
    from: "    if (message.direction === 'received') group.received = true\n",
    to: '',
    expect: 'groups an exchange by the other party and marks whether anything was received'
  },
  {
    file: STATUS,
    name: 'a stale ready flag alone is enough to call a runtime usable',
    from: '  return runtime.ready && runtime.status === \'ready\'',
    to: '  return runtime.ready',
    expect: 'never issues ACTIVE or READY for a runtime that is not ready'
  },
  {
    file: STATUS,
    name: 'a ready probe alone is enough, ignoring the readiness flag',
    from: '  return runtime.ready && runtime.status === \'ready\'',
    to: '  return runtime.status === \'ready\'',
    expect: 'never issues ACTIVE or READY for a runtime that is not ready'
  },
  {
    file: STATUS,
    name: 'a half-built adapter is advertised as ready',
    from: '      tag: \'PREVIEW\',',
    to: '      tag: \'READY\',',
    expect: 'never calls a half-built adapter live, even when its runtime is ready'
  },
  {
    file: STATUS,
    name: 'a planned runtime becomes selectable',
    from: '      tag: \'PLANNED\',\n      selectable: false,',
    to: '      tag: \'PLANNED\',\n      selectable: true,',
    expect: 'keeps a planned runtime non-interactive whatever discovery says'
  },
  {
    file: STATUS,
    name: 'every discovered runtime counts as connected',
    from: '  return runtimes.filter(runtimeIsUsable).length',
    to: '  return runtimes.length',
    expect: 'counts only usable runtimes as connected'
  },
  {
    file: STATUS,
    name: 'a blocked runtime is hidden behind an optimistic running mission',
    from: '  if (input.runtime !== undefined && !runtimeIsUsable(input.runtime)) {',
    to: '  if (false) {',
    expect: 'reports a blocked runtime even while a mission looks like it is running'
  },
  {
    file: STATUS,
    name: 'a completed mission prints clean over an unreadable ledger',
    from: '  if (hasIntegrityIssues) {',
    to: '  if (false) {',
    expect: 'will not present a completed mission as clean when its ledger is not'
  },
  {
    file: STATUS,
    name: 'the receipt says verified regardless of integrity issues',
    from: '  return integrityIssueCount === 0 ? \'verified\' : \'incomplete\'',
    to: '  return \'verified\'',
    expect: 'will not present a completed mission as clean when its ledger is not'
  },
  {
    file: APPROVALS,
    name: 'an unrecognized approval request is approved rather than refused',
    from: "            return { decision: 'reject' }",
    to: "            return { decision: 'accept' }",
    expect: 'refuses a request it does not understand rather than guessing'
  },
  {
    file: APPROVALS,
    name: 'always-allow becomes a durable grant instead of a session one',
    from: "  if (decision === 'approve-always') return 'acceptForSession'",
    to: "  if (decision === 'approve-always') return 'acceptForever'",
    expect: 'maps the product answers onto the protocol'
  },
  {
    file: APPROVALS,
    name: 'a dead runtime leaves approvals pending forever',
    from: "        child.onExit(() => {\n          stop(run, 'transport-lost', 'The runtime exited.')\n        })",
    to: "        child.onExit(() => {\n          runs.delete(run.runId)\n        })",
    expect: 'releases a pending approval when the runtime dies'
  },
  {
    file: APPROVALS,
    name: 'an already-answered approval can be answered again',
    from: '      if (pending === undefined) return false',
    to: '      if (pending === undefined) return true',
    expect: 'ignores a decision for an unknown or already-answered approval'
  },
  {
    file: APPROVALS,
    name: 'an undescribed command is presented as an ordinary one',
    from: "      summary: command.length > 0 ? 'Run a command' : 'Run a command it did not describe',",
    to: "      summary: 'Run a command',",
    expect: 'says so plainly when the runtime described nothing'
  },
  {
    file: STATUS,
    name: 'the control offers a handoff before the mission has a runId',
    from: "  return hasRunId ? 'available' : 'starting'",
    to: "  return 'available'",
    expect: 'offers a handoff only once the mission has a runId to address'
  },
  {
    file: STATUS,
    name: 'a second switch may race one already in flight',
    from: "  if (switching) return 'switching'",
    to: '',
    expect: 'refuses a second switch while one is in flight'
  },
  {
    file: STATUS,
    name: 'a finished mission still offers a handoff',
    from: "  if (!running) return 'idle'",
    to: '',
    expect: 'offers nothing when no mission is running'
  },
  {
    file: STATUS,
    name: 'a control that cannot do its job stays silent about why',
    from: "  if (availability === 'starting') return 'Waiting for the mission to start before it can be handed over'",
    to: '',
    expect: 'says why whenever the control cannot do its job'
  },
  {
    file: HANDOFF,
    name: 'the briefing tells the next runtime an unsettled action is done',
    from: "        'These actions STARTED and never reported back. Whether each took effect is unknown. '",
    to: "        'These actions were completed. '",
    expect: 'tells the new runtime to verify actions that never reported back'
  },
  {
    file: HANDOFF,
    name: 'the optional sections are ordered by size rather than by risk',
    from: '  return sections\n}',
    to: '  return sections.slice(0, 1).concat(sections.slice(1).reverse())\n}',
    expect: 'separates what finished from what did not'
  },
  {
    file: HANDOFF,
    name: 'the reserve is too small for the notice it has to hold',
    from: 'export const NOTICE_BUDGET = 120',
    to: 'export const NOTICE_BUDGET = 40',
    expect: 'reserves room for the longest notice every optional section could produce'
  },
  {
    file: HANDOFF,
    name: 'the omission notice is dropped, so a trimmed brief reads as complete',
    from: '    : `${kept.join(\'\\n\\n\')}\\n\\n${omissionNotice(omitted)}`',
    to: '    : kept.join(\'\\n\\n\')',
    expect: 'says so when detail was left out, rather than reading as complete'
  },
  {
    file: HANDOFF,
    name: 'the notice budget is reserved only after the first drop',
    from: '  const budget = MAX_HANDOFF_PROMPT_LENGTH - (sections.length > 1 ? NOTICE_BUDGET : 0)',
    to: '  const budget = MAX_HANDOFF_PROMPT_LENGTH',
    expect: 'reserves enough room for the longest possible omission notice'
  },
  {
    file: MISSIONS,
    name: 'the checkpoint is taken before the stopped run has settled',
    from: '      previous.controller.abort()\n      await settling.get(previous.runId)',
    to: '      previous.controller.abort()',
    expect: 'reconciles only after the stopped run has settled'
  },
  {
    file: MISSIONS,
    name: 'a handoff to the same runtime restarts the run instead of refusing',
    from: '      if (previous.runtime === runtime) {',
    to: '      if (false) {',
    expect: 'refuses a handoff to the runtime already running it, without stopping anything'
  },
  {
    file: MISSIONS,
    name: 'an unreconcilable ledger is handed off anyway',
    from: "      if (checkpoint.resumeSafety === 'unsafe') {",
    to: '      if (false) {',
    expect: 'refuses when the ledger cannot be reconciled, and says the run is stopped'
  },
  {
    file: MISSIONS,
    name: 'the continuation is not recorded, so the new mission looks unrelated',
    from: '              : { continuesFrom: continuation })',
    to: '              : {})',
    expect: 'starts a NEW mission that records what it continues from'
  }
]

const REPORT = join(ROOT, 'mutation-result.json')

function runSuite() {
  // Delete the report first: a run that dies before writing one would otherwise
  // leave the previous report in place and read as "this mutation broke
  // nothing" -- a check that cannot go red, inside the tool that exists to
  // prove checks can.
  rmSync(REPORT, { force: true })
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter', 'json', '--outputFile', 'mutation-result.json'], {
      cwd: ROOT,
      stdio: 'pipe',
      shell: true
    })
  } catch {
    // A red suite exits non-zero; the report is what we read, not the status.
  }
  if (!existsSync(REPORT)) return { failed: [], unparseable: true, total: -1 }
  const report = JSON.parse(readFileSync(REPORT, 'utf8'))
  const failed = []
  let unparseable = false
  for (const file of report.testResults ?? []) {
    if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) unparseable = true
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'failed') failed.push(assertion.title)
    }
  }
  return { failed, unparseable, total: report.numTotalTests ?? 0 }
}

const originals = new Map([
  [STATUS, readFileSync(STATUS, 'utf8')],
  [APPROVALS, readFileSync(APPROVALS, 'utf8')],
  [HANDOFF, readFileSync(HANDOFF, 'utf8')],
  [MISSIONS, readFileSync(MISSIONS, 'utf8')],
  [PEERS, readFileSync(PEERS, 'utf8')],
  [BRIEFING, readFileSync(BRIEFING, 'utf8')],
  [SHARE, readFileSync(SHARE, 'utf8')],
  [VIEW, readFileSync(VIEW, 'utf8')],
  [TEAMMATES, readFileSync(TEAMMATES, 'utf8')],
  [CATALOG, readFileSync(CATALOG, 'utf8')],
  [HISTORY, readFileSync(HISTORY, 'utf8')],
  [RUNTIMES, readFileSync(RUNTIMES, 'utf8')],
  [ROSTER, readFileSync(ROSTER, 'utf8')],
  [UPDATES, readFileSync(UPDATES, 'utf8')],
  [RELAY, readFileSync(RELAY, 'utf8')],
  [FACES, readFileSync(FACES, 'utf8')],
  [ANTIGRAVITY, readFileSync(ANTIGRAVITY, 'utf8')],
  [COST, readFileSync(COST, 'utf8')],
  [CATALOG_MODELS, readFileSync(CATALOG_MODELS, 'utf8')],
  [AGENT_TEXT, readFileSync(AGENT_TEXT, 'utf8')]
])
let problems = 0

try {
  const baseline = runSuite()
  if (baseline.failed.length > 0) {
    console.error(`baseline is not green: ${baseline.failed.join(', ')}`)
    process.exit(1)
  }
  console.error(`baseline green (${baseline.total} tests)\n`)

  for (const mutation of MUTATIONS) {
    const target = mutation.file
    const original = originals.get(target)
    if (original === undefined) {
      // Every mutated file must be registered above so it can be restored.
      // Without this the sweep died on `undefined.includes` and named neither
      // the file nor the mutation.
      console.error(`  [SKIP] ${mutation.name} -- ${target} is not in the originals map`)
      problems += 1
      continue
    }
    if (!original.includes(mutation.from)) {
      console.error(`  [SKIP] ${mutation.name} -- anchor not found`)
      problems += 1
      continue
    }
    writeFileSync(target, original.replace(mutation.from, mutation.to), 'utf8')
    const result = runSuite()
    writeFileSync(target, original, 'utf8')

    if (result.unparseable || result.total !== baseline.total) {
      console.error(`  [INVALID] ${mutation.name} -- the file stopped running, so this red means nothing`)
      problems += 1
      continue
    }
    const caught = result.failed.includes(mutation.expect)
    if (!caught) problems += 1
    console.error(
      `  [${caught ? 'CAUGHT' : 'SURVIVED'}] ${mutation.name}` +
        (caught ? '' : `\n            expected "${mutation.expect}" to fail; failures: ${result.failed.join(', ') || 'none'}`)
    )
  }
} finally {
  for (const [file, text] of originals) writeFileSync(file, text, 'utf8')
  rmSync(REPORT, { force: true })
}

console.error(`\n${problems === 0 ? 'ALL MUTATIONS CAUGHT' : `${problems} MUTATION(S) UNACCOUNTED FOR`}`)
process.exit(problems === 0 ? 0 : 1)
