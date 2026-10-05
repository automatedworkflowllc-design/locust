import { describe, expect, it } from "vitest";

import { discoverInstalledRuntimes, discoverInstalledRuntimesEach } from "../src/index.js";
import type { CommandResult, CommandRunner, ExecutableLaunch, ExecutableLocator, ProbeCommand } from "../src/index.js";

/**
 * A runtime whose check is slow can still be SHOWN while it finishes
 * (2026-10-05). `discoverInstalledRuntimes` answers when the slowest runtime
 * has -- OpenCode, 4-11 s on Colin's machine -- so every launch, the first
 * screen included, was as slow as it. `discoverInstalledRuntimesEach` hands
 * back each check on its own, with what is already known about a runtime that
 * has not answered: it is installed, and it is being checked.
 */

const HELP = "opencode run [message..]  --format <format>  text | json  -m, --model  -s, --session";
const MODELS = "opencode/big-pickle\nopencode/muse-spark-1.3-contributor-free\n";

const installed = (name: string): ExecutableLaunch => ({
  commandName: name,
  discoveredPath: `C:\\tools\\${name}.exe`,
  executablePath: `C:\\tools\\${name}.exe`,
  prefixArgs: [],
  kind: "native",
});

const locatorFor = (names: readonly string[]): ExecutableLocator => ({
  find: async (command) => (names.includes(command) ? installed(command) : undefined),
});

const ok = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "" });

describe("a runtime whose check has not answered", () => {
  it("is shown as installed and being checked -- never as signed out or missing -- while its check goes on", async () => {
    let finishOpenCode: (result: CommandResult) => void = () => undefined;
    const runner: CommandRunner = {
      run: (command: ProbeCommand) => {
        if (command.executable.commandName === "opencode") {
          // Every OpenCode command waits: a CLI that is slow to start.
          return new Promise<CommandResult>((resolve) => {
            finishOpenCode = resolve;
          });
        }
        return Promise.resolve(ok(command.purpose === "version" ? "2.1.200" : command.args.join(" ")));
      },
    };
    const checks = discoverInstalledRuntimesEach({ runner, locator: locatorFor(["claude", "opencode"]) });
    const opencode = checks.find((check) => check.id === "opencode");
    const claude = checks.find((check) => check.id === "claude");
    expect(opencode).toBeDefined();
    // The other runtime's answer does not wait for OpenCode's.
    await expect(claude?.result).resolves.toMatchObject({ id: "claude", availability: "available" });
    await opencode?.located;
    const shown = opencode?.pending();
    expect(shown).toMatchObject({ id: "opencode", availability: "available", readiness: "unknown" });
    expect(shown?.executable?.executablePath).toBe("C:\\tools\\opencode.exe");
    expect(shown?.diagnostics.map((note) => note.code)).toEqual(["check-pending"]);
    expect(JSON.stringify(shown?.diagnostics)).not.toMatch(/sign|not found|missing/i);
    // And the check was only ever waiting: it answers when its CLI does.
    finishOpenCode(ok(MODELS));
    await expect(opencode?.result).resolves.toMatchObject({ id: "opencode", availability: "available" });
  });

  it("says a runtime that is not installed is not installed, at once", async () => {
    const runner: CommandRunner = { run: async () => ok("1.0.0") };
    const checks = discoverInstalledRuntimesEach({ runner, locator: locatorFor([]), only: new Set(["opencode"]) });
    expect(checks).toHaveLength(1);
    await expect(checks[0]?.result).resolves.toMatchObject({ availability: "unavailable" });
    expect(checks[0]?.pending()).toMatchObject({ availability: "unavailable" });
  });

  it("answers exactly as the all-at-once call does", async () => {
    const runner: CommandRunner = {
      run: async (command) => {
        if (command.purpose === "version") return ok("1.18.27");
        if (command.purpose === "capabilities") return ok(HELP);
        return ok(MODELS);
      },
    };
    const options = { runner, locator: locatorFor(["opencode"]), only: new Set(["opencode"]) } as const;
    const together = await discoverInstalledRuntimes(options);
    const each = await Promise.all(discoverInstalledRuntimesEach(options).map((check) => check.result));
    expect(each).toEqual(together);
  });

  it("is not asked a second time when the caller says a check for it is already going", () => {
    const runner: CommandRunner = { run: async () => ok("1.0.0") };
    const checks = discoverInstalledRuntimesEach({ runner, locator: locatorFor(["claude", "opencode"]), only: new Set(["claude", "opencode"]), skip: new Set(["opencode"]) });
    expect(checks.map((check) => check.id)).toEqual(["claude"]);
  });
});

describe("OpenCode's check is one start of OpenCode, not two", () => {
  const run = async (verbose: CommandResult, plain: CommandResult) => {
    const asked: string[] = [];
    const runner: CommandRunner = {
      run: async (command) => {
        if (command.purpose === "version") return ok("1.18.27");
        if (command.purpose === "capabilities") return ok(HELP);
        asked.push(command.args.join(" "));
        return command.args.includes("--verbose") ? verbose : plain;
      },
    };
    const [opencode] = await discoverInstalledRuntimes({ runner, locator: locatorFor(["opencode"]), only: new Set(["opencode"]) });
    return { asked, opencode };
  };

  it("takes readiness and the models from the one list that carries both", async () => {
    const { asked, opencode } = await run(ok(`${MODELS}{\n "variants": {}\n}\n`), ok(MODELS));
    expect(asked).toEqual(["models --verbose"]);
    expect(opencode?.readiness).toBe("ready");
    expect(opencode?.modelHints?.models?.map((model) => model.id)).toEqual(["opencode/big-pickle", "opencode/muse-spark-1.3-contributor-free"]);
  });

  it("asks the plain list only when the richer one did not answer, and still reads ready from it", async () => {
    const { asked, opencode } = await run({ exitCode: 2, stdout: "", stderr: "unknown option --verbose" }, ok(MODELS));
    expect(asked.sort()).toEqual(["models", "models --verbose"]);
    expect(opencode?.readiness).toBe("ready");
    expect(opencode?.modelHints?.models).toHaveLength(2);
  });

  it("is not ready when neither list can be read -- and says unhealthy, not signed out", async () => {
    const { opencode } = await run({ exitCode: 1, stdout: "", stderr: "boom" }, { exitCode: 1, stdout: "", stderr: "boom" });
    expect(opencode?.readiness).toBe("unhealthy");
  });
});
