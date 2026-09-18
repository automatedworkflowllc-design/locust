import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import type { ExecutableLaunch, ExecutableLocator } from "./types.js";

export interface PathExecutableLocatorOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly isExecutableFile?: (candidate: string, platform: NodeJS.Platform) => Promise<boolean>;
  /** Test seam for the versioned-install search; defaults to reading the directory. */
  readonly readDirectory?: (directory: string) => Promise<readonly string[]>;
  /**
   * Test seam for reading a `.cmd` shim to see what it wraps. Resolves to
   * undefined for anything that cannot be read, so an unreadable shim falls
   * back to cmd.exe rather than failing discovery.
   */
  readonly readFile?: (path: string) => Promise<string | undefined>;
  /**
   * A Node to run npm scripts with when the machine has none.
   *
   * MEASURED 2026-09-17, and it is why Ian could not use Locust at all: the
   * coding CLIs install through npm, so with no Node on the machine the
   * first screen disables its own Install buttons and sends you to
   * nodejs.org. What nobody noticed is that the app already CARRIES a Node
   * -- an Electron binary run with `ELECTRON_RUN_AS_NODE=1` is Node 24 --
   * and the locator was walking past it to give up.
   *
   * Last, never first: a Node the person installed is the one their CLIs
   * were built against, and this is only the answer when there is no other.
   */
  readonly bundledNode?: { readonly executablePath: string; readonly env?: Readonly<Record<string, string>> };
  /**
   * npm's global bin directory, when the host has asked npm where it is.
   *
   * The install roots below hardcode npm's DEFAULT prefix -- `%APPDATA%
pm`
   * on Windows -- and that is only where a runtime lands if nobody has moved
   * it. `npm config set prefix` is common on machines where the default
   * folder is not writable, which is corporate Windows, every nvm-style
   * manager, and the exact remedy Locust itself prints when an install fails
   * with EACCES. A runtime installed perfectly well into a custom prefix was
   * invisible to this locator unless that prefix also happened to be on the
   * PATH a windowed app inherits, which it usually is not.
   *
   * Supplied rather than discovered here: asking npm costs a child process,
   * this module has no business spawning one, and the answer is stable for a
   * session. The host asks once and passes it in.
   */
  readonly npmBinDirectory?: string;
  /**
   * Where the host's OWN npm installs to, when the host carries one.
   *
   * MEASURED by Grok's pass 10, 2026-09-18, on the day after the bundled npm
   * shipped: Install ran, npm said it was done, and Locust answered "opencode
   * installed, but Locust still cannot find the command". npm run by the
   * host's binary chose a prefix from that binary's location, nothing put
   * that folder on PATH, and this locator never looked there. The install
   * was verified; the round trip was not.
   *
   * So the host picks the prefix, tells npm, and tells this. Searched after
   * PATH and after npm's own prefix, for the same reason those come first:
   * a copy the person's terminal would find is the one they expect to run.
   */
  readonly ownInstallDirectory?: string;
}

/**
 * The line npm writes into every `.cmd` shim it generates: the wrapped script,
 * relative to the shim's own directory, followed by `%*` for the arguments.
 *
 *   "%_prog%"  "%dp0%\node_modules\@github\copilot\npm-loader.js" %*
 *
 * Only this exact shape is resolved past cmd.exe. A `.cmd` that does anything
 * else is somebody's own script and keeps its shell, because guessing at what
 * a batch file does is how a locator starts running things it did not mean to.
 */
const NPM_SHIM_SCRIPT = /"%dp0%\\(node_modules\\[^"\r\n]+\.[cm]?js)"\s+%\*/;

/**
 * The other shape npm writes, for a package whose bin is a native binary:
 *
 *   "%dp0%\node_modules\opencode-ai\bin\opencode.exe"   %*
 *
 * OpenCode and Claude Code both ship this way. There is nothing for node to
 * run; the `.exe` is the program, and cmd.exe was only ever in the way.
 */
const NPM_SHIM_BINARY = /"%dp0%\\(node_modules\\[^"\r\n]+\.exe)"\s+%\*/i;

async function defaultReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Where a CLI installs itself when it does not put itself on PATH.
 *
 * A terminal finds `codex` because the shell's own profile adds it; an app
 * launched from the Start menu inherits no such thing, and reported the CLI as
 * missing on a machine where it was plainly installed. These are the official
 * per-user install roots, read-only and by exact command name -- nothing here
 * searches the disk, guesses at names, or looks at anything but directories a
 * runtime's own installer creates.
 *
 * `versioned` roots hold one directory per installed version, so the newest by
 * modification time is the one a person would get from a terminal.
 */
interface InstallRoot {
  readonly command: string;
  /** Environment variable naming the base directory, e.g. LOCALAPPDATA. */
  readonly base: string;
  readonly segments: readonly string[];
  readonly versioned: boolean;
}

const WINDOWS_INSTALL_ROOTS: readonly InstallRoot[] = [
  // Codex installs into %LOCALAPPDATA%\OpenAI\Codex\bin\<version hash>\.
  { command: "codex", base: "LOCALAPPDATA", segments: ["OpenAI", "Codex", "bin"], versioned: true },
  { command: "codex", base: "APPDATA", segments: ["npm"], versioned: false },
  { command: "claude", base: "APPDATA", segments: ["npm"], versioned: false },
  { command: "claude", base: "LOCALAPPDATA", segments: ["Programs", "claude"], versioned: false },
  // Cursor's installer copies the launchers to %LOCALAPPDATA%\cursor-agent and
  // appends that directory to the USER PATH -- which a packaged app started
  // from the shell does not see until the next sign-in.
  { command: "cursor-agent", base: "LOCALAPPDATA", segments: ["cursor-agent"], versioned: false },
  { command: "gemini", base: "APPDATA", segments: ["npm"], versioned: false },
  // OpenCode and Copilot CLI both install from npm, so the global npm bin
  // directory is where their launchers land.
  { command: "opencode", base: "APPDATA", segments: ["npm"], versioned: false },
  { command: "copilot", base: "APPDATA", segments: ["npm"], versioned: false },
  // Copilot CLI also unpacks itself under %LOCALAPPDATA%\copilot -- its own
  // records name that directory (`...\AppData\Local\copilot\pkg\win32-x64\
  // <version>\builtin\...`), so a launcher there is worth looking for when
  // npm's bin directory is not on PATH.
  { command: "copilot", base: "LOCALAPPDATA", segments: ["copilot"], versioned: false },
  // Windows PowerShell's own home. Claude Code installs as a `.ps1` shim, and
  // running it needs a host; on a PATH that does not name one, the shim was
  // found and then discarded for want of an interpreter that is always there.
  { command: "powershell", base: "SystemRoot", segments: ["System32", "WindowsPowerShell", "v1.0"], versioned: false },
  // Same reason as PowerShell above: a `.cmd` shim needs a host, and the host
  // must be the one Windows ships rather than whatever PATH offers first.
  { command: "cmd", base: "SystemRoot", segments: ["System32"], versioned: false },
];

const SAFE_COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function defaultIsExecutableFile(
  candidate: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    const details = await stat(candidate);
    if (!details.isFile()) return false;
    if (platform !== "win32") await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function environmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") return environment[key];
  const entry = Object.entries(environment).find(
    ([candidate]) => candidate.toLowerCase() === key.toLowerCase(),
  );
  return entry?.[1];
}

function pathDirectories(
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): readonly string[] {
  const pathApi = platform === "win32" ? win32 : posix;
  const value = environmentValue(environment, "PATH", platform) ?? "";
  const seen = new Set<string>();
  const directories: string[] = [];

  for (const rawEntry of value.split(pathApi.delimiter)) {
    const trimmed = rawEntry.trim();
    const entry =
      trimmed.startsWith('"') && trimmed.endsWith('"')
        ? trimmed.slice(1, -1)
        : trimmed;
    // Empty and relative PATH entries implicitly target the current directory.
    // Discovery skips them so its behavior cannot be changed by process cwd.
    if (!entry || !pathApi.isAbsolute(entry)) continue;
    const normalized = pathApi.normalize(entry);
    const key = platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    directories.push(normalized);
  }

  return directories;
}

async function locateNativeWindowsCommand(
  commandName: string,
  directories: readonly string[],
  isExecutableFile: (candidate: string, platform: NodeJS.Platform) => Promise<boolean>,
): Promise<string | undefined> {
  const hasExtension = win32.extname(commandName) !== "";
  const names = hasExtension
    ? [commandName]
    : [`${commandName}.exe`, `${commandName}.com`];

  for (const directory of directories) {
    for (const name of names) {
      const candidate = win32.join(directory, name);
      if (await isExecutableFile(candidate, "win32")) return candidate;
    }
  }
  return undefined;
}

async function defaultReadDirectory(directory: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Directories a given command is known to install into, newest version first.
 * Returns nothing when the base variable is unset or the root does not exist,
 * so a machine without that runtime simply contributes no candidates.
 */
async function installDirectories(
  commandName: string,
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  readDirectory: (directory: string) => Promise<readonly string[]>,
): Promise<readonly string[]> {
  if (platform !== "win32") return [];
  const found: string[] = [];
  for (const root of WINDOWS_INSTALL_ROOTS) {
    if (root.command !== commandName) continue;
    const base = environmentValue(environment, root.base, platform);
    if (base === undefined || base.length === 0 || !win32.isAbsolute(base)) continue;
    const directory = win32.join(base, ...root.segments);
    if (!root.versioned) {
      found.push(directory);
      continue;
    }
    const versions = await readDirectory(directory);
    // Newest first. The names are opaque version hashes, so their order says
    // nothing; when several are installed, the one a terminal would run is the
    // most recently written.
    const stamped = await Promise.all(
      versions.map(async (name) => {
        const candidate = win32.join(directory, name);
        try {
          return { candidate, at: (await stat(candidate)).mtimeMs };
        } catch {
          return { candidate, at: 0 };
        }
      }),
    );
    stamped.sort((left, right) => right.at - left.at);
    for (const entry of stamped) found.push(entry.candidate);
  }
  return found;
}

export function createPathExecutableLocator(
  options: PathExecutableLocatorOptions = {},
): ExecutableLocator {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const isExecutableFile = options.isExecutableFile ?? defaultIsExecutableFile;
  const readDirectory = options.readDirectory ?? defaultReadDirectory;
  const readShim = options.readFile ?? defaultReadFile;
  const pathOnly = pathDirectories(environment, platform);

  return {
    async find(commandName): Promise<ExecutableLaunch | undefined> {
      if (!SAFE_COMMAND_NAME.test(commandName)) return undefined;

      // PATH first, and that has to mean the WHOLE search -- shims included.
      //
      // MEASURED 2026-09-03: this used to concatenate PATH with the inferred
      // install roots and hand the single list to each strategy in turn. So
      // the `.exe` sweep ran over the guessed directories before the `.ps1`
      // sweep ran over PATH, and a runtime installed from npm -- which lands
      // as `codex.cmd` plus `codex.ps1`, never a `.exe` -- lost to whatever
      // sat in the guessed location. Concretely: with a working Codex 0.153.0
      // installed from npm and on PATH, this returned the older
      // 0.151.0-alpha under %LOCALAPPDATA%\OpenAI\Codex instead -- measured
      // against this function directly, not inferred. So installing or
      // updating a runtime could have no effect on what the app actually ran,
      // with nothing on screen naming which copy it chose.
      //
      // So each location set is resolved COMPLETELY before the next is tried.
      const resolveWithin = async (
        directories: readonly string[],
      ): Promise<ExecutableLaunch | undefined> => {
      if (platform !== "win32") {
        for (const directory of directories) {
          const candidate = posix.join(directory, commandName);
          if (await isExecutableFile(candidate, platform)) {
            return {
              commandName,
              discoveredPath: candidate,
              executablePath: candidate,
              prefixArgs: [],
              kind: "native",
            };
          }
        }
        return undefined;
      }

      const native = await locateNativeWindowsCommand(
        commandName,
        directories,
        isExecutableFile,
      );
      if (native) {
        return {
          commandName,
          discoveredPath: native,
          executablePath: native,
          prefixArgs: [],
          kind: "native",
        };
      }

      // `.cmd` BEFORE `.ps1`, because that is the order Windows itself uses
      // and npm writes both. MEASURED 2026-09-03, and it matters: npm's
      // `codex.ps1` cannot take Codex's own arguments -- a bare `-` for
      // prompt-on-stdin makes PowerShell's parameter binder reject the whole
      // call ("the value of argument name is not valid") -- while
      // `codex.cmd` under cmd.exe takes them exactly as a terminal does.
      // Reaching the `.ps1` first broke every Codex mission for anyone whose
      // Codex came from npm.
      for (const directory of directories) {
        const script = win32.join(directory, `${commandName}.cmd`);
        if (!(await isExecutableFile(script, "win32"))) continue;

        // An npm shim is resolved PAST cmd.exe to the node script it wraps.
        //
        // MEASURED 2026-09-05. cmd.exe ends a command line at the first
        // newline and refuses one past 8191 characters. OpenCode and Copilot
        // take the prompt as an ARGUMENT, so any multi-line prompt -- every
        // teammate briefing is one -- lost every flag after it: the JSON
        // output format, and `--deny-tool=write,shell`, the flag that made a
        // read-only run read-only. Copilot ran in its human mode with write
        // access, exited 0, and the thread reported "ended without a terminal
        // result record". Under node directly:
        //
        //   multi-line prompt, flags after it -> 16 records, result present,
        //   `--deny-tool` honoured, the prompt arriving whole
        //
        // node.exe comes from beside the shim first -- that is where npm's
        // own shim looks (`%dp0%\node.exe`) -- and then from PATH, the way the
        // shim's `node` fallback does. If neither is found the shim keeps its
        // shell, so a machine this cannot help is no worse off than before.
        const shimText = await readShim(script);

        // A shim around a native binary resolves to the binary itself. The
        // shim is still what was DISCOVERED -- that is the path a person
        // would look for -- but the program that runs is the `.exe`, with no
        // shell between them.
        const binary = shimText === undefined ? null : NPM_SHIM_BINARY.exec(shimText);
        if (binary?.[1] !== undefined) {
          const executable = win32.join(directory, binary[1]);
          if (await isExecutableFile(executable, "win32")) {
            return {
              commandName,
              discoveredPath: script,
              executablePath: executable,
              prefixArgs: [],
              kind: "native",
            };
          }
        }

        const wrapped = shimText === undefined ? null : NPM_SHIM_SCRIPT.exec(shimText);
        if (wrapped?.[1] !== undefined) {
          const beside = win32.join(directory, "node.exe");
          const node = (await isExecutableFile(beside, "win32"))
            ? beside
            : await locateNativeWindowsCommand("node", directories, isExecutableFile);
          if (node) {
            return {
              commandName,
              discoveredPath: script,
              executablePath: node,
              prefixArgs: [win32.join(directory, wrapped[1])],
              kind: "node-shim",
            };
          }
          // No Node on the machine. The host's own will do, and running the
          // script directly keeps the two things cmd.exe would cost: the
          // 8,191-character command line, and the flags after a multi-line
          // prompt.
          if (options.bundledNode !== undefined) {
            return {
              commandName,
              discoveredPath: script,
              executablePath: options.bundledNode.executablePath,
              prefixArgs: [win32.join(directory, wrapped[1])],
              kind: "node-shim",
              ...(options.bundledNode.env === undefined ? {} : { env: options.bundledNode.env }),
            };
          }
        }

        // cmd.exe comes from where Windows keeps it first, for the same
        // reason the PowerShell host below does: one planted earlier on PATH
        // would run the shim with this process's environment.
        const shellDirectories = [
          ...(await installDirectories("cmd", environment, platform, readDirectory)),
          ...directories,
        ];
        const shell = await locateNativeWindowsCommand("cmd", shellDirectories, isExecutableFile);
        if (!shell) continue;

        return {
          commandName,
          discoveredPath: script,
          executablePath: shell,
          // /d skips AutoRun, /s settles how the quoted path is parsed,
          // /c runs it and exits.
          prefixArgs: ["/d", "/s", "/c", script],
          kind: "cmd-shim",
        };
      }

      for (const directory of directories) {
        const script = win32.join(directory, `${commandName}.ps1`);
        if (!(await isExecutableFile(script, "win32"))) continue;

        // The interpreter comes from where Windows keeps it FIRST, and only
        // then from PATH. `pwsh` is not a component Windows ships, so a
        // planted one earlier on PATH would face no competitor -- and it
        // would run the shim with this process's environment and the
        // mission's workspace as its working directory.
        const hostDirectories = [
          ...(await installDirectories("powershell", environment, platform, readDirectory)),
          ...directories,
        ];
        const powershell =
          (await locateNativeWindowsCommand("pwsh", hostDirectories, isExecutableFile)) ??
          (await locateNativeWindowsCommand("powershell", hostDirectories, isExecutableFile));
        if (!powershell) continue;

        return {
          commandName,
          discoveredPath: script,
          executablePath: powershell,
          prefixArgs: ["-NoProfile", "-NonInteractive", "-File", script],
          kind: "powershell-shim",
        };
      }

        return undefined;
      };

      /*
       * PATH, then npm's ACTUAL bin directory, then the inferred roots.
       *
       * npm's real prefix sits between them deliberately. It is a fact the
       * host was told rather than a guess, so it outranks the inferred table
       * -- but PATH still wins, because a runtime the shell can find is the
       * one a person would get from a terminal, and this whole search exists
       * to agree with that.
       */
      const npmBin = options.npmBinDirectory
      const own = options.ownInstallDirectory
      return (
        (await resolveWithin(pathOnly))
        ?? (npmBin === undefined ? undefined : await resolveWithin([npmBin]))
        ?? (own === undefined ? undefined : await resolveWithin([own]))
        ?? (await resolveWithin(
          await installDirectories(commandName, environment, platform, readDirectory),
        ))
      );
    },
  };
}
