/**
 * H8: A .cmd LAUNCHER, RUN THE WAY CMD.EXE READS IT.
 *
 * A `.cmd` launcher that is not an npm shim -- Muse's, Cursor's, a pnpm or
 * yarn shim -- is run as `cmd.exe /d /s /c <launcher> ...args`. Spawned with
 * Node's per-argument quoting, cmd's /s rule stripped the first and last
 * quote of the whole line: a launcher under `C:\Users\Jane Doe\` became the
 * command `C:\Users\Jane`, and an unquoted `R&D` was cut at the `&`.
 * MEASURED on this machine with real cmd.exe (a-cmd-shim-in-a-folder-with-a-
 * space-runs.test.ts): exit 1, nothing run.
 *
 * So the line is built the way Node's own `shell: true` and cross-spawn
 * build it -- every part quoted and every cmd metacharacter escaped with a
 * caret, the whole wrapped in one outer pair of quotes for /s to strip -- and
 * handed over verbatim.
 */

const META = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommand(command: string): string {
  return command.replace(META, "^$1");
}

function escapeArgument(argument: string): string {
  let escaped = argument;
  // Backslashes before a quote, and at the end, are doubled; quotes escaped.
  escaped = escaped.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  escaped = escaped.replace(/(?=(\\+?)?)\1$/, "$1$1");
  escaped = `"${escaped}"`;
  return escaped.replace(META, "^$1");
}

/** Whether a spawn is a launcher run through cmd.exe /d /s /c, as the locator builds one. */
export function isCmdLauncherSpawn(executablePath: string, args: readonly string[]): boolean {
  const name = executablePath.replace(/\\/g, "/").split("/").at(-1)?.toLowerCase();
  return name === "cmd.exe" && args.length >= 4 && args[0] === "/d" && args[1] === "/s" && args[2] === "/c";
}

/**
 * The verbatim command line for such a spawn: `/d /s /c "<launcher> <args>"`.
 * A line break cannot be passed through cmd.exe at all -- it ends the command
 * there, and everything after it is lost, flags and all -- so an argument
 * with one is refused rather than cut short.
 */
export function cmdLauncherLine(args: readonly string[]): string {
  const [, , , launcher, ...rest] = args;
  if ([launcher!, ...rest].some((part) => /[\r\n]/.test(part))) {
    throw new Error("This runtime is started through a .cmd launcher, and cmd.exe cannot pass a line break in an argument. Nothing was started.");
  }
  return `/d /s /c "${[escapeCommand(launcher!), ...rest.map(escapeArgument)].join(" ")}"`;
}

/**
 * What to hand `spawn` for a command: unchanged, or -- for a cmd launcher --
 * one verbatim argument and the flag that stops Node quoting it again.
 */
export function spawnShape(executablePath: string, args: readonly string[]): { readonly args: readonly string[]; readonly windowsVerbatimArguments?: true } {
  return isCmdLauncherSpawn(executablePath, args)
    ? { args: [cmdLauncherLine(args)], windowsVerbatimArguments: true }
    : { args };
}
