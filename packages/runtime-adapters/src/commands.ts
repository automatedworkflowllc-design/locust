import type { RuntimeModelHints } from "./types.js";
import type {
  ExecutableLaunch,
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
    add("plan-permission-mode", scan(helpText, "--permission-mode") && scan(helpText, "plan"));
    add("tool-allowlist", scan(helpText, "--tools"));
    add("tool-denylist", scan(helpText, "--disallowedTools"));
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
  }
}

function baseSpec(
  runtime: "codex" | "claude",
  executable: ExecutableLaunch,
  cwd: string,
  args: readonly string[],
): RuntimeCommandSpec {
  const spec: RuntimeCommandSpec = {
    runtime,
    executablePath: requireText(executable.executablePath, "Executable path"),
    args: [...executable.prefixArgs, ...args],
    cwd: requireText(cwd, "Workspace path"),
    stdin: "prompt",
    stdout: "jsonl",
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
  const args = options.resumeThreadId === undefined
    ? ["exec", "--json", "--sandbox", sandboxArgument(options.sandbox), "-C", options.workspacePath]
    : [
        "exec",
        "resume",
        requireText(options.resumeThreadId, "Session id"),
        "--json",
        "--sandbox",
        sandboxArgument(options.sandbox),
        "-C",
        options.workspacePath,
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
  const args = [
    "--restricted",
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "plan",
    "--tools",
    "Read,Glob,Grep",
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
