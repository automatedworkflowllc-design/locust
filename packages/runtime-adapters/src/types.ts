/**
 * Every integration this package knows how to find. Cursor Agent and Gemini
 * CLI are found, versioned and asked about sign-in like the other two; whether
 * a mission may RUN under them is the host's decision, made per runtime on the
 * strength of a measured event stream.
 */
export type RuntimeIntegrationId =
  | "codex"
  | "claude"
  | "cursor"
  | "gemini"
  | "opencode"
  | "copilot"
  /**
   * EXPERIMENTAL. Antigravity is a mission runtime, but it is not DISCOVERED
   * like the others: its `agentapi` refuses to start a conversation without a
   * project id that only its own protobuf state file holds, so no probe this
   * package could run would say anything true about it. The host owns finding
   * it; this package only normalizes the transcript it leaves behind.
   */
  | "antigravity"
  | "omniroute";

/**
 * A runtime that can actually own a mission. OmniRoute is a gateway to other
 * providers rather than a runtime a mission runs under, so it is excluded by
 * construction instead of by remembering to exclude it at each use.
 */
export type MissionRuntimeId = Exclude<RuntimeIntegrationId, "omniroute">;

export type RuntimeIntegrationKind = "agent-runtime" | "provider-gateway";

export type RuntimeAvailability = "available" | "unavailable";

export type RuntimeReadiness =
  | "ready"
  | "authentication-required"
  | "unsupported"
  | "unhealthy"
  | "unknown";

export type RuntimeFeature =
  | "non-interactive"
  | "jsonl-events"
  | "stdin-prompt"
  | "workspace-selection"
  | "read-only-sandbox"
  | "restricted-mode"
  | "verbose-streaming"
  | "partial-messages"
  | "plan-permission-mode"
  | "tool-allowlist"
  | "tool-denylist"
  | "json-health-check";

export type RuntimeDiagnosticCode =
  | "executable-not-found"
  /**
   * The runtime is installed and its version printed, but no command it offers
   * can tell whether it will actually accept work without spending the user's
   * quota. Reported at `info` beside a `ready` readiness so the picker offers
   * the route while the reason it is only a best guess stays on the record.
   */
  | "readiness-unverifiable"
  | "version-probe-failed"
  | "version-unrecognized"
  | "capability-probe-failed"
  | "required-capability-missing"
  | "authentication-required"
  | "readiness-probe-failed"
  | "health-check-failed";

export interface RuntimeDiagnostic {
  readonly code: RuntimeDiagnosticCode;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly resolution?: string;
}

export interface ParsedRuntimeVersion {
  readonly raw: string;
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
  readonly build?: string;
}

/**
 * A shell-free process target. A shim is represented as its real interpreter
 * plus fixed prefix arguments rather than `shell: true`, so nothing is ever
 * handed to a shell to re-parse.
 */
export interface ExecutableLaunch {
  readonly commandName: string;
  readonly discoveredPath: string;
  readonly executablePath: string;
  readonly prefixArgs: readonly string[];
  readonly kind: "native" | "powershell-shim" | "cmd-shim";
}

export interface ProbeCommand {
  readonly purpose: "version" | "capabilities" | "readiness" | "models";
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
}

/** Implement this in the trusted host process. It must execute without a shell. */
export interface CommandRunner {
  run(command: ProbeCommand): Promise<CommandResult>;
}

export interface ExecutableLocator {
  find(commandName: string): Promise<ExecutableLaunch | undefined>;
}

/**
 * What a runtime's own CLI advertises about models, read from its help text at
 * discovery. Aliases resolve to the newest model in a family on the runtime's
 * side, so a new release appears here without a code change -- and nothing is
 * listed that the installed CLI did not itself name.
 */
export interface RuntimeModelHints {
  readonly aliases: readonly string[];
  readonly efforts: readonly string[];
  /** Ids with the names the runtime printed beside them, when it printed a list. */
  readonly models?: readonly RuntimeModelName[];
}

export interface RuntimeModelName {
  readonly id: string;
  readonly displayName: string;
  /**
   * A short qualifier the runtime itself justifies -- OpenCode's `-free`
   * suffix, or the fact that a route lets the CLI choose the model. Never a
   * description this package invented about a model it cannot see.
   */
  readonly description?: string;
}

export interface RuntimeDiscovery {
  readonly id: RuntimeIntegrationId;
  readonly kind: RuntimeIntegrationKind;
  readonly displayName: string;
  readonly optional: boolean;
  readonly availability: RuntimeAvailability;
  readonly readiness: RuntimeReadiness;
  readonly executable?: ExecutableLaunch;
  readonly version?: ParsedRuntimeVersion;
  readonly supportedFeatures: readonly RuntimeFeature[];
  readonly requiredFeatures: readonly RuntimeFeature[];
  readonly diagnostics: readonly RuntimeDiagnostic[];
  readonly modelHints?: RuntimeModelHints;
}

/** A future runner may bind the prompt to stdin; this package does not execute it. */
export interface RuntimeCommandSpec {
  readonly runtime: MissionRuntimeId;
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /**
   * Where the prompt is. `prompt` means the runner writes it to stdin, which
   * is what Codex, Claude Code and Gemini read. `none` means it is already in
   * `args`, because the CLI takes it as a positional and reading stdin was
   * never measured working -- see the OpenCode and Copilot builders.
   */
  readonly stdin: "prompt" | "none";
  readonly stdout: "jsonl";
  /**
   * Variables this run needs on top of the runner's allowlist. OpenCode has no
   * read-only flag; its permission config arrives this way, so a spec that
   * claims read-only carries the thing that enforces it rather than trusting a
   * caller to remember.
   */
  readonly env?: Readonly<Record<string, string>>;
}
