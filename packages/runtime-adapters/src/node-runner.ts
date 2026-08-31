import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import type { CommandResult, CommandRunner, ProbeCommand } from "./types.js";

interface ProbeReadable {
  on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown;
}

export interface SpawnedProbeProcess {
  readonly stdout: ProbeReadable;
  readonly stderr: ProbeReadable;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (exitCode: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type ProbeSpawn = (
  executablePath: string,
  args: readonly string[],
  options: {
    readonly shell: false;
    readonly windowsHide: true;
    readonly stdio: ["ignore", "pipe", "pipe"];
  },
) => SpawnedProbeProcess;

export interface NodeProbeRunnerOptions {
  readonly maxOutputBytes?: number;
  readonly maximumTimeoutMs?: number;
  readonly killGraceMs?: number;
  /** Test seam; production callers should leave this undefined. */
  readonly spawnProcess?: ProbeSpawn;
}

interface BoundedOutput {
  readonly chunks: Uint8Array[];
  keptBytes: number;
}

function appendBounded(output: BoundedOutput, chunk: Uint8Array | string, limit: number): void {
  const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
  const remaining = limit - output.keptBytes;
  if (remaining <= 0) return;
  const kept = bytes.subarray(0, remaining);
  output.chunks.push(kept);
  output.keptBytes += kept.byteLength;
}

function outputText(output: BoundedOutput): string {
  return Buffer.concat(output.chunks, output.keptBytes).toString("utf8");
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return resolved;
}

const defaultSpawn: ProbeSpawn = (executablePath, args, options) =>
  spawn(executablePath, args, options) as unknown as SpawnedProbeProcess;

/**
 * Executes bounded discovery probes only. It never invokes a shell, accepts an
 * environment override, or executes a mission prompt.
 */
export function createNodeProbeRunner(options: NodeProbeRunnerOptions = {}): CommandRunner {
  const maxOutputBytes = positiveInteger(options.maxOutputBytes, 64 * 1024, "maxOutputBytes");
  const maximumTimeoutMs = positiveInteger(options.maximumTimeoutMs, 10_000, "maximumTimeoutMs");
  const killGraceMs = positiveInteger(options.killGraceMs, 500, "killGraceMs");
  const spawnProcess = options.spawnProcess ?? defaultSpawn;

  return {
    run(command: ProbeCommand): Promise<CommandResult> {
      if (!isAbsolute(command.executablePath)) {
        return Promise.reject(new Error("Probe executable path must be absolute"));
      }
      if (command.args.some((argument) => argument.includes("\0"))) {
        return Promise.reject(new Error("Probe arguments cannot contain NUL bytes"));
      }

      const timeoutMs = Math.min(
        positiveInteger(command.timeoutMs, maximumTimeoutMs, "timeoutMs"),
        maximumTimeoutMs,
      );

      return new Promise((resolve, reject) => {
        const stdout: BoundedOutput = { chunks: [], keptBytes: 0 };
        const stderr: BoundedOutput = { chunks: [], keptBytes: 0 };
        let timedOut = false;
        let settled = false;
        let forceTimer: ReturnType<typeof setTimeout> | undefined;

        const child = spawnProcess(command.executablePath, command.args, {
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const finish = (exitCode: number | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          if (forceTimer !== undefined) clearTimeout(forceTimer);
          const result: CommandResult = {
            exitCode,
            stdout: outputText(stdout),
            stderr: outputText(stderr),
          };
          resolve(timedOut ? { ...result, timedOut: true } : result);
        };

        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          forceTimer = setTimeout(() => {
            child.kill("SIGKILL");
            finish(null);
          }, killGraceMs);
        }, timeoutMs);

        child.stdout.on("data", (chunk) => appendBounded(stdout, chunk, maxOutputBytes));
        child.stderr.on("data", (chunk) => appendBounded(stderr, chunk, maxOutputBytes));
        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          if (forceTimer !== undefined) clearTimeout(forceTimer);
          reject(error);
        });
        child.once("close", finish);
      });
    },
  };
}
