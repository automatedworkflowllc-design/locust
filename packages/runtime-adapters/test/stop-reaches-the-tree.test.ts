import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createNodeRuntimeProcessRunner } from "../src/index.js";

/**
 * Stopping a run stops what the run STARTED.
 *
 * MEASURED 2026-09-14 by Astra, on the installed app: it asked for one Node
 * command that writes `STOP_STARTED.txt`, waits ninety seconds, then writes
 * `STOP_FINISHED.txt`, and stopped the run at eighteen seconds. Both files
 * were in the workspace afterwards. The command was never stopped -- it ran
 * to completion and wrote into the person's folder a minute and a half after
 * they stopped it, while the card told them nothing had been in flight.
 *
 * The claim was fixed in 0.102.0. This is the other half.
 *
 * Why it happens: `requestTermination` sends SIGINT and only calls
 * `killProcessTree` after `cancellationGraceMs`, in the FORCED path. A CLI
 * that obeys SIGINT exits first, the run settles, the force timer is
 * cancelled -- and the grandchild it spawned is orphaned and keeps going.
 *
 * This test spawns that exact shape with real processes: a parent that starts
 * a detached grandchild which writes a file after a delay, then exits at once
 * on SIGINT. No CLI, no model, nothing to spend.
 */
describe("a stop reaches the whole tree", () => {
  it("kills a grandchild the run started, not just the process it launched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "locust-stop-tree-"));
    const marker = join(dir, "grandchild-finished.txt");
    const grandchild = join(dir, "grandchild.cjs");
    const parent = join(dir, "parent.cjs");
    try {
      // Writes the marker after a delay: this is the command a person stopped.
      writeFileSync(
        grandchild,
        [
          "const fs = require('node:fs')",
          `setTimeout(() => { fs.writeFileSync(${JSON.stringify(marker)}, 'finished') }, 4000)`,
        ].join("\n"),
        "utf8",
      );
      // Starts it and then dies politely, which is what a well-behaved CLI does.
      writeFileSync(
        parent,
        [
          "const { spawn } = require('node:child_process')",
          `const child = spawn(process.execPath, [${JSON.stringify(grandchild)}], { detached: true, stdio: 'ignore' })`,
          "child.unref()",
          "process.stdout.write('{\"type\":\"ready\"}\\n')",
          "process.on('SIGINT', () => process.exit(0))",
          "setTimeout(() => process.exit(0), 30000)",
        ].join("\n"),
        "utf8",
      );

      const runner = createNodeRuntimeProcessRunner({ cancellationGraceMs: 50 });
      const stop = new AbortController();
      const run = runner.start(
        {
          runtime: "codex",
          executablePath: process.execPath,
          args: [parent],
          // NOT the scratch directory: a live process holding it as its cwd
          // makes the cleanup below fail with EPERM and mask the result. The
          // temp ROOT is never removed, so nothing can hold it open.
          cwd: tmpdir(),
          stdin: "prompt",
          stdout: "jsonl",
        },
        "prompt",
        { signal: stop.signal },
      );

      // Wait for the grandchild to exist before stopping, so this measures a
      // stop DURING work rather than a race with the launch.
      for await (const _record of run.records) break;
      // What pressing Stop does.
      stop.abort();
      await run.completion.catch(() => undefined);

      // The grandchild's own delay, plus room: if the stop did not reach it,
      // the marker appears in here.
      await new Promise((resolve) => setTimeout(resolve, 6000));
      expect(existsSync(marker), "the stopped run's own command finished anyway").toBe(false);
    } finally {
      // Best effort: a cleanup failure must never be reported as the finding.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // A surviving grandchild can hold a handle here, which is itself the
        // thing under test and is already asserted above.
      }
    }
  }, 30_000);
});
