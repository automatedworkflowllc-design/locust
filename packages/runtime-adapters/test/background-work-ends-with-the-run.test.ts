import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { backgroundEnding, createClaudeEventNormalizer } from "../src/index.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";

/**
 * BACKGROUND WORK ENDS WITH THE RUN, and the row for it has to say so.
 *
 * The first real Claude Code recording in this repo:
 * `fixtures/claude/background-stopped-with-run.jsonl`, captured 2026-09-22
 * from Claude Code 2.1.280 on Haiku with Locust's own flags, asked to run
 * `sleep 8 && echo finished > out.txt` in the background and reply. Cut down
 * to what the run did -- the connector list, local paths, thinking
 * signatures and account usage are gone -- and otherwise as it arrived.
 *
 * What it shows: Claude started the job (`task_started`, `is_backgrounded:
 * true`), replied, printed its `result`, and only then sent `task_updated
 * {status: "killed"}` and `task_notification {status: "stopped"}`. out.txt
 * was never written. The adapter used to read every task record as a
 * SUBAGENT, so the job's start became the live line and its end landed on
 * an item called `subagent:bstjk1w0l` that no row is keyed by.
 */
const CALL = "toolu_016MCbGpcf7wkMy2eHrDb6LC";

function replay(raw: string): readonly NormalizedRuntimeEvent[] {
  const claude = createClaudeEventNormalizer({ runId: "run_1", now: () => new Date("2026-09-22T22:06:00.000Z") });
  const events: NormalizedRuntimeEvent[] = [];
  raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .forEach((line, index) => events.push(...claude.accept({ sequence: index + 1, raw: line })));
  return events;
}

const recording = (): string =>
  readFileSync(new URL("./fixtures/claude/background-stopped-with-run.jsonl", import.meta.url), "utf8");

const steps = (events: readonly NormalizedRuntimeEvent[], type: "step.started" | "step.completed" | "step.failed") =>
  events.flatMap((event) => (event.type === type ? [event.payload] : []));

describe("background work ends with the run", () => {
  it("is keyed by the call that started it, not filed as a subagent", () => {
    const events = replay(recording());
    const all = [...steps(events, "step.started"), ...steps(events, "step.completed"), ...steps(events, "step.failed")];
    expect(all.some((step) => step.itemId?.startsWith("subagent:") === true)).toBe(false);
    const began = steps(events, "step.started").find((step) => step.itemType === "background");
    expect(began).toMatchObject({ stepKind: "item", itemId: CALL, status: "running" });
    expect(began?.message).toBe("Background task: sleep 8 seconds then write to out.txt");
  });

  it("says it was stopped when the run ended, because that is when it came", () => {
    const events = replay(recording());
    const ended = steps(events, "step.completed").find((step) => step.itemType === "background");
    expect(ended).toMatchObject({ stepKind: "item", itemId: CALL, status: "stopped-with-run" });
    // And that arrives after the run's own answer, which is how it is told apart.
    const resultAt = events.findIndex((event) => event.type === "message.delta" && event.payload.final);
    const endedAt = events.findIndex((event) => event.type === "step.completed" && event.payload.itemType === "background");
    expect(endedAt).toBeGreaterThan(resultAt);
  });

  it("the call itself carries the flag, its command and what it was for", () => {
    const events = replay(recording());
    const call = events.find((event) => event.type === "tool.completed" && event.payload.itemId === CALL);
    expect(call?.type === "tool.completed" ? call.payload : undefined).toMatchObject({
      name: "Bash",
      command: "sleep 8 && echo finished > out.txt",
      title: "Background task: sleep 8 seconds then write to out.txt",
      background: true,
    });
  });

  it("the restated task list opens nothing", () => {
    // `background_tasks_changed` fell through to "a turn opened", twice per
    // run and once after the answer.
    const events = replay(recording());
    expect(steps(events, "step.started").some((step) => step.status === "background_tasks_changed")).toBe(false);
  });

  it("work that finishes while the run is going says completed", () => {
    // The same recording with the ending moved before the answer and
    // reported as finished -- what a run that waited long enough would see.
    const lines = recording().split("\n").filter((line) => line.trim().length > 0);
    const notice = lines.findIndex((line) => line.includes('"task_notification"'));
    const result = lines.findIndex((line) => line.includes('"type": "result"') || line.includes('"type":"result"'));
    expect(notice).toBeGreaterThan(result);
    const finished = lines[notice]!.replace('"status": "stopped"', '"status": "completed"');
    const reordered = [...lines.slice(0, result), finished, ...lines.slice(result, notice)];
    const ended = steps(replay(reordered.join("\n")), "step.completed").find((step) => step.itemType === "background");
    expect(ended?.status).toBe("completed");
  });

  it("a helper that was not backgrounded is still a helper", () => {
    const claude = createClaudeEventNormalizer({ runId: "run_2" });
    const started = claude.accept({
      sequence: 1,
      raw: JSON.stringify({ type: "system", subtype: "task_started", task_id: "a1", tool_use_id: "toolu_agent", subagent_type: "Explore", description: "Find the config" }),
    });
    expect(started[0]?.type === "step.started" ? started[0].payload : undefined).toMatchObject({
      itemId: "subagent:a1",
      itemType: "subagent",
    });
  });
});

describe("how background work ended, in the row's words", () => {
  it("tells the run ending apart from a stop somebody chose", () => {
    expect(backgroundEnding("stopped", true)).toBe("stopped-with-run");
    expect(backgroundEnding("killed", true)).toBe("stopped-with-run");
    expect(backgroundEnding("stopped", false)).toBe("stopped");
    expect(backgroundEnding("completed", true)).toBe("completed");
    expect(backgroundEnding("failed", false)).toBe("failed");
    expect(backgroundEnding(undefined, true)).toBe("ended");
  });
});
