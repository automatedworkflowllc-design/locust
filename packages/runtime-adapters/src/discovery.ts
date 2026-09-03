import {
  CLAUDE_REQUIRED_FEATURES,
  CODEX_REQUIRED_FEATURES,
  COPILOT_MODEL_HINTS,
  COPILOT_REQUIRED_FEATURES,
  CURSOR_REQUIRED_FEATURES,
  detectSupportedFeatures,
  GEMINI_REQUIRED_FEATURES,
  OMNIROUTE_REQUIRED_FEATURES,
  OPENCODE_REQUIRED_FEATURES,
  parseClaudeModelHints,
  parseCursorModelList,
  parseOpenCodeModelList,
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
  RuntimeModelHints,
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
  /**
   * Whether a readiness probe that EXITED cleanly actually reported ready.
   * Most CLIs say so with their exit code; one says "Not logged in" and
   * exits 0, so its text has to be read. Absent means the exit code is the
   * whole answer.
   */
  readonly readyWhen?: (result: CommandResult) => boolean;
  /** A command that prints the runtime's model list, run only once it is ready. */
  readonly modelsArgs?: readonly string[];
  /** How that list is read. Each CLI prints its own shape; none is guessed. */
  readonly parseModels?: (text: string) => RuntimeModelHints | undefined;
  /**
   * Routes a runtime offers without any list command to ask. Only for a CLI
   * that has none: the alternative is naming models nobody printed.
   */
  readonly fixedModelHints?: RuntimeModelHints;
  /**
   * A note attached to a runtime reported ready on weaker evidence than the
   * others. It rides alongside `ready`, so the route is offered and the reason
   * it is a best guess stays visible.
   */
  readonly readinessCaveat?: RuntimeDiagnostic;
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
    id: "cursor",
    kind: "agent-runtime",
    displayName: "Cursor Agent",
    // The installer puts both `agent` and `cursor-agent` on disk; the longer
    // name is the one nothing else on a machine is likely to be called.
    commandName: "cursor-agent",
    optional: true,
    versionArgs: ["--version"],
    capabilityArgs: ["--help"],
    readinessArgs: ["status"],
    modelsArgs: ["--list-models"],
    parseModels: parseCursorModelList,
    requiredFeatures: CURSOR_REQUIRED_FEATURES,
    // Measured: `cursor-agent status` prints "Not logged in" and exits 0.
    readyWhen: (result) => !/not logged in/i.test(`${result.stdout}\n${result.stderr}`),
  },
  {
    id: "gemini",
    kind: "agent-runtime",
    displayName: "Gemini CLI",
    commandName: "gemini",
    optional: true,
    versionArgs: ["--version"],
    capabilityArgs: ["--help"],
    // Measured: with no auth method configured this exits 41 and names the
    // ways to sign in; signed in, it lists sessions and exits 0. It is the
    // cheapest command the CLI has that touches its credentials.
    readinessArgs: ["--list-sessions"],
    requiredFeatures: GEMINI_REQUIRED_FEATURES,
    // Also measured, after a sign-in Google then refused: the same command
    // prints "Error authenticating: IneligibleTierError ..." and exits 0. So
    // the exit code is not the whole answer here either.
    readyWhen: (result) => !/error authenticating|please set an auth method/i.test(`${result.stdout}\n${result.stderr}`),
  },
  {
    id: "opencode",
    kind: "agent-runtime",
    displayName: "OpenCode",
    commandName: "opencode",
    optional: true,
    versionArgs: ["--version"],
    capabilityArgs: ["run", "--help"],
    // MEASURED 2026-09-03: OpenCode is READY WITH NO SIGN-IN. It ships free
    // models, so there is no auth command to run and nothing that would tell
    // us anything if there were. `models` is the cheapest true statement
    // available -- it is local, it costs nothing, and a CLI that can list the
    // models it will run is a CLI that can run one.
    readinessArgs: ["models"],
    modelsArgs: ["models"],
    parseModels: parseOpenCodeModelList,
    requiredFeatures: OPENCODE_REQUIRED_FEATURES,
    readyWhen: (result) =>
      parseOpenCodeModelList(`${result.stdout}\n${result.stderr}`) !== undefined,
  },
  {
    id: "copilot",
    kind: "agent-runtime",
    displayName: "Copilot CLI",
    commandName: "copilot",
    optional: true,
    versionArgs: ["--version"],
    capabilityArgs: ["--help"],
    // MEASURED 2026-09-03, and this one is a judgement call worth spelling
    // out. Copilot CLI has NO free readiness check: whether the signed-in
    // account's plan includes the CLI is only discovered by starting a run,
    // and a run costs a premium request. Discovery will not spend the user's
    // quota to fill in a status field, so a version that prints is taken as
    // ready and the caveat below rides along. The refusal, when it comes, is
    // unmistakable and lands where the user can act on it: the run fails with
    // "Copilot plan required" and the settings URL. Reporting
    // `authentication-required` instead would hide a working route from every
    // user whose plan is fine.
    readinessArgs: ["--version"],
    requiredFeatures: COPILOT_REQUIRED_FEATURES,
    readyWhen: (result) => /copilot cli/i.test(`${result.stdout}\n${result.stderr}`),
    fixedModelHints: COPILOT_MODEL_HINTS,
    readinessCaveat: {
      code: "readiness-unverifiable",
      severity: "info",
      message:
        "Copilot CLI is installed and signed in as far as its version command can tell; "
        + "whether this account's plan includes the CLI cannot be checked without spending a premium request.",
      resolution:
        "If a run fails with a policy denial, confirm the plan at https://github.com/settings/copilot",
    },
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
  const capabilityText = succeeded(capabilityOutcome)
    ? `${capabilityOutcome.result.stdout}\n${capabilityOutcome.result.stderr}`
    : "";
  const supportedFeatures = succeeded(capabilityOutcome)
    ? detectSupportedFeatures(definition.id, capabilityText)
    : [];
  // The same help text names the models the CLI accepts; only Claude's does.
  let modelHints = definition.id === "claude" ? parseClaudeModelHints(capabilityText) : undefined;

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
    if (succeeded(readinessOutcome) && (definition.readyWhen?.(readinessOutcome.result) ?? true)) {
      readiness = "ready";
      if (definition.readinessCaveat !== undefined) {
        diagnostics.push(diagnostic(definition.readinessCaveat));
      }
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

  // A model list is read only from a signed-in runtime: measured, the
  // signed-out command prints an error instead of a list.
  if (definition.modelsArgs !== undefined && readiness === "ready") {
    const modelsOutcome = await runProbe(runner, executable, "models", definition.modelsArgs);
    if (succeeded(modelsOutcome)) {
      // Both streams, like every other probe in this file: the one model
      // listing this repo has actually captured arrived on stderr.
      modelHints = definition.parseModels?.(
        `${modelsOutcome.result.stdout}\n${modelsOutcome.result.stderr}`,
      );
      if (modelHints === undefined) {
        // A list that could not be read is not an empty list. Saying nothing
        // here would leave the picker offering one runtime no models with no
        // hint that anything went wrong.
        diagnostics.push(
          diagnostic({
            code: "capability-probe-failed",
            severity: "warning",
            message: `${definition.displayName} listed its models in a form this build does not recognise.`,
            resolution: "Its account default is still offered; update Locust if the list stays empty.",
          }),
        );
      }
    }
  }

  // A runtime with no list command to ask offers what it can honestly offer:
  // the route where the CLI chooses the model for itself.
  if (definition.fixedModelHints !== undefined && readiness === "ready") {
    modelHints = definition.fixedModelHints;
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
    ...(modelHints === undefined ? {} : { modelHints }),
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
