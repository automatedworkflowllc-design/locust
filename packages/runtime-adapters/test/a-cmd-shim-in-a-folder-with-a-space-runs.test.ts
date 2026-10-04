import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createNodeProbeRunner } from "../src/node-runner.js";

/**
 * H8: A .cmd LAUNCHER IN A FOLDER WITH A SPACE RUNS, AND ITS ARGUMENTS ARRIVE
 * AS THEY WERE SENT.
 *
 * Muse and Cursor are reached through `.cmd` launchers that are not npm
 * shims, run as `cmd.exe /d /s /c <launcher> ...args`. With Node's own
 * quoting, cmd's /s rule strips the first and last quote of the line, so a
 * launcher under `C:\Users\Jane Doe\...` became the command `C:\Users\Jane`
 * -- every probe and mission of theirs failed on such a machine -- and an
 * argument like `R&D` was cut at the `&`. Real cmd.exe, a real launcher.
 */
const onWindows = process.platform === "win32";
const folders: string[] = [];
afterAll(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function launcher(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "locust-cmd-"));
  folders.push(root);
  const folder = join(root, "Jane Doe", "Programs", "muse");
  await mkdir(folder, { recursive: true });
  const script = join(folder, "muse.cmd");
  // As a real launcher does: forward %* to a program, here a script that
  // prints exactly the arguments it received.
  await writeFile(join(folder, "print.js"), "process.stdout.write(JSON.stringify(process.argv.slice(2)))", "utf8");
  await writeFile(script, `@echo off
"${process.execPath}" "%~dp0print.js" %*
`, "utf8");
  return script;
}

const cmd = (): string => join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");

describe("a .cmd launcher run through cmd.exe", () => {
  it.runIf(onWindows)("runs from a folder whose name has a space", async () => {
    const script = await launcher();
    const result = await createNodeProbeRunner().run({ purpose: "version", executablePath: cmd(), args: ["/d", "/s", "/c", script, "--version"], timeoutMs: 10_000 });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["--version"]);
  });

  it.runIf(onWindows)("hands over an argument with shell characters whole, not as an operator", async () => {
    const script = await launcher();
    const result = await createNodeProbeRunner().run({ purpose: "version", executablePath: cmd(), args: ["/d", "/s", "/c", script, "C:\\Projects\\R&D", "a|b", "100%"], timeoutMs: 10_000 });
    expect(JSON.parse(result.stdout)).toEqual(["C:\\Projects\\R&D", "a|b", "100%"]);
  });

  it.runIf(onWindows)("keeps an argument with its own quote from turning & into a command (a teammate's words in a prompt)", async () => {
    const script = await launcher();
    const words = 'say "hi" & echo INJECTED';
    const result = await createNodeProbeRunner().run({ purpose: "version", executablePath: cmd(), args: ["/d", "/s", "/c", script, words, "next"], timeoutMs: 10_000 });
    expect(result.stdout).not.toContain("INJECTED\r");
    expect(JSON.parse(result.stdout)).toEqual([words, "next"]);
  });
});

describe("the command line for a .cmd launcher", () => {
  it("refuses an argument with a line break rather than lose everything after it", async () => {
    const { cmdLauncherLine } = await import("../src/cmd-line.js");
    expect(() => cmdLauncherLine(["/d", "/s", "/c", "C:\muse.cmd", "line one" + String.fromCharCode(10) + "line two"])).toThrow("cannot pass a line break");
  });
});
