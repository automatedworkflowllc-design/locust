import { describe, expect, it } from "vitest";

import { discoverInstalledRuntimes } from "./discovery.js";

/**
 * Discovery reports as it happens, one probe at a time.
 *
 * **`probe.started` fires before the subprocess is spawned.** The whole
 * value of the boot screen is the gap between issuing a command and its
 * answer. If both events arrive together there is nothing to show during the
 * wait, and the screen can only say "checking…" and then jump — which is
 * exactly what it did before this.
 *
 * **Probes START one at a time, in order.** Raced, every row appears at once,
 * every elapsed counter ticks together, and a log meant to be read is noise.
 *
 * They are no longer strictly SEQUENTIAL, and the reason is measured. The
 * handoff asked for sequential on the stated assumption that "the total cost
 * is a few hundred ms". On Colin's own machine, where the runtimes are
 * actually installed, `cursor-agent` ran past six seconds — and strictly
 * sequential makes the total the SUM, so the slowest runtime became
 * everybody else's wait on every launch. He felt it immediately: *"maybe its
 * taking so long because its not realizing the runtimes are connected?"*
 *
 * The stagger keeps what sequential was FOR (rows arriving one at a time, in
 * order) and drops what it cost (the sum).
 */

/** A locator that finds nothing: the probe path still runs, just faster. */
const locator = { find: async () => undefined };

const slowRunner = (ms: number) =>
  ({
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  }) as never;

const instantRunner = { run: async () => ({ stdout: "", stderr: "", exitCode: 0 }) } as never;

describe("discovery as it happens", () => {
  it("never reports a probe finished before it reported it started", async () => {
    const order: string[] = [];
    await discoverInstalledRuntimes({
      runner: instantRunner,
      locator: locator as never,
      watch: {
        started: (runtime) => order.push(`started:${runtime.id}`),
        finished: (runtime) => order.push(`finished:${runtime.id}`),
      },
    });

    expect(order.length).toBeGreaterThan(0);
    const startedAt = new Map<string, number>();
    order.forEach((entry, index) => {
      const [phase, id = ""] = entry.split(":");
      if (phase === "started") startedAt.set(id, index);
      else {
        expect(startedAt.has(id), `${entry} arrived with no start`).toBe(true);
        expect(index).toBeGreaterThan(startedAt.get(id) ?? Number.MAX_SAFE_INTEGER);
      }
    });
  });

  it("starts them one at a time, in order, however slow they are", async () => {
    // The log's legibility is about the ORDER things begin in, not about
    // whether they overlap. A slow probe must not hold up the next START.
    const starts: number[] = [];
    await discoverInstalledRuntimes({
      runner: slowRunner(60),
      locator: locator as never,
      staggerMs: 5,
      watch: { started: () => starts.push(Date.now()), finished: () => undefined },
    });

    expect(starts.length).toBeGreaterThan(2);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index]).toBeGreaterThanOrEqual(starts[index - 1] ?? 0);
    }
    // The last start lands long before the sum of the probe times, which is
    // the whole point: a slow runtime delays nobody else's row.
    expect((starts.at(-1) ?? 0) - (starts[0] ?? 0)).toBeLessThan(60 * starts.length);
  });

  it("does not make the total the sum of every probe", async () => {
    const began = Date.now();
    await discoverInstalledRuntimes({
      runner: slowRunner(50),
      locator: locator as never,
      staggerMs: 2,
      watch: { started: () => undefined, finished: () => undefined },
    });
    // Seven definitions at 50ms each is 350ms sequentially; overlapping it
    // is about one probe plus the stagger.
    expect(Date.now() - began).toBeLessThan(250);
  });

  it("names the binary it is about to run, and its id, which are not the same", async () => {
    /*
     * Cursor's id is `cursor` and its command is `cursor-agent`, and that
     * difference cost a real defect: the screen keyed rows by one and
     * results by the other, so Cursor sat on "still waiting" while the table
     * underneath showed it green. Both travel on the event.
     */
    const seen: { id: string; bin: string; displayName: string }[] = [];
    await discoverInstalledRuntimes({
      runner: instantRunner,
      locator: locator as never,
      watch: { started: (runtime) => seen.push(runtime), finished: () => undefined },
    });

    expect(seen.length).toBeGreaterThan(0);
    for (const runtime of seen) {
      expect(runtime.id.length).toBeGreaterThan(0);
      expect(runtime.bin.length).toBeGreaterThan(0);
      expect(runtime.displayName.length).toBeGreaterThan(0);
    }
    const cursor = seen.find((runtime) => runtime.id === "cursor");
    expect(cursor?.bin).toBe("cursor-agent");
  });

  it("still answers with every runtime when nobody is watching", async () => {
    // The watcher is an observer, never a condition of the sweep.
    const found = await discoverInstalledRuntimes({ runner: instantRunner, locator: locator as never });
    expect(found.length).toBeGreaterThan(0);
  });
});
