export type RuntimeIntegrationId = "codex" | "claude" | "omniroute";

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
 * A shell-free process target. PowerShell shims are represented as a native
 * PowerShell executable plus fixed prefix arguments rather than `shell: true`.
 */
export interface ExecutableLaunch {
  readonly commandName: string;
  readonly discoveredPath: string;
  readonly executablePath: string;
  readonly prefixArgs: readonly string[];
  readonly kind: "native" | "powershell-shim";
}

export interface ProbeCommand {
  readonly purpose: "version" | "capabilities" | "readiness";
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
}

/** A future runner may bind the prompt to stdin; this package does not execute it. */
export interface RuntimeCommandSpec {
  readonly runtime: Exclude<RuntimeIntegrationId, "omniroute">;
  readonly executablePath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdin: "prompt";
  readonly stdout: "jsonl";
}
