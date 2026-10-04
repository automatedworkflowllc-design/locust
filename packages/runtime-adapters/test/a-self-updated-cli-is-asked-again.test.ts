import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fingerprintOf } from "../src/discovery.js";

/*
 * A B4 lead from the code review, settled: a script launcher stays put while
 * the CLI behind it updates itself, so the cached version and help text were
 * keyed on a file that never changed. The shapes are this machine's own
 * Cursor and Muse installs.
 */
describe("the facts cache key of a script launcher", () => {
  const folder = join("C:", "Users", "x", "AppData", "Local", "cursor-agent");
  const launch = { commandName: "cursor-agent", discoveredPath: join(folder, "cursor-agent.cmd"), executablePath: join(folder, "cursor-agent.cmd"), prefixArgs: [], kind: "cmd-shim" } as never;
  const stats = (versionsTime: number) => async (path: string) => {
    if (path === join(folder, "versions")) return { size: 0, mtimeMs: versionsTime };
    if (path === join(folder, "cursor-agent.cmd") || path === folder) return { size: 363, mtimeMs: 1 };
    throw new Error("absent");
  };

  it("changes when a new version lands beside an unchanged launcher", async () => {
    const before = await fingerprintOf(launch, stats(100));
    const after = await fingerprintOf(launch, stats(200));
    expect(before).toBeDefined();
    expect(after).not.toBe(before);
  });
});
