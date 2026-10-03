import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A COMMAND IN A TERMINAL NOBODY SEES (0.556, Windows).
 *
 * `claude --cloud "task"` refuses anything but an interactive terminal, so
 * Locust used to open a console window for it -- and then knew nothing:
 * not the session's id, not its link, not whether it started. Colin,
 * 2026-10-02: "this dumbass window pops up ... nothing happens". Measured on
 * Claude Code 2.1.288: given a pseudo console (a terminal with no window),
 * it creates the session, prints its id, its claude.ai link and the commit it
 * starts from, and exits on its own in about four seconds.
 *
 * Windows' pseudo console is a kernel32 API with no Node binding here, so a
 * small PowerShell script reaches it. The program runs inside it; what it
 * draws comes back; the terminal's one question (where is the cursor?) is
 * answered, since a program that asks it waits for the answer. When what it
 * draws matches `stopWhen` -- Claude Code asking whether the folder is
 * trusted, a question that is the person's -- or `seconds` pass, the
 * program and everything it started are ended, and nothing is answered.
 */

const HELPER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32.SafeHandles;
public static class LocustPty {
  [StructLayout(LayoutKind.Sequential)] public struct COORD { public short X; public short Y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] public struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern int CreatePseudoConsole(COORD size, SafeFileHandle hInput, SafeFileHandle hOutput, uint flags, out IntPtr hPC);
  [DllImport("kernel32.dll", SetLastError = true)] static extern void ClosePseudoConsole(IntPtr hPC);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out SafeFileHandle r, out SafeFileHandle w, IntPtr sa, int size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  public static byte[] Run(string cwd, string line, int seconds, string stopWhen) {
    SafeFileHandle inR, inW, outR, outW;
    CreatePipe(out inR, out inW, IntPtr.Zero, 0); CreatePipe(out outR, out outW, IntPtr.Zero, 0);
    IntPtr pc;
    if (CreatePseudoConsole(new COORD { X = 400, Y = 50 }, inR, outW, 0, out pc) != 0) throw new Exception("no pseudo console");
    IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
    var si = new STARTUPINFOEX(); si.StartupInfo.cb = Marshal.SizeOf(si);
    // Standard handles of its own (none): otherwise the program writes to this script's pipes, not the terminal.
    si.StartupInfo.dwFlags = 0x100;
    si.lpAttributeList = Marshal.AllocHGlobal(size); InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, ref size);
    UpdateProcThreadAttribute(si.lpAttributeList, 0, (IntPtr)0x00020016, pc, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero);
    PROCESS_INFORMATION pi;
    if (!CreateProcess(null, line, IntPtr.Zero, IntPtr.Zero, false, 0x00080000, IntPtr.Zero, cwd, ref si, out pi)) throw new Exception("not started");
    var drawn = new MemoryStream();
    var reader = new Thread(() => { var s = new FileStream(outR, FileAccess.Read); var buf = new byte[8192]; int n;
      try { while ((n = s.Read(buf, 0, buf.Length)) > 0) lock (drawn) drawn.Write(buf, 0, n); } catch { } });
    reader.IsBackground = true; reader.Start();
    var input = new FileStream(inW, FileAccess.Write);
    var stop = stopWhen.Length > 0 ? new Regex(stopWhen) : null;
    var answered = false; var exited = false;
    for (int tick = 0; tick < seconds * 10; tick++) {
      if (WaitForSingleObject(pi.hProcess, 100) == 0) { exited = true; break; }
      string text; lock (drawn) text = System.Text.Encoding.UTF8.GetString(drawn.ToArray());
      if (!answered && text.Contains("\u001b[6n")) { var a = System.Text.Encoding.ASCII.GetBytes("\u001b[1;1R"); input.Write(a, 0, a.Length); input.Flush(); answered = true; }
      if (stop != null && stop.IsMatch(Regex.Replace(text, "\u001b\\[[0-9;?<>=]*[ -/]*[@-~]", ""))) break;
    }
    if (!exited) {
      var kill = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("taskkill.exe", "/PID " + pi.dwProcessId + " /T /F") { CreateNoWindow = true, UseShellExecute = false });
      kill.WaitForExit(5000);
    }
    ClosePseudoConsole(pc);
    reader.Join(1000);
    lock (drawn) return drawn.ToArray();
  }
}
"@
$drawn = [LocustPty]::Run($env:LOCUST_PTY_CWD, $env:LOCUST_PTY_LINE, [int]$env:LOCUST_PTY_SECONDS, $env:LOCUST_PTY_STOP)
[Console]::Out.Write([Convert]::ToBase64String($drawn))
`

/** What a terminal drew, as text: colours, cursor moves and titles taken out. */
export function plainTerminalText(drawn: string): string {
  return drawn
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[()][0-9A-Za-z]|\u001b[=>78MDEc]/g, '')
    .replace(/\r/g, '')
    // What is left of the terminal's own controls (a shift-in, a bell): never words.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

export interface PseudoTerminalRun {
  /** The command line, as CreateProcess takes it. */
  readonly line: string
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly seconds: number
  /** A .NET regular expression: once what is drawn matches, the program is ended. */
  readonly stopWhen?: string
}

export type RunInPseudoTerminal = (run: PseudoTerminalRun) => Promise<{ readonly ok: true; readonly drawn: string } | { readonly ok: false }>

/** The helper, written once to the temp folder under a name that changes when it does. */
async function helperPath(): Promise<string> {
  const path = join(tmpdir(), `locust-terminal-pty-${createHash('sha256').update(HELPER).digest('hex').slice(0, 12)}.ps1`)
  const current = await readFile(path, 'utf8').catch(() => undefined)
  if (current !== HELPER) await writeFile(path, HELPER, 'utf8')
  return path
}

export const runInPseudoTerminal: RunInPseudoTerminal = async (run) => {
  if (process.platform !== 'win32') return { ok: false }
  const helper = await helperPath().catch(() => undefined)
  if (helper === undefined) return { ok: false }
  return new Promise((resolve) => {
    let out = ''
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper], {
      cwd: run.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, ...run.env, LOCUST_PTY_CWD: run.cwd, LOCUST_PTY_LINE: run.line, LOCUST_PTY_SECONDS: String(run.seconds), LOCUST_PTY_STOP: run.stopWhen ?? '' }
    })
    // The helper ends the program at `seconds`; this is for the helper itself.
    const guard = setTimeout(() => child.kill(), (run.seconds + 30) * 1000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { out += chunk })
    child.once('error', () => { clearTimeout(guard); resolve({ ok: false }) })
    child.once('close', (code) => {
      clearTimeout(guard)
      if (code !== 0 || !/^[A-Za-z0-9+/=]*$/.test(out.trim())) return resolve({ ok: false })
      resolve({ ok: true, drawn: Buffer.from(out.trim(), 'base64').toString('utf8') })
    })
  })
}
