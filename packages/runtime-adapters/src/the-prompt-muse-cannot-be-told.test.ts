import { describe, expect, it } from "vitest";

import {
  createMuseExecCommand,
  PROMPT_FILE_PLACEHOLDER,
} from "./commands.js";
import type { ExecutableLaunch } from "./types.js";

/**
 * Muse Code takes the prompt in a FILE, and that is forced, not chosen.
 *
 * MEASURED on Windows 2026-09-21 against 1.3.0-R3401.1:
 *
 *   - piping the prompt in exits 2 with `usage: muse exec [OPTIONS] [PROMPT]`,
 *     so the stdin escape OpenCode uses is not available here;
 *   - `muse` on PATH is `muse.cmd`, a PowerShell launcher that is neither npm
 *     shim shape `path-locator` unwraps, so it keeps its shell and `cmd.exe`
 *     caps the command line at 8,191 characters.
 *
 * Those two together are a failure this project has already had once. On
 * 2026-09-17 a 1,200-character peer reply quoted inside a 2,215-character
 * standing brief came to about 7,500 characters, `command-length.ts` refused
 * it, and the person never got their report. OpenCode escaped through stdin.
 * Muse cannot, so the prompt goes in a file.
 */
const launch: ExecutableLaunch = {
  commandName: "muse",
  discoveredPath: "C:\\Users\\x\\AppData\\Local\\Programs\\muse\\muse.cmd",
  executablePath: "C:\\Windows\\System32\\cmd.exe",
  prefixArgs: ["/d", "/s", "/c", "C:\\Users\\x\\AppData\\Local\\Programs\\muse\\muse.cmd"],
} as unknown as ExecutableLaunch;

const build = (options: Record<string, unknown> = {}) =>
  createMuseExecCommand(launch, {
    workspacePath: "C:\\work",
    prompt: "Reply with exactly PING",
    ...options,
  } as never);

describe("the prompt Muse cannot be told", () => {
  it("names where the prompt file path goes, and never puts the prompt in argv", () => {
    const spec = build();
    expect(spec.stdin).toBe("prompt-file");
    expect(spec.args).toContain(PROMPT_FILE_PLACEHOLDER);
    // The whole point: a 40,000-character brief must not widen the command
    // line by a single character.
    const long = build({ prompt: "x".repeat(40_000) });
    expect(long.args.join(" ")).not.toContain("xxxx");
    expect(long.args.join(" ").length).toBe(spec.args.join(" ").length);
  });

  it("still refuses to build a run with nothing to say", () => {
    // A mission with an empty prompt hangs rather than failing, which is the
    // worst shape of all.
    expect(() => build({ prompt: "" })).toThrow();
  });

  it("holds a read-only run with the flags that actually hold it", () => {
    const spec = build({ sandbox: "read-only" });
    expect(spec.args).toContain("--disable-write");
    expect(spec.args).toContain("--disable-shell");
    // Read-only must never be the run that stops asking permission.
    expect(spec.args).not.toContain("--approval-mode");
  });

  it("lets a writing run finish without waiting for an approval nobody can give", () => {
    const spec = build({ sandbox: "workspace-write" });
    expect(spec.args.join(" ")).toContain("--approval-mode never");
    expect(spec.args).not.toContain("--disable-write");
    // `--yolo` also disables the sandbox and trusts the workspace. Three
    // decisions in one flag is not a flag this app passes.
    expect(spec.args).not.toContain("--yolo");
    expect(spec.args).not.toContain("--disable-sandbox");
  });

  it("refuses an effort the CLI would reject the whole run for", () => {
    // Measured from `muse exec --help`: none|minimal|low|medium|high|xhigh|
    // max|ultra. Dropping an unknown one silently would leave a person
    // believing a setting they were shown had been applied.
    expect(build({ effort: "xhigh" }).args.join(" ")).toContain("--reasoning-effort xhigh");
    expect(() => build({ effort: "blistering" })).toThrow(/reasoning effort/i);
  });

  it("continues a conversation by its own session id", () => {
    const spec = build({ resumeThreadId: "01a0c5fc-bc34-7583-8bce-9e480f66e20b" });
    expect(spec.args.join(" ")).toContain("--session-id 01a0c5fc-bc34-7583-8bce-9e480f66e20b");
  });

  it("roots the policy-gated tools at the workspace, not just the cwd", () => {
    // The measured run printed `muse: workspace root: ... (explicit)` for
    // this; without it the root is inferred and a worktree run would be
    // rooted somewhere nobody chose.
    expect(build().args.join(" ")).toContain("--workspace C:\\work");
  });
});
