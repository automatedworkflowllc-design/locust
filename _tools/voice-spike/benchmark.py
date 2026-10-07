"""Windows-only, dependency-free subprocess benchmark. No microphone or network access."""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import re
import subprocess
import threading
import time
import unittest
import wave

ROOT = Path(__file__).resolve().parent
SCRIPT = "Please review the latest changes, check the tests, and tell me which files need attention before we release the new version."


def words(text):
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", text.lower())


def wer(reference, hypothesis):
    expected, actual = words(reference), words(hypothesis)
    row = list(range(len(actual) + 1))
    for i, token in enumerate(expected, 1):
        nxt = [i]
        for j, candidate in enumerate(actual, 1):
            nxt.append(min(row[j] + 1, nxt[j - 1] + 1, row[j - 1] + (token != candidate)))
        row = nxt
    return {"errors": row[-1], "reference_words": len(expected), "percent": 100 * row[-1] / len(expected)}


def peak_cpu(samples, logical_cpus):
    # Windows process CPU counters are tick-quantized. A short terminal sample
    # can report impossible bursts; use only intervals at least 90 ms long.
    return max((100 * (b["cpu_seconds"] - a["cpu_seconds"]) / ((b["ms"] - a["ms"]) / 1000) / logical_cpus
                for a, b in zip(samples, samples[1:]) if b["ms"] - a["ms"] >= 90), default=0)


def fixture():
    with wave.open(str(ROOT / ".cache/source.wav"), "rb") as source:
        assert (source.getnchannels(), source.getsampwidth(), source.getframerate()) == (1, 2, 16000)
        frames = source.readframes(source.getnframes())
    if len(frames) > 320000:
        raise ValueError("Speech exceeds ten seconds; lower synthesis duration instead of cutting words")
    output = ROOT / "results/clip.wav"
    output.parent.mkdir(exist_ok=True)
    with wave.open(str(output), "wb") as target:
        target.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        target.writeframes(frames + bytes(320000 - len(frames)))
    return {"duration_seconds": 10, "spoken_seconds": len(frames) / 32000, "bytes": output.stat().st_size,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "reference": SCRIPT}


class MemoryCounters(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
        (name, ctypes.c_size_t) for name in ("PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
        "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]


class FileTime(ctypes.Structure):
    _fields_ = [("low", wintypes.DWORD), ("high", wintypes.DWORD)]
    def ticks(self):
        return (self.high << 32) | self.low


def measure(label, command, logical_cpus=12):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel.GetProcessTimes.argtypes = (wintypes.HANDLE,) + (ctypes.POINTER(FileTime),) * 4
    kernel.GetSystemTimes.argtypes = (ctypes.POINTER(FileTime),) * 3
    psapi.GetProcessMemoryInfo.argtypes = (wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD)
    start = time.perf_counter()
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               creationflags=subprocess.CREATE_NO_WINDOW, encoding="utf-8", errors="replace")
    handle = kernel.OpenProcess(0x0400 | 0x0010, False, process.pid)
    if not handle:
        process.kill()
        raise ctypes.WinError(ctypes.get_last_error())
    stdout, stderr, samples = [], [], []
    def read_lines(pipe, output):
        for line in pipe:
            output.append({"ms": (time.perf_counter() - start) * 1000, "line": line.rstrip()})
    readers = [threading.Thread(target=read_lines, args=(process.stdout, stdout)),
               threading.Thread(target=read_lines, args=(process.stderr, stderr))]
    finished = threading.Event()
    end_ms = []
    def await_exit():
        process.wait()
        end_ms.append((time.perf_counter() - start) * 1000)
        finished.set()
    waiter = threading.Thread(target=await_exit)
    waiter.start()
    for reader in readers:
        reader.start()
    def sample():
        creation, exit_time, system, user = [FileTime() for _ in range(4)]
        memory = MemoryCounters()
        memory.cb = ctypes.sizeof(memory)
        if not kernel.GetProcessTimes(handle, ctypes.byref(creation), ctypes.byref(exit_time), ctypes.byref(system), ctypes.byref(user)):
            raise ctypes.WinError(ctypes.get_last_error())
        memory_ok = psapi.GetProcessMemoryInfo(handle, ctypes.byref(memory), memory.cb)
        idle, host_system, host_user = [FileTime() for _ in range(3)]
        kernel.GetSystemTimes(ctypes.byref(idle), ctypes.byref(host_system), ctypes.byref(host_user))
        samples.append({"ms": (time.perf_counter() - start) * 1000, "cpu_seconds": (system.ticks() + user.ticks()) / 1e7,
                        "peak_working_set_bytes": memory.PeakWorkingSetSize if memory_ok else 0,
                        "working_set_bytes": memory.WorkingSetSize if memory_ok else 0,
                        "peak_commit_bytes": memory.PeakPagefileUsage if memory_ok else 0,
                        "host_idle": idle.ticks(), "host_total": host_system.ticks() + host_user.ticks()})
    try:
        while not finished.is_set():
            sample()
            if time.perf_counter() - start > 120:
                process.kill()
                raise TimeoutError(label)
            finished.wait(0.1)
        sample()  # CPU times remain available through the retained process handle.
        for reader in readers:
            reader.join(timeout=5)
        waiter.join()
        elapsed_ms = end_ms[0]
    finally:
        kernel.CloseHandle(handle)
    sampled_peak_cpu = peak_cpu(samples, logical_cpus)
    finals = [line for line in stdout if line["line"].startswith("TEXT\t")]
    hypotheses = [line for line in stdout if line["line"].startswith("HYP\t")]
    if label == "whisper":
        finals = [line for line in stdout if re.match(r"^\[\d\d:", line["line"])]
        transcript = " ".join(re.sub(r"^\[[^]]+\]\s*", "", line["line"]) for line in finals)
    else:
        transcript = " ".join(line["line"].split("\t", 2)[2] for line in finals)
    first, last = samples[0], samples[-1]
    host_total = last["host_total"] - first["host_total"]
    return {"engine": label, "exit_code": process.returncode, "first_text_ms": finals[0]["ms"] if finals else None,
            "first_hypothesis_ms": hypotheses[0]["ms"] if hypotheses else None, "total_ms": elapsed_ms,
            "cpu_seconds": last["cpu_seconds"], "peak_cpu_percent_machine": sampled_peak_cpu,
            "average_cpu_percent_machine": 100 * last["cpu_seconds"] / (elapsed_ms / 1000) / logical_cpus,
            "peak_working_set_bytes": max(s["peak_working_set_bytes"] for s in samples),
            "peak_commit_bytes": max(s["peak_commit_bytes"] for s in samples),
            "host_average_cpu_percent": 100 * (1 - (last["host_idle"] - first["host_idle"]) / host_total) if host_total else None,
            "transcript": transcript, "wer": wer(SCRIPT, transcript) if label != "idle" else None,
            "stdout": stdout, "stderr": stderr, "samples": samples}


class Tests(unittest.TestCase):
    def test_normalization(self):
        self.assertEqual(words("CHECK, the Tests!"), ["check", "the", "tests"])
    def test_edits(self):
        self.assertEqual(wer("one two three", "one four three")["errors"], 1)
        self.assertEqual(wer("one two three", "one three")["errors"], 1)
        self.assertEqual(wer("one two three", "one two four three")["errors"], 1)
        self.assertEqual(wer(SCRIPT, SCRIPT.upper())["percent"], 0)
    def test_fixture(self):
        with wave.open(str(ROOT / "results/clip.wav"), "rb") as source:
            self.assertEqual(source.getparams()[:4], (1, 2, 16000, 160000))
    def test_peak_excludes_short_terminal_interval(self):
        samples = [{"ms": 0, "cpu_seconds": 0}, {"ms": 100, "cpu_seconds": 0.1}, {"ms": 101, "cpu_seconds": 0.12}]
        self.assertAlmostEqual(peak_cpu(samples, 12), 100 / 12)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    if args.test:
        unittest.main(argv=[__file__])
    else:
        clip = fixture()
        results = []
        for run in range(args.runs):
            for engine, command in [("sapi", [str(ROOT / ".cache/sapi.exe"), "recognize", str(ROOT / "results/clip.wav")]),
                                    ("whisper", [str(ROOT / ".cache/native/whisper-cli.exe"), "-m", str(ROOT / ".cache/ggml-tiny.en-q5_1.bin"),
                                                 "-f", str(ROOT / "results/clip.wav"), "-t", "2", "-l", "en", "-ng"])]:
                result = measure(engine, command)
                result["run"] = run + 1
                results.append(result)
                print(json.dumps({key: result[key] for key in ("engine", "run", "exit_code", "first_text_ms", "total_ms", "transcript", "wer")}), flush=True)
        idle = measure("idle", ["node", "-e", "setTimeout(() => {}, 10000)"])
        output = {"fixture": clip, "logical_cpus": 12, "sample_interval_ms": 100, "runs": results, "idle_node_control": idle}
        (ROOT / "results/measurements.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
        if any(r["exit_code"] != 0 or not r["transcript"] for r in results):
            raise SystemExit("Recognition failed; inspect retained measurements")
