import { describe, expect, it } from "vitest";

import { createOpenCodeServeCommand } from "../src/commands.js";
import { createOpenCodeEventNormalizer } from "../src/opencode-events.js";
import { startOpenCodeServeRun } from "../src/opencode-serve-run.js";
import type { AppServerRunProcess } from "../src/codex-app-server-run.js";
import type { NormalizedRuntimeEvent } from "../src/codex-events.js";

/*
 * A BUSY MODEL SAYS SO IN SERVER MODE TOO (0.369).
 *
 * 0.368 reads OpenCode's log for a provider that is turning requests away.
 * Approve each runs OpenCode as a server instead, and the server says the
 * same thing as an event -- `session.status` with `type: "retry"` and what
 * the provider answered (opencode 1.18.27, the free Ling model, 2026-09-26).
 * That event was ignored, so the 0.368 sweep's opencode-approve-each sat on
 * "Starting" for six minutes on a busy free model with nothing said.
 */
const SESSION = "ses_busy";
const EXECUTABLE = { executablePath: "C:/tools/opencode.exe", prefixArgs: [] as readonly string[] };
const status = (value: Record<string, unknown>) => JSON.stringify({ type: "session.status", properties: { sessionID: SESSION, status: value } });
const EVENTS = [
  status({ type: "busy" }),
  status({ type: "retry", attempt: 1, message: "Rate limit exceeded. Please try again later.", next: 0 }),
  status({ type: "retry", attempt: 2, message: "Rate limit exceeded. Please try again later.", next: 0 }),
  JSON.stringify({ type: "session.idle", properties: { sessionID: SESSION } }),
];

function fakeServer() {
  let prompted!: () => void;
  const promptSent = new Promise<void>((resolve) => { prompted = resolve; });
  const spawn = (): AppServerRunProcess => ({
    write: () => undefined,
    kill: () => undefined,
    onData: (listener) => { setTimeout(() => listener("opencode server listening on http://127.0.0.1:4096\n"), 0); },
    onExit: () => undefined,
  });
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/event")) {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          await promptSent;
          for (const line of EVENTS) controller.enqueue(encoder.encode(`data: ${line}\n\n`));
        },
      }), { status: 200 });
    }
    if (url.endsWith("/session")) return Response.json({ id: SESSION });
    if (url.endsWith("/prompt_async")) {
      prompted();
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { spawn, fetcher };
}

describe("a busy model, through OpenCode's server", () => {
  it("is said once, in the provider's words, with the way on", async () => {
    const server = fakeServer();
    const run = startOpenCodeServeRun({
      spawn: server.spawn,
      command: createOpenCodeServeCommand(EXECUTABLE, { workspacePath: "C:/work/pebble" }),
      prompt: "Say hello.",
      model: "opencode/ling-3.0-flash-fin-free",
      fetch: server.fetcher,
    });
    const normalizer = createOpenCodeEventNormalizer({ runId: "run_1", missionId: "mission_1", cliVersion: "1.18.27" });
    const events: NormalizedRuntimeEvent[] = [];
    for await (const record of run.records) events.push(...normalizer.accept(record));
    await run.completion;

    const said = events.filter((event) => event.type === "adapter.diagnostic");
    expect(said).toHaveLength(1);
    const message = said[0]?.type === "adapter.diagnostic" ? said[0].payload.message : "";
    expect(said[0]).toMatchObject({ payload: { level: "warning", code: "opencode.runtime_error" } });
    expect(message).toContain('"Rate limit exceeded. Please try again later."');
    expect(message).toContain("press Stop and pick another model");
  }, 10_000);
});
