import { describe, expect, it } from "vitest";

import { discoverInstalledRuntimes } from "./discovery.js";
import type { ProbeCommand } from "./types.js";

/**
 * One runtime's probes run at once, and a command is not spawned twice.
 *
 * `discoverOne` ran version, help, readiness and the model list strictly in
 * sequence, and none of them needs another's output. MEASURED on Colin's
 * machine, 2026-09-21: each `cursor-agent` probe is 1.1-1.6 s warm, so the
 * sequence was ~5.1 s where the slowest alone is 1.6 s. And OpenCode's
 * readiness command IS its model-list command (`models`), which was spawned
 * twice per sweep. Fable's probing review, #3.
 */

/** A locator that finds every runtime, so every probe is actually run. */
const everything = { find: async () => ({ executablePath: "C:/fake/bin.exe", prefixArgs: [] }) } as never;

function recordingRunner(ms: number) {
  const calls: ProbeCommand[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    calls,
    peak: () => peak,
    runner: {
      run: async (command: ProbeCommand) => {
        calls.push(command);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, ms));
        inFlight -= 1;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    },
  };
}

describe("one runtime's probes run at once", () => {
  it("overlaps the probes of a single runtime rather than queueing them", async () => {
    const { runner, peak } = recordingRunner(40);
    // ONE definition at a time is what the stagger already guarantees at
    // 240 ms; with a 40 ms probe and a 0 ms stagger, overlap between
    // runtimes is possible too, so the peak is read against the probes of a
    // single runtime by giving the stagger room: a beat longer than a probe.
    await discoverInstalledRuntimes({ runner, locator: everything, staggerMs: 60 });
    // Version, capability and readiness -- three at least -- in flight
    // together for one runtime.
    expect(peak()).toBeGreaterThanOrEqual(3);
  });

  it("spawns a command that is both readiness and model list ONCE", async () => {
    const { runner, calls } = recordingRunner(0);
    await discoverInstalledRuntimes({ runner, locator: everything, staggerMs: 0 });
    const models = calls.filter((command) => command.args.length === 1 && command.args[0] === "models");
    // OpenCode: `models` is its readiness probe and its model list. One spawn.
    expect(models).toHaveLength(1);
    expect(models[0]?.purpose).toBe("readiness");
  });

  it("still asks a runtime with a separate list command for its list, once", async () => {
    const { runner, calls } = recordingRunner(0);
    await discoverInstalledRuntimes({ runner, locator: everything, staggerMs: 0 });
    const listed = calls.filter((command) => command.args.includes("--list-models"));
    expect(listed).toHaveLength(1);
    expect(listed[0]?.purpose).toBe("models");
  });
});
