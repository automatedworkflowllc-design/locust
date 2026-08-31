import {
  CLAUDE_REQUIRED_FEATURES,
  CODEX_REQUIRED_FEATURES,
  detectSupportedFeatures,
  OMNIROUTE_REQUIRED_FEATURES,
} from "./commands.js";
import type {
  CommandResult,
  CommandRunner,
  ExecutableLaunch,
  ExecutableLocator,
  ProbeCommand,
  RuntimeDiagnostic,
  RuntimeDiscovery,
  RuntimeFeature,
  RuntimeIntegrationId,
  RuntimeIntegrationKind,
  RuntimeReadiness,
} from "./types.js";
import { parseRuntimeVersion } from "./version.js";

interface IntegrationDefinition {
  readonly id: RuntimeIntegrationId;
  readonly kind: RuntimeIntegrationKind;
  readonly displayName: string;
  readonly commandName: string;
  readonly optional: boolean;
  readonly versionArgs: readonly string[];
  readonly capabilityArgs: readonly string[];
  readonly readinessArgs: readonly string[];
  readonly requiredFeatures: readonly RuntimeFeature[];
}

const DEFINITIONS: readonly IntegrationDefinition[] = [
  {
    id: "codex",
    kind: "agent-runtime",
    displayName: "Codex CLI",
    commandName: "codex",
    optional: false,
    versionArgs: ["--version"],
    capabilityArgs: ["exec", "--help"],
    readinessArgs: ["login", "status"],
    requiredFeatures: CODEX_REQUIRED_FEATURES,
  },
  {
    id: "claude",
    kind: "agent-runtime",
    displayName: "Claude Code",
    commandName: "claude",
    optional: false,
    versionArgs: ["--version"],
    capabilityArgs: ["--help"],
    readinessArgs: ["auth", "status"],
    requiredFeatures: CLAUDE_REQUIRED_FEATURES,
  },
  {
    id: "omniroute",
    kind: "provider-gateway",
    displayName: "OmniRoute",
    commandName: "omniroute",
    optional: true,
    versionArgs: ["--version"],
    capabilityArgs: ["doctor", "--help"],
    readinessArgs: ["doctor", "--json"],
    requiredFeatures: OMNIROUTE_REQUIRED_FEATURES,
  },
];

const PROBE_TIMEOUT_MS = 5_000;

interface ProbeOutcome {
  readonly result?: CommandResult;
  readonly error?: string;
}

async function runProbe(
  runner: CommandRunner,
  executable: ExecutableLaunch,
  purpose: ProbeCommand["purpose"],
  args: readonly string[],
): Promise<ProbeOutcome> {
  try {
    return {
      result: await runner.run({
        purpose,
        executablePath: executable.executablePath,
        args: [...executable.prefixArgs, ...args],
        timeoutMs: PROBE_TIMEOUT_MS,
      }),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown command-runner error" };
  }
}

function succeeded(outcome: ProbeOutcome): outcome is { readonly result: CommandResult } {
  return outcome.result?.exitCode === 0 && outcome.result.timedOut !== true;
}

function failureMessage(outcome: ProbeOutcome): string {
  if (outcome.error) return outcome.error;
  if (outcome.result?.timedOut) return "probe timed out";
  if (outcome.result?.exitCode !== undefined) {
    return `probe exited with code ${String(outcome.result.exitCode)}`;
  }
  return "probe did not return a result";
}

function diagnostic(
  value: RuntimeDiagnostic,
): RuntimeDiagnostic {
  return value;
}

async function discoverOne(
  definition: IntegrationDefinition,
  runner: CommandRunner,
  locator: ExecutableLocator,
): Promise<RuntimeDiscovery> {
  const executable = await locator.find(definition.commandName);
  if (!executable) {
    return {
      id: definition.id,
      kind: definition.kind,
      displayName: definition.displayName,
      optional: definition.optional,
      availability: "unavailable",
      readiness: "unknown",
      supportedFeatures: [],
      requiredFeatures: definition.requiredFeatures,
      diagnostics: [
        diagnostic({
          code: "executable-not-found",
          severity: definition.optional ? "info" : "warning",
          message: `${definition.displayName} was not found on PATH.`,
          resolution: definition.optional
            ? "Install and enable it only if you want this optional route."
            : `Install ${definition.displayName} and make its official CLI available on PATH.`,
        }),
      ],
    };
  }

  const diagnostics: RuntimeDiagnostic[] = [];
  const versionOutcome = await runProbe(
    runner,
    executable,
    "version",
    definition.versionArgs,
  );
  const combinedVersionOutput = succeeded(versionOutcome)
    ? `${versionOutcome.result.stdout}\n${versionOutcome.result.stderr}`
    : "";
  const version = parseRuntimeVersion(combinedVersionOutput);
  if (!succeeded(versionOutcome)) {
    diagnostics.push(
      diagnostic({
        code: "version-probe-failed",
        severity: "warning",
        message: `${definition.displayName} was found, but its version probe ${failureMessage(versionOutcome)}.`,
      }),
    );
  } else if (!version) {
    diagnostics.push(
      diagnostic({
        code: "version-unrecognized",
        severity: "warning",
        message: `${definition.displayName} returned an unrecognized version string.`,
      }),
    );
  }

  const capabilityOutcome = await runProbe(
    runner,
    executable,
    "capabilities",
    definition.capabilityArgs,
  );
  const supportedFeatures = succeeded(capabilityOutcome)
    ? detectSupportedFeatures(
        definition.id,
        `${capabilityOutcome.result.stdout}\n${capabilityOutcome.result.stderr}`,
      )
    : [];

  if (!succeeded(capabilityOutcome)) {
    diagnostics.push(
      diagnostic({
        code: "capability-probe-failed",
        severity: "error",
        message: `${definition.displayName} capability detection ${failureMessage(capabilityOutcome)}.`,
      }),
    );
  }

  const missingFeatures = definition.requiredFeatures.filter(
    (feature) => !supportedFeatures.includes(feature),
  );
  if (missingFeatures.length > 0) {
    diagnostics.push(
      diagnostic({
        code: "required-capability-missing",
        severity: "error",
        message: `${definition.displayName} is missing required safe-integration capabilities: ${missingFeatures.join(", ")}.`,
        resolution: `Update ${definition.displayName}; unsafe permission-bypass flags will not be substituted.`,
      }),
    );
  }

  let readiness: RuntimeReadiness = missingFeatures.length > 0 ? "unsupported" : "unknown";
  if (missingFeatures.length === 0) {
    const readinessOutcome = await runProbe(
      runner,
      executable,
      "readiness",
      definition.readinessArgs,
    );
    if (succeeded(readinessOutcome)) {
      readiness = "ready";
    } else if (
      definition.id !== "omniroute" &&
      readinessOutcome.result !== undefined &&
      readinessOutcome.result.timedOut !== true
    ) {
      readiness = "authentication-required";
      diagnostics.push(
        diagnostic({
          code: "authentication-required",
          severity: "warning",
          message: `${definition.displayName} is installed but its official authentication status command did not report ready.`,
          resolution: `Authenticate in the official ${definition.displayName} CLI, then retry discovery.`,
        }),
      );
    } else {
      readiness = "unhealthy";
      diagnostics.push(
        diagnostic({
          code: definition.id === "omniroute" ? "health-check-failed" : "readiness-probe-failed",
          severity: "error",
          message: `${definition.displayName} readiness ${failureMessage(readinessOutcome)}.`,
        }),
      );
    }
  }

  const base: RuntimeDiscovery = {
    id: definition.id,
    kind: definition.kind,
    displayName: definition.displayName,
    optional: definition.optional,
    availability: "available",
    readiness,
    executable,
    supportedFeatures,
    requiredFeatures: definition.requiredFeatures,
    diagnostics,
  };
  return version ? { ...base, version } : base;
}

export interface DiscoverInstalledRuntimesOptions {
  readonly runner: CommandRunner;
  readonly locator: ExecutableLocator;
  readonly includeOmniRoute?: boolean;
}

export async function discoverInstalledRuntimes(
  options: DiscoverInstalledRuntimesOptions,
): Promise<readonly RuntimeDiscovery[]> {
  const definitions = options.includeOmniRoute === false
    ? DEFINITIONS.filter((definition) => definition.id !== "omniroute")
    : DEFINITIONS;
  return Promise.all(
    definitions.map((definition) => discoverOne(definition, options.runner, options.locator)),
  );
}
