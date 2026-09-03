import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertSafeRuntimeCommand,
  createClaudePrintCommand,
  createCodexExecCommand,
  createCursorPrintCommand,
  createGeminiPrintCommand,
  CURSOR_REQUIRED_FEATURES,
  parseClaudeModelHints,
  parseCursorModelList,
  createNodeProbeRunner,
  createPathExecutableLocator,
  discoverInstalledRuntimes,
  parseRuntimeVersion,
} from "../src/index.js";
import type {
  CommandRunner,
  ExecutableLaunch,
  ExecutableLocator,
  ProbeCommand,
  RuntimeReadiness,
  SpawnedProbeProcess,
} from "../src/index.js";

const nativeExecutable: ExecutableLaunch = {
  commandName: "codex",
  discoveredPath: "C:\\tools\\codex.exe",
  executablePath: "C:\\tools\\codex.exe",
  prefixArgs: [],
  kind: "native",
};

describe("runtime command specifications", () => {
  it("builds prompt-on-stdin, read-only Codex and restricted Claude commands", () => {
    const codex = createCodexExecCommand(nativeExecutable, {
      workspacePath: "C:\\workspace",
      model: "gpt-example",
    });
    expect(codex.args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "-C",
      "C:\\workspace",
      "--model",
      "gpt-example",
      "-",
    ]);
    expect(codex.stdin).toBe("prompt");

    const claude = createClaudePrintCommand(
      { ...nativeExecutable, commandName: "claude" },
      { workspacePath: "C:\\workspace" },
    );
    expect(claude.args).toContain("--restricted");
    expect(claude.args).toContain("stream-json");
    expect(claude.args).toContain("plan");
    expect(claude.args).not.toContain("--dangerously-skip-permissions");
  });

  it("rejects permission bypass arguments", () => {
    expect(() => assertSafeRuntimeCommand({
      runtime: "codex",
      executablePath: "C:\\tools\\codex.exe",
      args: ["exec", "--dangerously-bypass-approvals-and-sandbox"],
      cwd: "C:\\workspace",
      stdin: "prompt",
      stdout: "jsonl",
    })).toThrow("Forbidden runtime argument");
  });
});

describe("runtime version and executable discovery", () => {
  it("parses prerelease versions returned by installed CLIs", () => {
    expect(parseRuntimeVersion("codex-cli 0.151.0-alpha.7.2")?.version).toBe(
      "0.151.0-alpha.7.2",
    );
    expect(parseRuntimeVersion("2.1.251 (Claude Code)")?.version).toBe("2.1.251");
  });

  it("prefers native Windows executables and safely wraps PowerShell shims", async () => {
    const existing = new Set([
      "c:\\tools\\codex.exe",
      "c:\\shims\\claude.ps1",
      "c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe",
    ]);
    const locator = createPathExecutableLocator({
      platform: "win32",
      environment: {
        PATH: "C:\\tools;C:\\shims;C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
      },
      isExecutableFile: async (candidate) => existing.has(candidate.toLowerCase()),
    });

    await expect(locator.find("codex")).resolves.toMatchObject({
      executablePath: "C:\\tools\\codex.exe",
      kind: "native",
    });
    await expect(locator.find("claude")).resolves.toMatchObject({
      executablePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      prefixArgs: [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        "C:\\shims\\claude.ps1",
      ],
      kind: "powershell-shim",
    });
  });
});

describe("installed runtime discovery", () => {
  it("separates installation, safe capability support, and authentication", async () => {
    const launches = new Map<string, ExecutableLaunch>([
      ["codex", nativeExecutable],
      ["claude", {
        ...nativeExecutable,
        commandName: "claude",
        discoveredPath: "C:\\tools\\claude.exe",
        executablePath: "C:\\tools\\claude.exe",
      }],
    ]);
    const locator: ExecutableLocator = {
      find: async (name) => launches.get(name),
    };
    const runner: CommandRunner = {
      run: async (command) => fakeProbe(command),
    };

    const result = await discoverInstalledRuntimes({ runner, locator });
    expect(result.map(({ id, availability, readiness }) => ({ id, availability, readiness }))).toEqual([
      { id: "codex", availability: "available", readiness: "authentication-required" },
      { id: "claude", availability: "available", readiness: "ready" },
      { id: "cursor", availability: "unavailable", readiness: "unknown" },
      { id: "gemini", availability: "unavailable", readiness: "unknown" },
      { id: "omniroute", availability: "unavailable", readiness: "unknown" },
    ]);
  });

  // Both CLIs measured on this machine the day they were installed.
  const CURSOR_HELP =
    "-p, --print  --output-format <format> text | json | stream-json  --stream-partial-output  --mode <mode> plan: read-only  --workspace <path>  --resume [chatId]  --model <model>";
  const GEMINI_HELP =
    "-p, --prompt  Run in non-interactive (headless) mode. Appended to input on stdin  -o, --output-format  text json stream-json  --approval-mode default auto_edit yolo plan  -r, --resume";

  function newcomerLocator(name: string): ExecutableLocator {
    return {
      find: async (command) =>
        command === name
          ? { ...nativeExecutable, commandName: name, discoveredPath: `C:\\tools\\${name}.exe`, executablePath: `C:\\tools\\${name}.exe` }
          : undefined,
    };
  }

  it("reads a logged-out Cursor Agent from its text, because its status command exits 0 either way", async () => {
    const runner: CommandRunner = {
      run: async (command) => {
        if (command.purpose === "version") return { exitCode: 0, stdout: "2026.08.31-4057e58", stderr: "" };
        if (command.purpose === "capabilities") return { exitCode: 0, stdout: CURSOR_HELP, stderr: "" };
        return { exitCode: 0, stdout: "Not logged in\n", stderr: "" };
      },
    };
    const [cursor] = (await discoverInstalledRuntimes({ runner, locator: newcomerLocator("cursor-agent") }))
      .filter((entry) => entry.id === "cursor");
    expect(cursor?.availability).toBe("available");
    expect(cursor?.readiness).toBe("authentication-required");
    expect(cursor?.supportedFeatures).toEqual(expect.arrayContaining([...CURSOR_REQUIRED_FEATURES]));
  });

  // The first lines of the real list, as printed on 2026-09-02.
  const CURSOR_MODELS = "Available models\n\nauto - Auto (default)\ncursor-grok-4.6-high - Cursor Grok 4.6\ncomposer-2.5 - Composer 2.5\n";

  it("reports a signed-in Cursor Agent ready and reads its models off --list-models", async () => {
    const runner: CommandRunner = {
      run: async (command) => {
        if (command.purpose === "version") return { exitCode: 0, stdout: "2026.08.31-4057e58", stderr: "" };
        if (command.purpose === "capabilities") return { exitCode: 0, stdout: CURSOR_HELP, stderr: "" };
        if (command.purpose === "models") {
          expect(command.args).toEqual(["--list-models"]);
          return { exitCode: 0, stdout: CURSOR_MODELS, stderr: "" };
        }
        return { exitCode: 0, stdout: "Logged in as someone@example.com\n", stderr: "" };
      },
    };
    const [cursor] = (await discoverInstalledRuntimes({ runner, locator: newcomerLocator("cursor-agent") }))
      .filter((entry) => entry.id === "cursor");
    expect(cursor?.readiness).toBe("ready");
    expect(cursor?.modelHints?.models).toEqual([
      { id: "auto", displayName: "Auto (default)" },
      { id: "cursor-grok-4.6-high", displayName: "Cursor Grok 4.6" },
      { id: "composer-2.5", displayName: "Composer 2.5" },
    ]);
    expect(cursor?.modelHints?.efforts).toEqual([]);
  });

  it("reads no models from a Cursor that is signed out, and none from a list it cannot read", async () => {
    expect(parseCursorModelList("Error: Authentication required.")).toBeUndefined();
    expect(parseCursorModelList("")).toBeUndefined();
    // A duplicated id is listed once; a line without the dash is not a model.
    expect(parseCursorModelList("x - X\nx - X again\njust words")?.models).toEqual([{ id: "x", displayName: "X" }]);
  });

  it("reads a Gemini sign-in that Google then refused, which exits 0 with the refusal in its text", async () => {
    const refusal = readFileSync(new URL("./fixtures/gemini-ineligible-tier.txt", import.meta.url), "utf8");
    const runner: CommandRunner = {
      run: async (command) => {
        if (command.purpose === "version") return { exitCode: 0, stdout: "0.58.0", stderr: "" };
        if (command.purpose === "capabilities") return { exitCode: 0, stdout: GEMINI_HELP, stderr: "" };
        return { exitCode: 0, stdout: "No previous sessions found for this project.", stderr: refusal };
      },
    };
    const [gemini] = (await discoverInstalledRuntimes({ runner, locator: newcomerLocator("gemini") }))
      .filter((entry) => entry.id === "gemini");
    expect(gemini?.readiness).toBe("authentication-required");
  });

  it("reads Gemini CLI's sign-in state from its session listing's exit code", async () => {
    const answers = new Map<number, RuntimeReadiness>([[41, "authentication-required"], [0, "ready"]]);
    for (const [exitCode, expected] of answers) {
      const runner: CommandRunner = {
        run: async (command) => {
          if (command.purpose === "version") return { exitCode: 0, stdout: "0.58.0", stderr: "" };
          if (command.purpose === "capabilities") return { exitCode: 0, stdout: GEMINI_HELP, stderr: "" };
          expect(command.args).toEqual(["--list-sessions"]);
          return { exitCode, stdout: "", stderr: exitCode === 0 ? "" : "Please set an Auth method" };
        },
      };
      const [gemini] = (await discoverInstalledRuntimes({ runner, locator: newcomerLocator("gemini") }))
        .filter((entry) => entry.id === "gemini");
      expect(gemini?.readiness).toBe(expected);
    }
  });
});

describe("Cursor Agent and Gemini CLI commands", () => {
  const workspacePath = "C:\\work\\repo";

  it("runs a read-only Cursor mission in plan mode and never forces commands", () => {
    const spec = createCursorPrintCommand(nativeExecutable, { workspacePath });
    expect(spec.runtime).toBe("cursor");
    expect(spec.stdin).toBe("prompt");
    // Plan mode is the instruction and the sandbox is the enforcement; a
    // read-only mission asks for both, because plan mode alone was measured
    // letting a run edit files.
    expect(spec.args).toEqual([
      "--print", "--output-format", "stream-json", "--stream-partial-output", "--trust", "--workspace", workspacePath, "--mode", "plan", "--sandbox", "enabled",
    ]);
  });

  it("lets a workspace-write Cursor mission edit, still without --force", () => {
    const spec = createCursorPrintCommand(nativeExecutable, { workspacePath, sandbox: "workspace-write", model: "composer-1", resumeThreadId: "chat_1" });
    expect(spec.args).not.toContain("--mode");
    expect(spec.args).not.toContain("--force");
    expect(spec.args.slice(-4)).toEqual(["--model", "composer-1", "--resume", "chat_1"]);
  });

  it("refuses an effort for a runtime that has no effort flag", () => {
    expect(() => createCursorPrintCommand(nativeExecutable, { workspacePath, effort: "high" })).toThrow(/effort/);
    expect(() => createGeminiPrintCommand(nativeExecutable, { workspacePath, effort: "high" })).toThrow(/effort/);
  });

  it("runs Gemini headless with the prompt on stdin, trusting only this workspace", () => {
    const spec = createGeminiPrintCommand(nativeExecutable, { workspacePath });
    expect(spec.runtime).toBe("gemini");
    expect(spec.stdin).toBe("prompt");
    expect(spec.args).toEqual(["--output-format", "stream-json", "--skip-trust", "--approval-mode", "plan"]);
    const writing = createGeminiPrintCommand(nativeExecutable, { workspacePath, sandbox: "workspace-write", model: "gemini-3-flash", resumeThreadId: "s1" });
    expect(writing.args).toContain("auto_edit");
    expect(writing.args.slice(-4)).toEqual(["--model", "gemini-3-flash", "--resume", "s1"]);
  });

  it("refuses Gemini's yolo mode and Cursor's force flag in any spelling", () => {
    for (const args of [["--approval-mode", "yolo"], ["--approval-mode=yolo"], ["-y"], ["--force"], ["-f"], ["--yolo"]]) {
      expect(() =>
        assertSafeRuntimeCommand({ runtime: "gemini", executablePath: "C:\\x.exe", args, cwd: workspacePath, stdin: "prompt", stdout: "jsonl" }),
      ).toThrow(/Forbidden/);
    }
  });

  it("finds Cursor's launcher in its own install directory without PATH", async () => {
    // The installer writes `cursor-agent.cmd` and `cursor-agent.ps1` side by
    // side; the `.ps1` is the one the locator knows how to host safely.
    const LOCAL = "C:\\Users\\x\\AppData\\Local";
    const launcher = `${LOCAL}\\cursor-agent\\cursor-agent.ps1`;
    const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const found = await createPathExecutableLocator({
      platform: "win32",
      environment: { PATH: "", LOCALAPPDATA: LOCAL, APPDATA: "C:\\Users\\x\\AppData\\Roaming", SystemRoot: "C:\\Windows" },
      isExecutableFile: async (candidate) => candidate === launcher || candidate === powershell,
      readDirectory: async () => [],
    }).find("cursor-agent");
    expect(found?.kind).toBe("powershell-shim");
    expect(found?.discoveredPath).toBe(launcher);
  });
});

function fakeProbe(command: ProbeCommand) {
  const args = command.args.join(" ");
  const isClaude = command.executablePath.includes("claude");
  if (command.purpose === "version") {
    return Promise.resolve({
      exitCode: 0,
      stdout: isClaude ? "2.1.251 (Claude Code)" : "codex-cli 0.151.0-alpha.7.2",
      stderr: "",
    });
  }
  if (command.purpose === "capabilities") {
    return Promise.resolve({
      exitCode: 0,
      stdout: isClaude
        ? "--print stdin --output-format stream-json --restricted --verbose --include-partial-messages --permission-mode plan --tools --disallowedTools"
        : "Run non-interactively stdin --json --cd --sandbox read-only",
      stderr: "",
    });
  }
  return Promise.resolve({ exitCode: args.includes("login status") ? 1 : 0, stdout: "", stderr: "" });
}

describe("bounded Node probe runner", () => {
  it("caps captured output and never asks Node for a shell", async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    let spawnOptions: unknown;
    const runner = createNodeProbeRunner({
      maxOutputBytes: 4,
      spawnProcess: (_executable, _args, options) => {
        spawnOptions = options;
        const process = new EventEmitter() as EventEmitter & SpawnedProbeProcess;
        Object.assign(process, {
          stdout,
          stderr,
          kill: () => true,
        });
        queueMicrotask(() => {
          stdout.emit("data", "abcdefgh");
          stderr.emit("data", "12345678");
          process.emit("close", 0);
        });
        return process;
      },
    });

    const result = await runner.run({
      purpose: "version",
      executablePath: "C:\\tools\\codex.exe",
      args: ["--version"],
      timeoutMs: 100,
    });
    expect(result.stdout).toBe("abcd");
    expect(result.stderr).toBe("1234");
    expect(spawnOptions).toMatchObject({ shell: false, windowsHide: true });
  });

  it("terminates a timed-out probe", async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const signals: Array<NodeJS.Signals | undefined> = [];
    const runner = createNodeProbeRunner({
      maximumTimeoutMs: 5,
      killGraceMs: 5,
      spawnProcess: () => {
        const process = new EventEmitter() as EventEmitter & SpawnedProbeProcess;
        Object.assign(process, {
          stdout,
          stderr,
          kill: (signal?: NodeJS.Signals) => {
            signals.push(signal);
            return true;
          },
        });
        return process;
      },
    });

    const result = await runner.run({
      purpose: "readiness",
      executablePath: "C:\\tools\\codex.exe",
      args: ["login", "status"],
      timeoutMs: 5,
    });
    expect(result.timedOut).toBe(true);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});

describe("model and effort on the command line", () => {
  const executable = {
    commandName: "x",
    discoveredPath: process.platform === "win32" ? "C:\\tools\\x.exe" : "/tools/x",
    executablePath: process.platform === "win32" ? "C:\\tools\\x.exe" : "/tools/x",
    prefixArgs: [],
    kind: "native" as const,
  };
  const workspacePath = process.platform === "win32" ? "C:\\work" : "/work";

  it("passes the chosen model and effort to Claude Code", () => {
    const spec = createClaudePrintCommand(executable, { workspacePath, model: "fable", effort: "high" });
    expect(spec.args).toContain("--model");
    expect(spec.args[spec.args.indexOf("--model") + 1]).toBe("fable");
    expect(spec.args[spec.args.indexOf("--effort") + 1]).toBe("high");
  });

  it("passes effort to codex exec through the config override its docs describe", () => {
    const spec = createCodexExecCommand(executable, { workspacePath, model: "gpt-5.6-sol", effort: "xhigh" });
    expect(spec.args[spec.args.indexOf("-c") + 1]).toBe("model_reasoning_effort=xhigh");
  });

  it("refuses an effort that is not one plain word", () => {
    expect(() => createClaudePrintCommand(executable, { workspacePath, effort: "high; rm -rf" })).toThrow("Effort is invalid");
    expect(() => createCodexExecCommand(executable, { workspacePath, effort: "" })).toThrow("Effort is invalid");
  });

  it("reads the aliases and effort levels the Claude CLI advertises in its own help", () => {
    const help = [
      "  --model <model>                       Model for the current session. Provide",
      "                                        an alias for the latest model (e.g.",
      "                                        'fable', 'opus', or 'sonnet') or a",
      "                                        model's full name (e.g.",
      "                                        'claude-fable-5').",
      "  --effort <level>                      Effort level for the current session",
      "                                        (low, medium, high, xhigh, max)",
    ].join("\n");
    expect(parseClaudeModelHints(help)).toEqual({
      aliases: ["fable", "opus", "sonnet"],
      efforts: ["low", "medium", "high", "xhigh", "max"],
    });
  });

  it("names nothing when the help does not", () => {
    expect(parseClaudeModelHints("Usage: claude [options]")).toBeUndefined();
  });
});

describe("continuing a conversation", () => {
  const executable = {
    commandName: "x",
    discoveredPath: process.platform === "win32" ? "C:\\tools\\x.exe" : "/tools/x",
    executablePath: process.platform === "win32" ? "C:\\tools\\x.exe" : "/tools/x",
    prefixArgs: [],
    kind: "native" as const,
  };
  const workspacePath = process.platform === "win32" ? "C:\\work" : "/work";

  it("resumes a Claude session by id", () => {
    const spec = createClaudePrintCommand(executable, { workspacePath, resumeThreadId: "sess-42" });
    expect(spec.args[spec.args.indexOf("--resume") + 1]).toBe("sess-42");
  });

  it("resumes a Codex session with only the arguments that subcommand accepts", () => {
    // MEASURED against codex-cli 0.151.0: `codex exec resume` takes neither
    // `--sandbox` nor `-C`, and exits 2 with "unexpected argument" if given
    // either. This test used to assert the argv I had written rather than the
    // argv the CLI accepts, so every Codex reply failed and the suite stayed
    // green. The sandbox travels as the config override the subcommand does
    // support, and the working directory needs no flag: the process is
    // spawned in it.
    const spec = createCodexExecCommand(executable, {
      workspacePath,
      resumeThreadId: "thread-42",
      sandbox: "read-only",
    });
    expect(spec.args.slice(0, 3)).toEqual(["exec", "resume", "thread-42"]);
    expect(spec.args).not.toContain("--sandbox");
    expect(spec.args).not.toContain("-C");
    expect(spec.args).not.toContain(workspacePath);
    expect(spec.args).toEqual(expect.arrayContaining(["-c", "sandbox_mode=read-only"]));
    // The prompt still arrives on stdin, so the trailing `-` must survive.
    expect(spec.args.at(-1)).toBe("-");
  });

  it("carries a write-capable resume as the same override, not as a flag", () => {
    const spec = createCodexExecCommand(executable, {
      workspacePath,
      resumeThreadId: "thread-42",
      sandbox: "workspace-write",
    });
    expect(spec.args).toEqual(expect.arrayContaining(["-c", "sandbox_mode=workspace-write"]));
    expect(spec.args).not.toContain("--sandbox");
  });

  it("starts a fresh conversation when no session is given", () => {
    const spec = createCodexExecCommand(executable, { workspacePath });
    expect(spec.args.includes("resume")).toBe(false);
    expect(createClaudePrintCommand(executable, { workspacePath }).args.includes("--resume")).toBe(false);
  });

  it("refuses a session id that is not plain text", () => {
    expect(() => createCodexExecCommand(executable, { workspacePath, resumeThreadId: "" })).toThrow();
    expect(() =>
      createClaudePrintCommand(executable, { workspacePath, resumeThreadId: `bad${String.fromCharCode(0)}id` }),
    ).toThrow();
  });
});

describe("finding a CLI that never put itself on PATH", () => {
  const LOCAL = "C:\\Users\\x\\AppData\\Local";
  const ROAMING = "C:\\Users\\x\\AppData\\Roaming";

  function locator(files: readonly string[], versions: readonly string[] = [], path = "") {
    return createPathExecutableLocator({
      platform: "win32",
      environment: { PATH: path, LOCALAPPDATA: LOCAL, APPDATA: ROAMING },
      isExecutableFile: async (candidate) => files.includes(candidate),
      readDirectory: async (directory) =>
        directory === `${LOCAL}\\OpenAI\\Codex\\bin` ? versions : [],
    });
  }

  it("finds Codex in its versioned install root when PATH knows nothing", async () => {
    // The exact shape that reported "not found" in a packaged build on a
    // machine where Codex was installed and working in a terminal.
    const exe = `${LOCAL}\\OpenAI\\Codex\\bin\\abc123\\codex.exe`;
    const found = await locator([exe], ["abc123"]).find("codex");
    expect(found?.executablePath).toBe(exe);
    expect(found?.kind).toBe("native");
  });

  it("prefers what PATH says over an install root", async () => {
    const onPath = "C:\\tools\\codex.exe";
    const installed = `${LOCAL}\\OpenAI\\Codex\\bin\\abc123\\codex.exe`;
    const found = await locator([onPath, installed], ["abc123"], "C:\\tools").find("codex");
    expect(found?.executablePath).toBe(onPath);
  });

  it("finds Claude Code's npm shim without PATH", async () => {
    const shim = `${ROAMING}\\npm\\claude.ps1`;
    const powershell = `${ROAMING}\\npm\\powershell.exe`;
    const found = await locator([shim, powershell]).find("claude");
    expect(found?.kind).toBe("powershell-shim");
    expect(found?.discoveredPath).toBe(shim);
  });

  it("reports nothing when the runtime is genuinely absent", async () => {
    expect(await locator([], ["abc123"]).find("codex")).toBeUndefined();
    expect(await locator([]).find("claude")).toBeUndefined();
  });

  it("searches no install root for a command it does not know", async () => {
    const stray = `${LOCAL}\\OpenAI\\Codex\\bin\\abc123\\somethingelse.exe`;
    expect(await locator([stray], ["abc123"]).find("somethingelse")).toBeUndefined();
  });
});
