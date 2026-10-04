import { describe, expect, it } from "vitest";
import { createAppServerEventNormalizer } from "../src/app-server-events.js";
import type { AppServerNotification } from "../src/app-server.js";

const NOW = "2026-10-03T12:00:00.000Z";

function normalizer() {
  return createAppServerEventNormalizer({
    runId: "run_1",
    missionId: "mission_1",
    runtime: "codex",
    now: () => new Date(NOW),
  });
}

function note(method: string, params: unknown): AppServerNotification {
  return { method, params: params as never };
}

/**
 * A configWarning notification from Codex app-server carries `summary`
 * (and optional `details`), not `message`. When only `summary` is present,
 * it must become one adapter.diagnostic warning that says the summary.
 */
describe("Codex config warnings", () => {
  it("A configWarning with only summary becomes one adapter.diagnostic warning that says the summary.", () => {
    const app = normalizer();
    const events = app.accept(note("configWarning", { summary: "Model 'gpt-4' is deprecated." }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "adapter.diagnostic",
      payload: {
        level: "warning",
        code: "app.warning",
        message: "Model 'gpt-4' is deprecated.",
        terminal: false,
      },
    });
  });

  it("A configWarning with details includes the details line after the summary.", () => {
    const app = normalizer();
    const events = app.accept(
      note("configWarning", {
        summary: "Model 'gpt-4' is deprecated.",
        details: "Please switch to gpt-5 in config.toml.",
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "adapter.diagnostic",
      payload: {
        level: "warning",
        code: "app.warning",
        message: "Model 'gpt-4' is deprecated.\nPlease switch to gpt-5 in config.toml.",
        terminal: false,
      },
    });
  });

  it("A warning with message still works as before.", () => {
    const app = normalizer();
    const events = app.accept(note("warning", { message: "Disk space is low." }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "adapter.diagnostic",
      payload: {
        level: "warning",
        code: "app.warning",
        message: "Disk space is low.",
        terminal: false,
      },
    });
  });

  it("A guardianWarning with message still works as before.", () => {
    const app = normalizer();
    const events = app.accept(note("guardianWarning", { message: "Guardian policy warning." }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "adapter.diagnostic",
      payload: {
        level: "warning",
        code: "app.warning",
        message: "Guardian policy warning.",
        terminal: false,
      },
    });
  });

  it("A configWarning with legacy message still works.", () => {
    const app = normalizer();
    const events = app.accept(note("configWarning", { message: "Legacy config warning." }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "adapter.diagnostic",
      payload: {
        level: "warning",
        code: "app.warning",
        message: "Legacy config warning.",
        terminal: false,
      },
    });
  });

  it("A configWarning without summary or message is dropped.", () => {
    const app = normalizer();
    expect(app.accept(note("configWarning", { details: "Details without summary" }))).toEqual([]);
    expect(app.accept(note("configWarning", {}))).toEqual([]);
  });
});
