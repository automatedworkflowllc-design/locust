import { describe, expect, it } from "vitest";

import { discoverInstalledRuntimes } from "./discovery.js";

/**
 * Discovery reports as it happens, one probe at a time.
 *
 * Two rules from the boot-screen handoff (2026-09-15), and they are the two
 * that decide whether that screen can exist at all:
 *
 * **`probe.started` fires before the subprocess is spawned.** The whole
 * value of the screen is the gap between issuing a command and its answer.
 * If both events arrive together there is nothing to show during the wait,
 * and the screen can only say "checking…" and then jump — which is exactly
 * what it did before this.
 *
 * **Probes run sequentially.** Raced, five rows appear at once, five elapsed
 * counters tick together, and a log meant to be read becomes noise. Sequential
 * is also what a person would do by hand, which is what makes it legible.
 * The cost is a few hundred milliseconds, spent against a screen whose only
 * job is to fill that time.
 *
 * Both are asserted against the ORDER OF EVENTS rather than against the
 * source, because both are claims about what happens at runtime.
 */

/** A locator that finds nothing: the probe path still runs, just faster. */
const locator = { find: async () => undefined };

describe("discovery as it happens", () => {
  it("says a probe started before that probe can have finished", async () => {
    const order: string[] = [];
    await discoverInstalledRuntimes({
      runner: { run: async () => ({ stdout: "", stderr: "", exitCode: 0 }) } as never,
      locator: locator as never,
      watch: {
        started: (runtime) => order.push(`started:${runtime.id}`),
        finished: (runtime) => order.push(`finished:${runtime.id}`),
      },
    });

    expect(order.length).toBeGreaterThan(0);
    // Every `started` is immediately followed by its own `finished`, and
    // never by another runtime's: that is sequential, stated as a shape.
    for (let index = 0; index < order.length; index += 2) {
      const started = order[index] ?? "";
      const finished = order[index + 1] ?? "";
      expect(started.startsWith("started:")).toBe(true);
      expect(finished).toBe(started.replace("started:", "finished:"));
    }
  });

  it("never has two probes in flight at once", async () => {
    let live = 0;
    let mostAtOnce = 0;
    await discoverInstalledRuntimes({
      runner: {
        run: async () => {
          // A real gap, so an overlapping implementation would show one.
          await new Promise((resolve) => setTimeout(resolve, 1));
          return { stdout: "", stderr: "", exitCode: 0 };
        },
      } as never,
      locator: locator as never,
      watch: {
        started: () => {
          live += 1;
          mostAtOnce = Math.max(mostAtOnce, live);
        },
        finished: () => {
          live -= 1;
        },
      },
    });

    expect(mostAtOnce).toBe(1);
  });

  it("names the binary it is about to run, not the product", async () => {
    // The screen shows the command truthfully -- `claude`, not "Claude Code"
    // -- because a terminal that prints a name nothing would run is a prop.
    // The product name arrives at the settle, and both are carried here.
    const seen: { id: string; bin: string; displayName: string }[] = [];
    await discoverInstalledRuntimes({
      runner: { run: async () => ({ stdout: "", stderr: "", exitCode: 0 }) } as never,
      locator: locator as never,
      watch: { started: (runtime) => seen.push(runtime), finished: () => undefined },
    });

    expect(seen.length).toBeGreaterThan(0);
    for (const runtime of seen) {
      expect(runtime.bin.length).toBeGreaterThan(0);
      expect(runtime.displayName.length).toBeGreaterThan(0);
    }
  });

  it("still answers with every runtime when nobody is watching", async () => {
    // The watcher is an observer, never a condition of the sweep.
    const found = await discoverInstalledRuntimes({
      runner: { run: async () => ({ stdout: "", stderr: "", exitCode: 0 }) } as never,
      locator: locator as never,
    });
    expect(found.length).toBeGreaterThan(0);
  });
});
