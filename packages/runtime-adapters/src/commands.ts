import type { RuntimeModelHints, RuntimeModelName } from "./types.js";
import type {
  ExecutableLaunch,
  MissionRuntimeId,
  RuntimeCommandSpec,
  RuntimeFeature,
  RuntimeIntegrationId,
} from "./types.js";

export const CODEX_REQUIRED_FEATURES = [
  "non-interactive",
  "jsonl-events",
  "stdin-prompt",
  "workspace-selection",
  "read-only-sandbox",
] as const satisfies readonly RuntimeFeature[];

export const CLAUDE_REQUIRED_FEATURES = [
  "non-interactive",
  "jsonl-events",
  "stdin-prompt",
  "restricted-mode",
  "verbose-streaming",
  "partial-messages",
  "plan-permission-mode",
  "tool-allowlist",
  "tool-denylist",
] as const satisfies readonly RuntimeFeature[];

/**
 * Cursor's agent CLI (`cursor-agent`), read off its own `--help`: a print mode
 * with a `stream-json` output format, partial text deltas, and a read-only
 * `--mode plan`. It names no stdin prompt, so that is not required of it.
 */
export const CURSOR_REQUIRED_FEATURES = [
  "non-interactive",
  "jsonl-events",
  "partial-messages",
  "plan-permission-mode",
  "workspace-selection",
] as const satisfies readonly RuntimeFeature[];

/**
 * Gemini CLI: a headless `--prompt` mode that also reads stdin, `stream-json`
 * output, and a read-only `--approval-mode plan`.
 */
export const GEMINI_REQUIRED_FEATURES = [
  "non-interactive",
  "jsonl-events",
  "stdin-prompt",
  "plan-permission-mode",
] as const satisfies readonly RuntimeFeature[];

/**
 * OpenCode's `run` subcommand: a non-interactive turn that prints one JSON
 * object per line.
 *
 * Nothing about a read-only mode is required of it, and that is deliberate.
 * OpenCode has no read-only FLAG -- measured 2026-09-03, containment comes
 * from a permission config passed in the environment, which no help text
 * names and no probe can see. Requiring a feature that cannot be detected
 * would report every install unsupported; the enforcement lives in the
 * command builder instead, where it is applied rather than merely checked.
 */
export const OPENCODE_REQUIRED_FEATURES = [
  "non-interactive",
  "jsonl-events",
] as const satisfies readonly RuntimeFeature[];

/**
 * GitHub Copilot CLI in its `-p` mode. Both tool lists matter: without
 * `--allow-all-tools` the CLI stops for approval nobody can give, and
 * `--deny-tool` is the only thing measured to actually refuse a write.
 */
export const COPILOT_REQUIRED_FEATURES = [
  "non-interactive",
  "jsonl-events",
  "tool-allowlist",
  "tool-denylist",
] as const satisfies readonly RuntimeFeature[];

export const OMNIROUTE_REQUIRED_FEATURES = [
  "json-health-check",
] as const satisfies readonly RuntimeFeature[];

const FORBIDDEN_ARGUMENTS = new Set([
  "--dangerously-bypass-approvals-and-sandbox",
  "--yolo",
  "--dangerously-bypass-hook-trust",
  "--ignore-rules",
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--full-auto",
  // Cursor Agent: "force allow commands unless explicitly denied".
  "--force",
  "-f",
  // Gemini CLI: "-y" is the short form of its yolo mode.
  "-y",
  // OpenCode: publishes the session to opencode.ai and prints a public link.
  // A mission's transcript is the customer's, and sharing it is irreversible.
  "--share",
  // GitHub Copilot CLI: each of these widens a run past the workspace the host
  // chose, or moves it onto GitHub's servers where this process cannot see it.
  // `--allow-all-tools` is NOT among them: it is what makes the run
  // non-interactive at all, and the denylist is what holds it back.
  "--allow-all-paths",
  "--allow-all-urls",
  "--allow-all",
  "--remote",
  "--remote-export",
  "--enable-memory",
]);

function requireText(value: string, label: string): string {
  if (!value.trim() || value.includes("\0")) throw new Error(`${label} must be non-empty`);
  return value;
}

function scan(help: string, token: string): boolean {
  return help.toLowerCase().includes(token.toLowerCase());
}

export function detectSupportedFeatures(
  runtime: RuntimeIntegrationId,
  helpText: string,
): readonly RuntimeFeature[] {
  const features: RuntimeFeature[] = [];
  const add = (feature: RuntimeFeature, supported: boolean): void => {
    if (supported) features.push(feature);
  };

  if (runtime === "codex") {
    add("non-interactive", true);
    add("jsonl-events", scan(helpText, "--json"));
    add("stdin-prompt", scan(helpText, "stdin"));
    add("workspace-selection", scan(helpText, "--cd") || scan(helpText, "-C"));
    add("read-only-sandbox", scan(helpText, "--sandbox") && scan(helpText, "read-only"));
  } else if (runtime === "claude") {
    add("non-interactive", scan(helpText, "--print") || scan(helpText, "-p"));
    add(
      "jsonl-events",
      scan(helpText, "--output-format") && scan(helpText, "stream-json"),
    );
    add("stdin-prompt", scan(helpText, "stdin"));
    add("restricted-mode", scan(helpText, "--restricted"));
    add("verbose-streaming", scan(helpText, "--verbose"));
    add("partial-messages", scan(helpText, "--include-partial-messages"));
    // Historical name: read-only Claude ran in plan mode until 0.32.2. What
    // the app needs is the flag itself; the modes it sends are default and
    // acceptEdits, both older than plan.
    add("plan-permission-mode", scan(helpText, "--permission-mode"));
    add("tool-allowlist", scan(helpText, "--tools"));
    add("tool-denylist", scan(helpText, "--disallowedTools"));
  } else if (runtime === "cursor") {
    add("non-interactive", scan(helpText, "--print"));
    add("jsonl-events", scan(helpText, "--output-format") && scan(helpText, "stream-json"));
    add("partial-messages", scan(helpText, "--stream-partial-output"));
    add("plan-permission-mode", scan(helpText, "--mode") && scan(helpText, "plan"));
    add("workspace-selection", scan(helpText, "--workspace"));
  } else if (runtime === "gemini") {
    add("non-interactive", scan(helpText, "--prompt"));
    add("jsonl-events", scan(helpText, "--output-format") && scan(helpText, "stream-json"));
    add("stdin-prompt", scan(helpText, "stdin"));
    add("plan-permission-mode", scan(helpText, "--approval-mode") && scan(helpText, "plan"));
  } else if (runtime === "opencode" || runtime === "copilot") {
    // These two were measured by RUNNING them, not by reading a help page:
    // this repo has never captured `opencode run --help` or `copilot --help`,
    // so nothing below is claimed on the strength of their wording. What is
    // scanned for is the exact flags the builders in this file pass. A CLI
    // that stops naming one is reported unsupported, which is the direction
    // that costs a route rather than the direction that runs an argv the
    // CLI may reject halfway through a mission.
    if (runtime === "opencode") {
      add("non-interactive", scan(helpText, "run"));
      add("jsonl-events", scan(helpText, "--format") && scan(helpText, "json"));
    } else {
      add("non-interactive", scan(helpText, "--prompt") || scan(helpText, "-p"));
      add("jsonl-events", scan(helpText, "--output-format") && scan(helpText, "json"));
      add("tool-allowlist", scan(helpText, "--allow-all-tools"));
      add("tool-denylist", scan(helpText, "--deny-tool"));
    }
  } else if (runtime === "antigravity") {
    // Nothing. Antigravity's `agentapi` prints no help text this repo has ever
    // captured, and it cannot even open a conversation without a project id
    // from its own state file -- so no feature is claimed for it. Falling
    // through to the gateway branch below would have it claim a health check
    // off a help page that does not exist.
    void helpText;
  } else {
    add("json-health-check", scan(helpText, "--json"));
  }

  return features;
}

export function assertSafeRuntimeCommand(spec: RuntimeCommandSpec): void {
  for (let index = 0; index < spec.args.length; index += 1) {
    const argument = spec.args[index];
    if (argument === undefined) continue;
    if (FORBIDDEN_ARGUMENTS.has(argument)) {
      throw new Error(`Forbidden runtime argument: ${argument}`);
    }
    if (
      [...FORBIDDEN_ARGUMENTS].some((forbidden) => argument.startsWith(`${forbidden}=`))
    ) {
      throw new Error(`Forbidden runtime argument: ${argument}`);
    }
    if (argument === "--sandbox=danger-full-access") {
      throw new Error("Forbidden Codex sandbox: danger-full-access");
    }
    if (argument.toLowerCase() === "--permission-mode=bypasspermissions") {
      throw new Error("Forbidden Claude permission mode: bypassPermissions");
    }
    if (argument === "--ask-for-approval=never") {
      throw new Error("Forbidden Codex approval mode: never");
    }
    if (argument === "danger-full-access" && spec.args[index - 1] === "--sandbox") {
      throw new Error("Forbidden Codex sandbox: danger-full-access");
    }
    if (
      argument.toLowerCase() === "bypasspermissions" &&
      spec.args[index - 1] === "--permission-mode"
    ) {
      throw new Error("Forbidden Claude permission mode: bypassPermissions");
    }
    if (argument === "never" && spec.args[index - 1] === "--ask-for-approval") {
      throw new Error("Forbidden Codex approval mode: never");
    }
    if (argument === "--approval-mode=yolo") {
      throw new Error("Forbidden Gemini approval mode: yolo");
    }
    if (argument === "yolo" && spec.args[index - 1] === "--approval-mode") {
      throw new Error("Forbidden Gemini approval mode: yolo");
    }
  }
}

interface SpecTransport {
  /** Omitted means the prompt goes on stdin, which is what most CLIs read. */
  readonly stdin?: "prompt" | "none";
  readonly env?: Readonly<Record<string, string>>;
}

function baseSpec(
  runtime: MissionRuntimeId,
  executable: ExecutableLaunch,
  cwd: string,
  args: readonly string[],
  transport: SpecTransport = {},
): RuntimeCommandSpec {
  const spec: RuntimeCommandSpec = {
    runtime,
    executablePath: requireText(executable.executablePath, "Executable path"),
    args: [...executable.prefixArgs, ...args],
    cwd: requireText(cwd, "Workspace path"),
    stdin: transport.stdin ?? "prompt",
    stdout: "jsonl",
    ...(transport.env === undefined ? {} : { env: transport.env }),
  };
  assertSafeRuntimeCommand(spec);
  return spec;
}

/**
 * How much a mission may touch. `read-only` is the default everywhere: a caller
 * that says nothing gets the safe mode, so write access is only ever something
 * a caller asked for explicitly.
 *
 * `danger-full-access` is deliberately not in this union. It is refused by
 * `assertSafeRuntimeCommand` as well, so removing that check alone would not
 * make it reachable.
 */
export type MissionSandbox = "read-only" | "workspace-write";

export interface RuntimeCommandOptions {
  readonly workspacePath: string;
  readonly model?: string;
  /** A reasoning effort the runtime reported supporting for that model. */
  readonly effort?: string;
  readonly sandbox?: MissionSandbox;
  /**
   * The runtime's own session handle, to continue that conversation instead of
   * starting a blank one. Codex calls it a thread id and Claude Code a session
   * id; both take it back on the command line, which is what makes a second
   * turn a reply rather than a stranger.
   */
  readonly resumeThreadId?: string;
  /**
   * The mission's prompt, for the runtimes that take it as a positional
   * argument instead of on stdin. Every other builder ignores it: the runner
   * still owns delivery there, and a prompt in two places is a prompt that
   * can disagree with itself.
   */
  readonly prompt?: string;
  /**
   * The session id the HOST minted for a first Copilot run. Copilot prints its
   * session id only in the terminal `result` record, so a run that dies before
   * that record would leave nothing to resume from; the host generating the id
   * up front is what makes a follow-up possible at all.
   */
  readonly sessionId?: string;
}

const EFFORT = /^[a-z]{1,16}$/;

/** An effort level is one plain word; anything else never reaches an argv. */
function requireEffort(value: string): string {
  if (!EFFORT.test(value)) throw new Error("Effort is invalid");
  return value;
}

/**
 * Read what the Claude Code CLI says about models in its own `--help`: the
 * aliases it accepts for the newest model of each family, and the effort
 * levels it takes. Missing text yields nothing, never a guess.
 */
export function parseClaudeModelHints(helpText: string): RuntimeModelHints | undefined {
  const aliasClause = /alias for the latest model \(e\.g\.\s*([^)]*)\)/.exec(helpText);
  const aliases = aliasClause
    ? [...aliasClause[1]!.matchAll(/'([a-z0-9][a-z0-9.-]{0,30})'/g)].map((match) => match[1]!)
    : [];
  const effortClause = /--effort <level>[\s\S]{0,200}?\(([a-z, ]+)\)/.exec(helpText);
  const efforts = effortClause
    ? effortClause[1]!.split(",").map((entry) => entry.trim()).filter((entry) => EFFORT.test(entry))
    : [];
  if (aliases.length === 0 && efforts.length === 0) return undefined;
  return { aliases: [...new Set(aliases)], efforts: [...new Set(efforts)] };
}

/**
 * Read `cursor-agent --list-models` as it prints: a heading, then one
 * `<id> - <display name>` per line. Measured 2026-09-02; the ids carry the
 * effort (`cursor-grok-4.6-high`), which is why no effort list comes back.
 * Nothing is listed that the CLI did not print.
 */
/**
 * Whether Cursor can actually hold a mission read-only on this platform.
 *
 * Its sandbox is the only thing that enforces it, and the CLI refuses to
 * enable one anywhere but macOS and Linux -- measured on Windows, where the
 * command exits 1 with that message. Where this is false, a read-only Cursor
 * mission must be refused rather than run under a label nothing upholds.
 */
export function cursorCanEnforceReadOnly(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "linux";
}

export function parseCursorModelList(text: string): RuntimeModelHints | undefined {
  const models: RuntimeModelName[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z0-9][a-z0-9.-]{0,60})\s+-\s+(.{1,80})$/.exec(line.trim());
    if (match === null || models.some((model) => model.id === match[1])) continue;
    models.push({ id: match[1]!, displayName: match[2]!.trim() });
  }
  if (models.length === 0) return undefined;
  return { aliases: models.map((model) => model.id), efforts: [], models };
}

function sandboxArgument(sandbox: MissionSandbox | undefined): MissionSandbox {
  if (sandbox === undefined) return "read-only";
  if (sandbox !== "read-only" && sandbox !== "workspace-write") {
    throw new Error("Unsupported mission sandbox");
  }
  return sandbox;
}

export function createCodexExecCommand(
  executable: ExecutableLaunch,
  options: RuntimeCommandOptions,
): RuntimeCommandSpec {
  // Writes, when allowed at all, are confined to the workspace Codex is given.
  // The host chooses that directory; the renderer only ever chooses the mode.
  // `codex exec resume <SESSION_ID>` is a subcommand, not a flag, so the verb
  // itself changes when a conversation is being continued.
  //
  // MEASURED 2026-09-02: `codex exec resume` takes NEITHER `--sandbox` NOR
  // `-C`. Passing them made the CLI exit 2 with "unexpected argument", so
  // every Codex reply failed with "Codex invocation did not complete
  // successfully" -- the unit tests asserted the argv I had written rather
  // than the argv the CLI accepts, and no live run had exercised it. The
  // sandbox goes through the config override the subcommand does support,
  // and the working directory needs no flag because the process is spawned
  // in it.
  // MEASURED 2026-09-03: without --skip-git-repo-check, a workspace that is
  // not a git repository (and not on Codex's trusted list) fails the run
  // before the model is ever reached -- exit 1 in half a second, stderr "Not
  // inside a trusted directory and --skip-git-repo-check was not specified."
  // That check is Codex protecting a folder it cannot undo changes in; here
  // the host owns that decision instead, through the sandbox argument below,
  // the approval gate, and a recorded diff of every write. Accepted by both
  // `exec` and `exec resume` (both --help checked on 0.151.0-alpha.7.2).
  const args = options.resumeThreadId === undefined
    ? ["exec", "--json", "--skip-git-repo-check", "--sandbox", sandboxArgument(options.sandbox), "-C", options.workspacePath]
    : [
        "exec",
        "resume",
        requireText(options.resumeThreadId, "Session id"),
        "--json",
        "--skip-git-repo-check",
        "-c",
        `sandbox_mode=${sandboxArgument(options.sandbox)}`,
      ];
  if (options.model !== undefined) {
    args.push("--model", requireText(options.model, "Model"));
  }
  if (options.effort !== undefined) {
    // `codex exec` has no effort flag; the config override is how the CLI's
    // own docs set reasoning effort for a run.
    args.push("-c", `model_reasoning_effort=${requireEffort(options.effort)}`);
  }
  args.push("-");
  return baseSpec("codex", executable, options.workspacePath, args);
}

export function createClaudePrintCommand(
  executable: ExecutableLaunch,
  options: RuntimeCommandOptions,
): RuntimeCommandSpec {
  // Claude Code CAN edit; this used to be hard-coded so it never did.
  //
  // MEASURED 2026-09-03 off `claude --help`: `--permission-mode` takes
  // `acceptEdits` among others, and `--restricted` does NOT block editing --
  // it removes the command-running tools and WebFetch *unless --tools names
  // them*, and ignores user/project settings files. So `--restricted` is
  // worth keeping in both modes (the tool list stays explicit and auditable,
  // and none of the person's own Claude settings leak into a mission); what
  // held every Claude run read-only was `--permission-mode plan` with a
  // three-tool list, sent whatever the composer asked for. The composer said
  // "Accept edits" and the header said "read-only" on the same screen.
  //
  // Now the mode decides. Read-only keeps exactly what it had. Accept edits
  // names the file-editing tools and Bash, so a Claude mission can do the
  // same work a Codex one can -- edit, then run the tests it just changed.
  const editing = sandboxArgument(options.sandbox) !== "read-only";
  const args = [
    "--restricted",
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Read-only used to be plan mode. Plan mode has side effects of its own:
    // Claude Code writes its plan under ~/.claude/plans (which the activity
    // fold then counted as "Edited 1 file", outside the folder) and calls
    // ExitPlanMode, which fails without a person to answer it (seen driving
    // the app, 2026-09-05). The tool list is what keeps a run read-only;
    // default mode with only reading tools has nothing to plan or exit.
    //
    // Task is the subagent launcher. Without it no Claude Code teammate
    // could spawn a helper at all (Colin, 2026-09-05: "do we have the
    // ability to run subagents through the capable models?"). A helper
    // inherits the tools of the run that asked for it, so a read-only run's
    // helpers read only.
    "--permission-mode",
    editing ? "acceptEdits" : "default",
    "--tools",
    editing ? "Read,Glob,Grep,Edit,Write,NotebookEdit,Bash,Task" : "Read,Glob,Grep,Task",
    "--disallowedTools",
    "mcp__*",
  ];
  if (options.model !== undefined) {
    args.push("--model", requireText(options.model, "Model"));
  }
  if (options.effort !== undefined) {
    args.push("--effort", requireEffort(options.effort));
  }
  if (options.resumeThreadId !== undefined) {
    args.push("--resume", requireText(options.resumeThreadId, "Session id"));
  }
  return baseSpec("claude", executable, options.workspacePath, args);
}

/**
 * Cursor Agent in its print mode.
 *
 * MEASURED 2026-09-02, and it corrects something this file used to claim.
 * `--mode plan` is described by the CLI as "read-only/planning (analyze,
 * propose plans, no edits)", and a plainly-worded mission does respect it.
 * It is NOT enforcement: told insistently to write, a plan-mode run created
 * two files with its edit tool. Its shell calls were rejected, so plan mode
 * gates commands and not edits.
 *
 * The enforcement Cursor does have is `--sandbox enabled`, and on Windows it
 * answers "Sandbox mode is enabled but not available on this system. Sandbox
 * requires macOS or Linux." So a read-only mission asks for BOTH, and the
 * host refuses to start one where the sandbox cannot run rather than record
 * a containment it cannot keep.
 *
 * The CLI names no effort flag, so an effort is refused rather than dropped:
 * a caller that was shown an effort and had it silently ignored would believe
 * a claim nothing honoured.
 */
export function createCursorPrintCommand(
  executable: ExecutableLaunch,
  options: RuntimeCommandOptions,
): RuntimeCommandSpec {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    // Measured: without this a headless run in a directory Cursor has not seen
    // stops on a "Workspace Trust Required" prompt nobody can answer. The
    // host chose this workspace, so trusting it for this run is the truth.
    "--trust",
    "--workspace",
    options.workspacePath,
  ];
  if (sandboxArgument(options.sandbox) === "read-only") {
    // Plan mode is the instruction; the sandbox is the enforcement. Asking
    // for the instruction alone would put a read-only label on a run that can
    // still edit files.
    args.push("--mode", "plan", "--sandbox", "enabled");
  }
  if (options.model !== undefined) {
    args.push("--model", requireText(options.model, "Model"));
  }
  if (options.effort !== undefined) {
    throw new Error("Cursor Agent takes no effort level");
  }
  if (options.resumeThreadId !== undefined) {
    args.push("--resume", requireText(options.resumeThreadId, "Session id"));
  }
  return baseSpec("cursor", executable, options.workspacePath, args);
}

/**
 * Gemini CLI, headless. The prompt arrives on stdin, which its help says a
 * headless run reads. `--skip-trust` trusts the workspace for this run only:
 * measured on an untrusted folder, the CLI silently overrode plan mode to its
 * default, so without it a read-only mission would not be one.
 *
 * `yolo` is never an approval mode here, and `-y` is refused outright.
 */
export function createGeminiPrintCommand(
  executable: ExecutableLaunch,
  options: RuntimeCommandOptions,
): RuntimeCommandSpec {
  const args = [
    "--output-format",
    "stream-json",
    "--skip-trust",
    "--approval-mode",
    sandboxArgument(options.sandbox) === "read-only" ? "plan" : "auto_edit",
  ];
  if (options.model !== undefined) {
    args.push("--model", requireText(options.model, "Model"));
  }
  if (options.effort !== undefined) {
    throw new Error("Gemini CLI takes no effort level");
  }
  if (options.resumeThreadId !== undefined) {
    args.push("--resume", requireText(options.resumeThreadId, "Session id"));
  }
  return baseSpec("gemini", executable, options.workspacePath, args);
}

/**
 * Read `opencode models` as it prints: one `provider/model` id per line and
 * nothing else. Measured 2026-09-03 on opencode-ai 1.18.27.
 *
 * The display name is the half after the first slash, because a picker that
 * shows `opencode/` in front of every row is showing the same word ten times.
 * A `-free` suffix is the runtime's own claim about its billing, so it is
 * repeated as a description rather than interpreted; nothing else is added.
 */
export function parseOpenCodeModelList(text: string): RuntimeModelHints | undefined {
  const models: RuntimeModelName[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z0-9][a-z0-9._-]{0,60})\/([A-Za-z0-9][A-Za-z0-9._-]{0,80})$/.exec(line.trim());
    if (match === null) continue;
    const id = `${match[1]!}/${match[2]!}`;
    if (models.some((model) => model.id === id)) continue;
    const displayName = match[2]!;
    models.push(
      displayName.endsWith("-free")
        ? { id, displayName, description: "free" }
        : { id, displayName },
    );
  }
  if (models.length === 0) return undefined;
  return { aliases: models.map((model) => model.id), efforts: [], models };
}

/**
 * What Copilot CLI offers before a run has been paid for.
 *
 * There is no `copilot models` command, and the only place model names appear
 * is inside a run, in `session.auto_mode_resolved.data.availableModels` --
 * account-specific, and unreadable without spending a premium request. So the
 * single route offered is the CLI choosing for itself, which is exactly what
 * omitting `--model` does. No model id this build has not been handed is ever
 * named here.
 */
export const COPILOT_MODEL_HINTS: RuntimeModelHints = {
  aliases: ["auto"],
  efforts: [],
  models: [{ id: "auto", displayName: "Auto", description: "Copilot picks the model" }],
};

/**
 * OpenCode's permission config, as an environment value.
 *
 * MEASURED 2026-09-03, and it is the only containment this runtime has. With
 * this set, the write tool is not offered to the model at all: the read-only
 * capture shows the run answering "no write tool is available" and listing the
 * eight tools it did get. Without it, `run` edits files with no flag asked
 * for -- the default `build` agent allows everything, so `--auto` buys
 * nothing and is not passed.
 *
 * `--agent plan` is NOT this. Measured in the same session, plan mode is an
 * instruction the model narrates ("In PLAN MODE -- read-only") and not a rule
 * anything upholds, so it is never what a read-only mission rests on.
 */
export const OPENCODE_READ_ONLY_CONFIG = JSON.stringify({
  permission: { edit: "deny", write: "deny", bash: "deny", patch: "deny" },
});

/**
 * OpenCode in its non-interactive `run` mode.
 *
 * The prompt goes in ARGV, not on stdin. Measured: the positional prompt is
 * what the CLI documents and what was seen working; nothing in this repo has
 * ever seen `opencode run` read a prompt from stdin, and a prompt delivered
 * down a channel that was never tried is a mission that hangs. So the spec
 * says `stdin: "none"` and the runner closes the pipe.
 *
 * The working directory is the workspace and there is no flag for it: OpenCode
 * takes the directory it is spawned in.
 */
export function createOpenCodeRunCommand(
  executable: ExecutableLaunch,
  options: RuntimeCommandOptions,
): RuntimeCommandSpec {
  const args = ["run", "--format", "json"];
  if (options.model !== undefined) {
    args.push("-m", requireText(options.model, "Model"));
  }
  if (options.effort !== undefined) {
    // Its `run` names no effort flag. Dropping one silently would leave a
    // caller believing a setting they were shown had been applied.
    throw new Error("OpenCode takes no effort level");
  }
  if (options.resumeThreadId !== undefined) {
    args.push("-s", requireText(options.resumeThreadId, "Session id"));
  }
  args.push(requireText(options.prompt ?? "", "Prompt"));
  return baseSpec("opencode", executable, options.workspacePath, args, {
    stdin: "none",
    ...(sandboxArgument(options.sandbox) === "read-only"
      ? { env: { OPENCODE_CONFIG_CONTENT: OPENCODE_READ_ONLY_CONFIG } }
      : {}),
  });
}

/**
 * GitHub Copilot CLI, non-interactive.
 *
 * `--allow-all-tools` is not a bypass here, it is the only way to run without
 * a terminal: without it the CLI waits for an approval no host can give. What
 * holds the run back is `--deny-tool=write,shell`, measured refusing
 * `apply_patch` with "Permission to run this tool was denied due to the
 * following rules: `write`" and PowerShell with "rules: `shell`", leaving no
 * file behind.
 *
 * The session id is the host's, passed in on the first run. Copilot prints one
 * of its own in the terminal `result` record, but only there -- a run that
 * fails earlier would print none, and a mission that cannot be continued after
 * a failure is the one case where continuing matters most.
 */
export function createCopilotPromptCommand(
  executable: ExecutableLaunch,
  options: RuntimeCommandOptions,
): RuntimeCommandSpec {
  const args = [
    "-p",
    requireText(options.prompt ?? "", "Prompt"),
    "--output-format",
    "json",
    "--allow-all-tools",
    // Colour codes would land in the JSON strings this adapter parses.
    "--no-color",
  ];
  if (sandboxArgument(options.sandbox) === "read-only") {
    args.push("--deny-tool=write,shell");
  }
  if (options.model !== undefined) {
    args.push("--model", requireText(options.model, "Model"));
  }
  if (options.effort !== undefined) {
    throw new Error("Copilot CLI takes no effort level");
  }
  if (options.resumeThreadId !== undefined) {
    // Measured: the resume flag takes its value with `=`, and the run recalled
    // what the first turn had been told.
    args.push(`--resume=${requireText(options.resumeThreadId, "Session id")}`);
  } else if (options.sessionId !== undefined) {
    args.push("--session-id", requireText(options.sessionId, "Session id"));
  }
  return baseSpec("copilot", executable, options.workspacePath, args, { stdin: "none" });
}
