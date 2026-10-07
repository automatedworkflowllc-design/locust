"""Derive auditable size and median metrics from raw benchmark output."""
import hashlib
import json
from pathlib import Path
import statistics
import zipfile
from benchmark import peak_cpu

ROOT = Path(__file__).resolve().parent
raw = json.loads((ROOT / "results/measurements.json").read_text(encoding="utf-8"))
for run in raw["runs"] + [raw["idle_node_control"]]:
    run["peak_cpu_percent_machine"] = peak_cpu(run["samples"], raw["logical_cpus"])
(ROOT / "results/measurements.json").write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")
files = list(sorted((ROOT / ".cache/native").glob("*"))) + [ROOT / ".cache/ggml-tiny.en-q5_1.bin"]
manifest = [{"name": path.name, "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in files]
archive = ROOT / ".cache/payload-proxy.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
    for path in files:
        zipped.write(path, path.name)
summary = {"payload_files": manifest, "whisper_payload_bytes": sum(item["bytes"] for item in manifest),
           "deflate_zip_proxy_bytes_NOT_nsis_delta": archive.stat().st_size,
           "sapi_exe_bytes": (ROOT / ".cache/sapi.exe").stat().st_size, "engines": {}}
for engine in ("sapi", "whisper"):
    runs = [run for run in raw["runs"] if run["engine"] == engine]
    keys = ("first_text_ms", "total_ms", "average_cpu_percent_machine", "peak_cpu_percent_machine",
            "peak_working_set_bytes", "peak_commit_bytes", "host_average_cpu_percent")
    summary["engines"][engine] = {key: {"median": statistics.median(run[key] for run in runs),
                                      "min": min(run[key] for run in runs), "max": max(run[key] for run in runs)} for key in keys}
(ROOT / "results/summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, indent=2))
