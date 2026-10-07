# Offline voice spike

Throwaway Windows prototypes only; nothing imports these from Locust. The audio
fixture is generated locally with Microsoft David Desktop, not a recording of a
person. Recognition uses unconstrained dictation, not a grammar of the reference
sentence, and Whisper receives no reference prompt.

From the repository root, in Windows PowerShell with Python 3 and Node installed:

```powershell
& _tools/voice-spike/setup.ps1
python _tools/voice-spike/benchmark.py --runs 3
python _tools/voice-spike/summarize.py
python _tools/voice-spike/benchmark.py --test
```

Setup requires internet to download the pinned official Windows x64 whisper.cpp
CPU archive and tiny.en Q5_1 model; it verifies both SHA-256 hashes. Downloads,
compiled executables, and compiler temporary files stay in ignored `.cache/`.
The benchmark itself has no network operations. It uses the supplied WAV only;
it does not request microphone access or persist any user audio.

`Sapi.cs` uses .NET Framework's installed en-US System.Speech engine and a
DictationGrammar. `benchmark.py` starts it and whisper.cpp sequentially three
times, including process startup/model loading. Whisper uses two compute threads
and CPU only. Neither recognizer remains running afterward. The ten-second idle
Node control loads no recognizer and is NOT a measurement of Locust idle CPU.

`results/measurements.json` contains timestamped stdout/stderr and 100-ms Windows
process-counter samples. Peak CPU ignores terminal intervals shorter than 90 ms
because Windows CPU-time ticks distort short samples. CPU percentages use all
12 logical processors as 100%; multiply by 12 for single-core-equivalent usage.
RAM includes sampled OS peak working set and peak private commit. The harness
does not benchmark a descendant process tree; these two recognizers run in their
own single process. Python sampler overhead is excluded. Host CPU includes
unrelated concurrent work.

`results/summary.json` contains derived medians, ranges, retained runtime/model
file hashes, and a DEFLATE zip size proxy. That archive is NOT a measured NSIS
installer delta. `results/clip.wav` is 16-kHz mono 16-bit PCM, exactly ten seconds;
8.79 seconds of synthesized speech plus trailing silence. WER uses lowercase
words without punctuation and Levenshtein edit distance against 21 words.

whisper.cpp build b5454 reports 1.9.5 and is an upstream pre-release build, not a
production dependency decision. Its code and Whisper weights are MIT licensed;
a shipping implementation must include their license notices and separately
verify native prerequisites and binaries on every supported target. Windows SAPI
uses the Windows-licensed engine already installed on this machine; do not
redistribute Microsoft's engine or voices with the app.
