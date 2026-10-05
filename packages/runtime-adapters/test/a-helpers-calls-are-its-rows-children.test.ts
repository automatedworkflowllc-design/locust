import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createClaudeEventNormalizer } from "../src/claude-events.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";

/*
 * A HELPER'S OWN CALLS ARE ITS ROW'S CHILDREN (helper visibility, 2026-10-05).
 *
 * Colin: "users are probably going to want to inspect when one of the
 * 'helpers/agents' is sent out." The adapter read a helper's records only to
 * drop them, so its row said what it was asked and what it came back with.
 *
 * `fixtures/claude/helper-calls.jsonl` was recorded for this on 2026-10-05:
 * Claude Code 2.1.x on Haiku 4.5, `claude -p --output-format stream-json
 * --verbose --include-partial-messages --permission-mode acceptEdits`, in a
 * folder of five files, asked to "use a helper (the Agent tool, an Explore
 * helper) to count the files in this folder". It sent the helper to the
 * background; the helper made one Glob and reported 5 files. The init records
 * are trimmed to what the adapter reads and the folder's path is replaced.
 */

const fixture = (name: string): readonly string[] =>
  readFileSync(new URL(`./fixtures/claude/${name}`, import.meta.url), "utf8").trimEnd().split("\n");

function normalize(lines: readonly string[]): readonly NormalizedRuntimeEvent[] {
  const n = createClaudeEventNormalizer({ runId: "run_1", missionId: "mission_1", now: () => new Date("2026-10-05T05:00:00.000Z") });
  return lines.flatMap((raw, index) => n.accept({ sequence: index + 1, raw }));
}

const parentOf = (event: NormalizedRuntimeEvent): string | undefined =>
  (event.payload as { readonly parentItemId?: string }).parentItemId;

/** An event with what changes run to run taken out: its id and its place in the count. */
const shape = (event: NormalizedRuntimeEvent): unknown => ({ type: event.type, payload: { ...event.payload, evidence: undefined } });

const AGENT = "toolu_01MrF76nyTfdvLaECwMtcA7V";
const GLOB = "toolu_0134dcHNk1GH8kL57hFJ7THL";

describe("a Claude Code helper's own calls", () => {
  const recorded = fixture("helper-calls.jsonl");

  it("arrive as children of the helper's row, opened and closed, named as the teammate's are", () => {
    const children = normalize(recorded).filter((event) => parentOf(event) !== undefined);
    expect(children.map((event) => [event.type, (event.payload as { readonly itemId: string }).itemId, parentOf(event)])).toEqual([
      ["tool.started", GLOB, AGENT],
      ["tool.completed", GLOB, AGENT],
    ]);
    expect(children[0]).toMatchObject({ payload: { name: "Glob", command: "**/*", phase: "started" } });
    // What it found, as the teammate's own Glob carries it.
    expect(children[1]).toMatchObject({ payload: { name: "Glob", phase: "completed" } });
    expect(String((children[1]!.payload as { readonly output?: unknown }).output)).toContain("notes.md");
  });

  it("leave the teammate's own items exactly as a stream without the helper's records draws them", () => {
    const own = normalize(recorded).filter((event) => parentOf(event) === undefined);
    const withoutHelper = normalize(recorded.filter((raw) => {
      const parent = (JSON.parse(raw) as { readonly parent_tool_use_id?: unknown }).parent_tool_use_id;
      return typeof parent !== "string" || parent.length === 0;
    }));
    expect(own.map(shape)).toEqual(withoutHelper.map(shape));
    // And the helper's row is the Agent call, typed while it works.
    expect(own.filter((event) => event.type.startsWith("tool.")).map((event) => (event.payload as { readonly itemId: string }).itemId)).toEqual([AGENT, AGENT, AGENT]);
    expect(own.find((event) => event.type === "tool.started" && (event.payload as { readonly command?: string }).command !== undefined)).toMatchObject({ payload: { name: "Agent", status: "Explore" } });
  });

  it("are nothing at all in a stream where no helper ran", () => {
    const events = normalize(fixture("background-stopped-with-run.jsonl"));
    expect(events.length).toBeGreaterThan(0);
    expect(events.filter((event) => parentOf(event) !== undefined)).toEqual([]);
  });
});
