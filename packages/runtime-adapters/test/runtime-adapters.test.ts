import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  assertSafeRuntimeCommand,
  createClaudePrintCommand,
  createCodexExecCommand,
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
      { id: "omniroute", availability: "unavailable", readiness: "unknown" },
    ]);
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
