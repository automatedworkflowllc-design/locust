// Mutation control for this package's runtime adapters.
//
// Everything here sits between a provider's own CLI and the mission ledger:
// the app-server client's request correlation and bounds, each normalizer's
// account of what a tool did, and the containment each command builder is
// responsible for applying. A green suite over them is not evidence; each
// invariant has to be shown to fail when broken.
//
//   node test/mutation-control.mjs
//
// Breaks one behaviour at a time, requires the NAMED test to fail, rejects any
// mutation that stops the file running, and restores the file afterwards.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLIENT = join(ROOT, 'src', 'app-server.ts')
const EVENTS = join(ROOT, 'src', 'app-server-events.ts')
const COMMANDS = join(ROOT, 'src', 'commands.ts')

const CLAUDE_EVENTS = join(ROOT, 'src', 'claude-events.ts')
const LOCATOR = join(ROOT, 'src', 'path-locator.ts')
const DISCOVERY = join(ROOT, 'src', 'discovery.ts')
const CURSOR_EVENTS = join(ROOT, 'src', 'cursor-events.ts')
const CODEX_EVENTS = join(ROOT, 'src', 'codex-events.ts')
const OPENCODE_EVENTS = join(ROOT, 'src', 'opencode-events.ts')
const COPILOT_EVENTS = join(ROOT, 'src', 'copilot-events.ts')
const PROCESS_RUNNER = join(ROOT, 'src', 'process-runner.ts')
const ANTIGRAVITY_EVENTS = join(ROOT, 'src', 'antigravity-events.ts')

const MUTATIONS = [
  {
    file: CLAUDE_EVENTS,
    name: 'the completing assistant record replaces an assumed block_0, so an answer streamed elsewhere renders twice',
    from: '          itemId: textBlockId ?? "block_0",',
    to: '          itemId: "block_0",',
    expect: 'replaces the block the text actually streamed into, not an assumed block_0'
  },
  {
    file: LOCATOR,
    name: 'the .cmd shim is skipped so the .ps1 npm writes beside it is used, which cannot take the arguments',
    from: '        const script = win32.join(directory, `${commandName}.cmd`);',
    to: '        const script = win32.join(directory, `${commandName}.cmd.missing`);',
    expect: 'runs a .cmd shim through cmd.exe, and prefers it to the .ps1 npm writes beside it'
  },
  {
    file: LOCATOR,
    name: 'the guessed install directories are searched alongside PATH again, so a shim on PATH loses to a stale exe',
    from: '        (await resolveWithin(pathOnly))',
    to: '        (await resolveWithin([...pathOnly, ...(await installDirectories(commandName, environment, platform, readDirectory))]))',
    expect: 'prefers a shim on PATH over an executable in a guessed install directory'
  },
  {
    file: CLAUDE_EVENTS,
    name: "the cost Claude Code reported never reaches the receipt",
    from: '          ...(completedUsage === undefined ? {} : { usage: completedUsage }),\n',
    to: '',
    expect: 'carries the dollar figure and the token counts from the result record onto the receipt'
  },
  {
    file: ANTIGRAVITY_EVENTS,
    name: "the model's reasoning rides along in the evidence",
    from: '  const { thinking: _reasoning, ...rest } = parsed;',
    to: '  const rest = parsed;',
    expect: 'never stores the model\'s reasoning, and does not even record that a thinking field was there'
  },
  {
    file: ANTIGRAVITY_EVENTS,
    name: "Antigravity's checkpoint summary is written into the ledger",
    from: '    if (SILENT_TYPES.has(type)) {',
    to: '    if (false) {',
    expect: "never lets Antigravity's checkpoint summary into the ledger"
  },
  {
    file: ANTIGRAVITY_EVENTS,
    name: 'an Antigravity overwrite is reported with a diff nobody produced',
    from: '  const overwrite = antigravityToolArg(args, "Overwrite") === true;',
    to: '  const overwrite = false;',
    expect: 'records an overwrite as a path and no diff, because there is no before-text to diff against'
  },
  {
    file: ANTIGRAVITY_EVENTS,
    name: 'a step Antigravity has not finished writing is normalized anyway',
    from: '    if (stringValue(parsed.status) !== "DONE") return [];',
    to: '    void parsed.status;',
    expect: 'holds it: nothing is emitted, and nothing claims the turn is over'
  },
  {
    file: ANTIGRAVITY_EVENTS,
    name: 'every poll of the transcript replays the whole conversation',
    from: '    if (seen.has(stepIndex)) return [];',
    to: '    void seen.has(stepIndex);',
    expect: 'emits each step exactly once, however many times the file is polled'
  },
  {
    file: ANTIGRAVITY_EVENTS,
    name: 'a finished Antigravity turn is never recognised as finished',
    from: '      latestFinal = true;',
    to: '      latestFinal = false;',
    expect: 'reports the run complete when the last line was a planner answer with no tool calls'
  },
  {
    file: OPENCODE_EVENTS,
    name: "an edit's reported diff is ignored",
    from: '      const patch = reportedDiff !== undefined\n        ? toolPatchFrom(reportedDiff)\n        : kind === "write"',
    to: '      const patch = false\n        ? undefined\n        : kind === "write"',
    expect: 'attaches the unified diff OpenCode reported for an edit, with counts from it'
  },
  {
    file: COPILOT_EVENTS,
    name: "a view's diff-shaped listing becomes a change",
    from: '      const patch = built !== undefined && built.added + built.removed > 0 ? built : undefined;',
    to: '      const patch = built;',
    expect: "attaches a patch to the edit alone; the view's diff-shaped listing carries none"
  },
  {
    file: COMMANDS,
    name: 'a read-only OpenCode mission runs with no permission config at all',
    from: '    ...(sandboxArgument(options.sandbox) === "read-only"\n      ? { env: { OPENCODE_CONFIG_CONTENT: OPENCODE_READ_ONLY_CONFIG } }\n      : {}),',
    to: '',
    expect: 'holds a read-only OpenCode mission with the permission config that actually enforces it'
  },
  {
    file: COMMANDS,
    name: 'a read-only Copilot mission runs with every tool allowed',
    from: '    args.push("--deny-tool=write,shell");',
    to: '    void args;',
    expect: 'holds a read-only Copilot mission with the tool denylist that was measured refusing writes'
  },
  {
    file: COPILOT_EVENTS,
    name: 'a denied Copilot tool call is recorded as one that completed',
    from: '      const failed = data.success !== true;',
    to: '      const failed = data.success === false && false;',
    expect: 'is a failure unless the CLI said success in so many words'
  },
  {
    file: COPILOT_EVENTS,
    name: "the CLI's whole system prompt is written into the ledger",
    from: '    if (IGNORED_TYPES.has(type)) return [];\n',
    to: '',
    expect: 'never lets the CLI\'s system prompt into the ledger'
  },
  {
    file: COPILOT_EVENTS,
    name: "the model's opaque reasoning blobs ride along in the evidence",
    from: '    const scrubbed = scrubCopilotRecord(parsed);',
    to: '    const scrubbed = parsed;',
    expect: "never carries the model's opaque reasoning or the account's request handles"
  },
  {
    file: COPILOT_EVENTS,
    name: 'a policy refusal is reported as nothing more than a non-zero exit',
    from: '      if (refusal !== undefined) {',
    to: '      if (false) {',
    expect: "fails with a reason a person can act on, not just 'the process exited 1'"
  },
  {
    file: COPILOT_EVENTS,
    name: "the session id the CLI printed is ignored in favour of the host's",
    from: '      runtimeThreadId = identityValue(parsed.sessionId) ?? runtimeThreadId;',
    to: '      void parsed.sessionId;',
    expect: 'prefers the session id the CLI printed over the one the host passed in'
  },
  {
    file: OPENCODE_EVENTS,
    name: 'an OpenCode overwrite is reported with a diff nobody produced',
    from: '  if (existed !== false) return undefined;',
    to: '  void existed;',
    expect: 'becomes a patch only when the runtime said the file did not exist'
  },
  {
    file: OPENCODE_EVENTS,
    name: 'an OpenCode tool status this build has never seen is treated as success',
    from: '  if (status === "completed") return { failed: false };\n  return { failed: true, status: status ?? "unknown" };',
    to: '  if (status === "error") return { failed: true, status };\n  return { failed: false };',
    expect: 'treats anything but `completed` as a failure, including nothing at all'
  },
  {
    file: OPENCODE_EVENTS,
    name: 'only the last OpenCode step is counted, so a run looks cheaper than it was',
    from: '        inputTokens += tokens.input;',
    to: '        inputTokens = tokens.input;',
    expect: 'adds up what every step cost, rather than reporting the last step as the total'
  },
  {
    file: OPENCODE_EVENTS,
    name: 'a run that stopped mid-tool-call is reported as completed',
    from: '      if (!sawStop || completion.exitCode !== 0) {',
    to: '      if (completion.exitCode !== 0) {',
    expect: 'is a failure when the stream stops mid-tool-call, however cleanly the process exited'
  },
  {
    file: PROCESS_RUNNER,
    name: 'a prompt already in argv is written to stdin as well',
    from: '      if (terminationRequested || spec.stdin === "none") {',
    to: '      if (terminationRequested) {',
    expect: 'writes nothing to stdin for a runtime whose prompt is already in its argv'
  },
  {
    file: PROCESS_RUNNER,
    name: "a spec's own environment is dropped before the child ever sees it",
    from: '          env: { ...environment, ...(spec.env ?? {}) },',
    to: '          env: { ...environment },',
    expect: "puts a spec's own variables on top of the allowlist, where nothing on the machine can undo them"
  },
  {
    file: CURSOR_EVENTS,
    name: 'an edit is recorded without the change it made',
    from: '            ...(patch === undefined ? {} : { patch }),\n',
    to: '',
    expect: "carries the edit's unified diff as its own field, with counts derived from it"
  },
  {
    file: CODEX_EVENTS,
    name: 'patch counts are taken from the excerpt rather than the whole change',
    from: '  const clean = unified.replaceAll("\\0", "");\n  const truncated = clean.length > MAX_PATCH_TEXT_LENGTH;',
    to: '  const clean = unified.replaceAll("\\0", "").slice(0, MAX_PATCH_TEXT_LENGTH);\n  const truncated = false; added = Math.min(added, 2000);',
    expect: 'counts the whole change before bounding the text, and says when it bounded'
  },
  {
    file: CODEX_EVENTS,
    name: 'file headers are counted as changed lines',
    from: '    if (line.startsWith("+++") || line.startsWith("---")) continue;\n',
    to: '',
    expect: 'does not count the file headers as changed lines'
  },
  {
    file: CURSOR_EVENTS,
    name: 'a truncated final message takes back text already delivered',
    from: '      if (bounded.length < alreadyDelivered) return [];',
    to: '      void alreadyDelivered;',
    expect: 'never takes back text the fragments already delivered'
  },
  {
    file: CURSOR_EVENTS,
    name: 'a turn opens and never closes',
    from: '          emit("step.completed", { stepKind: "turn", evidence }),\n',
    to: '',
    expect: 'also closes, so nothing is left looking unfinished'
  },
  {
    file: DISCOVERY,
    name: 'a model list is read from stdout alone',
    from: '        `${modelsOutcome.result.stdout}\\n${modelsOutcome.result.stderr}`,',
    to: '        modelsOutcome.result.stdout,',
    expect: 'reads a model list the CLI printed on stderr, and says so when it cannot read one'
  },
  {
    file: DISCOVERY,
    name: 'a model list nobody could read is passed off as no models',
    from: '      if (modelHints === undefined) {',
    to: '      if (false) {',
    expect: 'says a model list it cannot read is unreadable, rather than leaving the picker silently empty'
  },
  {
    file: COMMANDS,
    name: 'a Codex resume is given flags that subcommand rejects',
    from: '        "-c",\n        `sandbox_mode=${sandboxArgument(options.sandbox)}`,',
    to: '        "--sandbox",\n        sandboxArgument(options.sandbox),\n        "-C",\n        options.workspacePath,',
    expect: 'resumes a Codex session with only the arguments that subcommand accepts'
  },
  {
    file: CURSOR_EVENTS,
    name: 'a command that ran and failed is recorded as a completed tool',
    from: '  if (exitCode !== undefined && exitCode !== 0) {',
    to: '  if (false) {',
    expect: 'reports a command that RAN and FAILED as failed, with its exit code'
  },
  {
    file: CURSOR_EVENTS,
    name: 'an outcome this build has never seen is recorded as a success',
    from: '  if (key !== "success") return { failed: true, status: key };',
    to: '  if (key === "never") return { failed: true, status: key };',
    expect: 'treats an outcome it has never seen as a failure, not as a success'
  },
  {
    file: CURSOR_EVENTS,
    name: 'a refused command is recorded without saying what it was',
    from: '        ?? stringValue(refused?.command)\n',
    to: '',
    expect: 'names the commands it refused to run, which is the fact a rejection exists to record'
  },
  {
    file: CURSOR_EVENTS,
    name: 'a Cursor run reports no usage at all',
    from: '      if (isObject(parsed.usage)) usage = sanitizedUsage(parsed.usage);\n',
    to: '',
    expect: 'records what the run cost, the way the other adapters do'
  },
  {
    file: CURSOR_EVENTS,
    name: 'a glob is recorded without the directory it searched',
    from: '  return directory === undefined ? pattern : `${pattern} in ${directory}`;',
    to: '  void directory; return pattern;',
    expect: 'reports the edit and the glob as completed tools with their targets'
  },
  {
    file: COMMANDS,
    name: 'a read-only Cursor mission asks for plan mode without the sandbox that enforces it',
    from: '    args.push("--mode", "plan", "--sandbox", "enabled");',
    to: '    args.push("--mode", "plan");',
    expect: 'runs a read-only Cursor mission in plan mode and never forces commands'
  },
  {
    file: DISCOVERY,
    name: "Cursor's model list is never read",
    from: '      modelHints = definition.parseModels?.(',
    to: '      modelHints = undefined; void String(',
    expect: 'reports a signed-in Cursor Agent ready and reads its models off --list-models'
  },
  {
    file: DISCOVERY,
    name: 'an OpenCode that can list no models is reported ready to run one',
    from: '    readyWhen: (result) =>\n      parseOpenCodeModelList(`${result.stdout}\\n${result.stderr}`) !== undefined,',
    to: '    readyWhen: () => true,',
    expect: 'does not report an OpenCode that cannot list a single model as ready to run one'
  },
  {
    file: DISCOVERY,
    name: 'Copilot is reported ready with no note that readiness could not be checked',
    from: '      if (definition.readinessCaveat !== undefined) {\n        diagnostics.push(diagnostic(definition.readinessCaveat));\n      }\n',
    to: '',
    expect: 'reports Copilot CLI ready on its version alone, and says on the record why that is a guess'
  },
  {
    file: DISCOVERY,
    name: 'Copilot is offered a model list it has no way to have read',
    from: '  if (definition.fixedModelHints !== undefined && readiness === "ready") {\n    modelHints = definition.fixedModelHints;\n  }\n',
    to: '',
    expect: 'offers Copilot only the route where the CLI picks, because it names no models before a run'
  },
  {
    file: CURSOR_EVENTS,
    name: "a complete Cursor message appends to its fragments instead of replacing them",
    from: '          operation: "replace",\n          text: bounded,\n          final: true,',
    to: '          operation: "append",\n          text: bounded,\n          final: true,',
    expect: 'rebuilds each message from its fragments and lets the complete message replace, not double, them'
  },
  {
    file: CURSOR_EVENTS,
    name: 'every Cursor message shares one item, so the answer overwrites what came before',
    from: '      messageIndex += 1;\n',
    to: '',
    expect: 'keeps the two messages apart: the answer does not overwrite what was said before the tool ran'
  },
  {
    file: CURSOR_EVENTS,
    name: 'a rejected Cursor shell command is reported as completed',
    from: '  const key = Object.keys(result)[0];',
    to: '  const key = "success";',
    expect: 'reports a rejected shell command as a tool that failed, never as one that completed'
  },
  {
    file: CURSOR_EVENTS,
    name: "Cursor's reasoning text is written into the ledger",
    from: '      const scrubbed = { type, subtype: parsed.subtype, text: "[redacted]" };',
    to: '      const scrubbed = parsed;',
    expect: 'shows reasoning as a step and never lets its text into the ledger'
  },
  {
    file: CURSOR_EVENTS,
    name: 'a clean exit without a result record is a success',
    from: '      if (!sawResult || completion.exitCode !== 0) {',
    to: '      if (completion.exitCode !== 0) {',
    expect: 'is a failure when the CLI exits clean without ever saying it finished'
  },
  {
    file: DISCOVERY,
    name: "a Gemini sign-in Google refused is reported ready",
    from: "    readyWhen: (result) => !/error authenticating|please set an auth method/i.test(`${result.stdout}\\n${result.stderr}`),\n",
    to: '',
    expect: 'reads a Gemini sign-in that Google then refused, which exits 0 with the refusal in its text'
  },
  {
    file: DISCOVERY,
    name: 'a logged-out Cursor Agent is reported ready',
    from: '    if (succeeded(readinessOutcome) && (definition.readyWhen?.(readinessOutcome.result) ?? true)) {',
    to: '    if (succeeded(readinessOutcome)) {',
    expect: 'reads a logged-out Cursor Agent from its text, because its status command exits 0 either way'
  },
  {
    file: COMMANDS,
    name: 'a read-only Cursor mission runs with edits allowed',
    from: '  if (sandboxArgument(options.sandbox) === "read-only") {',
    to: '  if (!sandboxArgument(options.sandbox)) {',
    expect: 'runs a read-only Cursor mission in plan mode and never forces commands'
  },
  {
    file: LOCATOR,
    name: "Cursor's install directory is never searched",
    from: '  { command: "cursor-agent", base: "LOCALAPPDATA", segments: ["cursor-agent"], versioned: false },\n',
    to: '',
    expect: "finds Cursor's launcher in its own install directory without PATH"
  },
  {
    file: LOCATOR,
    name: 'a CLI that is not on PATH is reported as missing',
    from: '        ?? (await resolveWithin(\n          await installDirectories(commandName, environment, platform, readDirectory),\n        ))',
    to: '',
    expect: 'finds Codex in its versioned install root when PATH knows nothing'
  },
  {
    file: LOCATOR,
    name: 'an install root is searched for any command that asks',
    from: '    if (root.command !== commandName) continue;',
    to: '',
    expect: 'searches no install root for a command it does not know'
  },
  {
    file: COMMANDS,
    name: 'a Claude follow-up silently starts a new conversation',
    from: '  if (options.resumeThreadId !== undefined) {\n    args.push("--resume", requireText(options.resumeThreadId, "Session id"));\n  }',
    to: '',
    expect: 'resumes a Claude session by id'
  },
  {
    file: COMMANDS,
    name: 'a Codex follow-up silently starts a new conversation',
    from: '  const args = options.resumeThreadId === undefined',
    to: '  const args = true',
    expect: 'resumes a Codex session with only the arguments that subcommand accepts'
  },
  {
    file: CLAUDE_EVENTS,
    name: 'an allowed usage snapshot is reported as a rate limit',
    from: '  if (text === "allowed") return undefined;',
    to: '  if (text === "allowed") return "temporary-rate-limit";',
    expect: 'says nothing about a snapshot that reports the request was allowed'
  },
  {
    file: COMMANDS,
    name: 'the chosen effort is shown but never sent to Claude Code',
    from: '  if (options.effort !== undefined) {\n    args.push("--effort", requireEffort(options.effort));\n  }',
    to: '',
    expect: 'passes the chosen model and effort to Claude Code'
  },
  {
    file: COMMANDS,
    name: 'the chosen effort is shown but never sent to codex exec',
    from: '    args.push("-c", `model_reasoning_effort=${requireEffort(options.effort)}`);',
    to: '    void options.effort;',
    expect: 'passes effort to codex exec through the config override its docs describe'
  },
  {
    file: COMMANDS,
    name: 'model aliases are invented rather than read from the help',
    from: '  const aliasClause = /alias for the latest model \\(e\\.g\\.\\s*([^)]*)\\)/.exec(helpText);',
    to: '  const aliasClause = ["", "\'fable\', \'opus\', \'sonnet\'"];',
    expect: 'names nothing when the help does not'
  },
  {
    file: CLIENT,
    name: 'a server request is mistaken for a response',
    from: '    if (hasId && method === undefined) {',
    to: '    if (hasId) {',
    expect: 'does not confuse a server request with a response'
  },
  {
    file: CLIENT,
    name: 'a handler failure leaves the server waiting forever',
    from: '          if (disposed) return\n          options.transport.send(\n            `${JSON.stringify({\n              jsonrpc: \'2.0\',\n              id: request.id,\n              error: { code: -32_000, message: \'The client could not answer this request.\' }\n            })}\\n`\n          )',
    to: '          void 0',
    expect: 'still answers when the handler throws'
  },
  {
    file: CLIENT,
    name: 'the buffer grows without bound',
    from: '      if (Buffer.byteLength(buffer, \'utf8\') > maxBufferedBytes) {',
    to: '      if (false) {',
    expect: 'drops a buffer that grows without a newline rather than growing forever'
  },
  {
    file: CLIENT,
    name: 'an oversized line is accepted',
    from: '    if (Buffer.byteLength(trimmed, \'utf8\') > maxLineBytes) {',
    to: '    if (false) {',
    expect: 'drops an oversized single line but keeps the connection usable'
  },
  {
    file: CLIENT,
    name: 'requests are never timed out',
    from: '        const timer = setTimeout(() => {',
    to: '        const timer = setTimeout(() => { if (true) return;',
    expect: 'times out a request the server never answers'
  },
  {
    file: CLIENT,
    name: 'the in-flight limit is not enforced',
    from: '      if (pending.size >= maxPending) {',
    to: '      if (false) {',
    expect: 'refuses to queue beyond its in-flight limit'
  },
  {
    file: CLIENT,
    name: 'dispose leaves in-flight requests hanging',
    from: '      for (const id of [...pending.keys()]) {\n        settle(id, (entry) => entry.reject(new Error(reason)))\n      }',
    to: '      void 0',
    expect: 'fails every in-flight request on dispose instead of hanging'
  },
  {
    file: CLIENT,
    name: 'an unexpected response is swallowed',
    from: "        diagnostic({ code: 'unknown-response', message: 'A response arrived for an unknown request.' })",
    to: '        void 0',
    expect: 'reports a response nobody asked for rather than dropping it silently'
  },
  {
    file: EVENTS,
    name: 'a completed agent message appends instead of replacing',
    from: '          operation: "replace",',
    to: '          operation: "append",',
    expect: 'appends deltas and replaces on the completed item'
  },
  {
    file: EVENTS,
    name: 'a non-zero exit is not treated as a failure',
    from: 'const failed = status === "failed" || status === "error" || (exitCode !== undefined && exitCode !== 0);',
    to: 'const failed = status === "failed" || status === "error";',
    expect: 'treats a non-zero exit as a failure even when the status says otherwise'
  },
  {
    file: EVENTS,
    name: 'a retryable error ends the run',
    from: '          if (params.willRetry === true) {',
    to: '          if (false) {',
    expect: 'does not end the run on an error the provider intends to retry'
  },
  {
    file: EVENTS,
    name: 'comfortable usage is reported as a limit',
    from: '  if (worst.used >= 90) {',
    to: '  if (worst.used >= 0) {',
    expect: 'says nothing while usage is comfortable'
  },
  {
    file: EVENTS,
    name: 'the same limit is announced on every push',
    from: '          if (limit === undefined || announcedLimit) return [];',
    to: '          if (limit === undefined) return [];',
    expect: 'announces a limit once rather than on every push'
  },
  {
    file: EVENTS,
    name: 'a lost connection is reported as cancelled',
    from: '      if (reason === "cancelled") {',
    to: '      if (true) {',
    expect: 'reports a lost connection as failed rather than completed'
  }
]

const REPORT = join(ROOT, 'mutation-result.json')

function runSuite() {
  // Delete the report FIRST: a run that dies before writing one would leave the
  // previous report in place, and a stale green would read as "this mutation
  // broke nothing" -- a check that cannot go red, inside the tool that exists
  // to prove checks can.
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
  [LOCATOR, readFileSync(LOCATOR, 'utf8')],
  [DISCOVERY, readFileSync(DISCOVERY, 'utf8')],
  [OPENCODE_EVENTS, readFileSync(OPENCODE_EVENTS, 'utf8')],
  [ANTIGRAVITY_EVENTS, readFileSync(ANTIGRAVITY_EVENTS, 'utf8')],
  [COPILOT_EVENTS, readFileSync(COPILOT_EVENTS, 'utf8')],
  [PROCESS_RUNNER, readFileSync(PROCESS_RUNNER, 'utf8')],
  [CURSOR_EVENTS, readFileSync(CURSOR_EVENTS, 'utf8')],
  [CODEX_EVENTS, readFileSync(CODEX_EVENTS, 'utf8')],
  [CLAUDE_EVENTS, readFileSync(CLAUDE_EVENTS, 'utf8')],
  [COMMANDS, readFileSync(COMMANDS, 'utf8')],
  [CLIENT, readFileSync(CLIENT, 'utf8')],
  [EVENTS, readFileSync(EVENTS, 'utf8')]
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
