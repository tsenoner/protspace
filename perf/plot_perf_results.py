#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import platform
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional


def _get_cpu_name() -> str:
    """Return human-readable CPU name. Works on macOS, Linux, and Windows."""
    system = platform.system()
    try:
        if system == "Darwin":
            return subprocess.check_output(
                ["sysctl", "-n", "machdep.cpu.brand_string"],
                stderr=subprocess.DEVNULL,
                text=True,
            ).strip()
        if system == "Linux":
            with open("/proc/cpuinfo") as f:
                for line in f:
                    if line.startswith("model name"):
                        return line.split(":", 1)[1].strip()
        if system == "Windows":
            import winreg  # noqa: PLC0415

            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"HARDWARE\DESCRIPTION\System\CentralProcessor\0",
            )
            value: str = winreg.QueryValueEx(key, "ProcessorNameString")[0]
            return value.strip()
    except Exception:
        pass
    return platform.processor() or "Unknown CPU"


def _get_gpu_name() -> str:
    """Return human-readable GPU name. Works on macOS, Linux, and Windows."""
    system = platform.system()
    try:
        if system == "Darwin":
            out = subprocess.check_output(
                ["system_profiler", "SPDisplaysDataType"],
                stderr=subprocess.DEVNULL,
                text=True,
            )
            m = re.search(r"Chipset Model:\s*(.+)", out)
            if m:
                return m.group(1).strip()
        elif system == "Linux":
            try:
                return (
                    subprocess.check_output(
                        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                        stderr=subprocess.DEVNULL,
                        text=True,
                    )
                    .strip()
                    .split("\n")[0]
                )
            except (FileNotFoundError, subprocess.CalledProcessError):
                out = subprocess.check_output(
                    ["lspci"],
                    stderr=subprocess.DEVNULL,
                    text=True,
                )
                for line in out.split("\n"):
                    if "VGA" in line or "3D" in line:
                        m = re.search(r":\s*(.+)", line)
                        if m:
                            return m.group(1).strip()
        elif system == "Windows":
            out = subprocess.check_output(
                [
                    "powershell",
                    "-Command",
                    "(Get-CimInstance Win32_VideoController).Name",
                ],
                stderr=subprocess.DEVNULL,
                text=True,
            ).strip()
            if out:
                return out.split("\n")[0].strip()
    except Exception:
        pass
    return "Unknown GPU"


def _get_total_ram_gb() -> str:
    """Return total physical RAM as a human-readable string like '64 GB'."""
    try:
        if platform.system() == "Windows":
            import ctypes  # noqa: PLC0415

            class MEMORYSTATUSEX(ctypes.Structure):  # noqa: N801
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX(dwLength=ctypes.sizeof(MEMORYSTATUSEX))
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))  # type: ignore[union-attr]
            total_bytes = stat.ullTotalPhys
        else:
            total_bytes = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")

        gb = total_bytes / (1024**3)
        return f"{gb:.0f} GB"
    except Exception:
        return "Unknown RAM"


def _detect_machine_subtitle() -> str:
    """Build a human-readable machine description for use as a plot subtitle.

    Deduplicates CPU/GPU when they share the same name (e.g. Apple Silicon).
    """
    cpu = _get_cpu_name()
    gpu = _get_gpu_name()
    ram = _get_total_ram_gb()

    # On Apple Silicon the CPU and GPU share the same chip name — deduplicate.
    parts: list[str] = [cpu]
    if gpu != "Unknown GPU" and gpu.lower() != cpu.lower():
        parts.append(gpu)
    parts.append(ram)

    return " | ".join(parts)


SCENARIO_LABELS: dict[str, str] = {
    "annotationChange": "Annotation changes",
    "zoomInOut": "Zooming",
    "zommInOut": "Zooming",
    "zoomFarOut": "Zooming far out",
    "dragCanvas": "Dragging",
    "dragContinuous": "Dragging (sustained)",
    "densityZoom": "Density zoom",
    "clickPoint": "Point selection",
}


BROWSER_STYLES: dict[str, tuple[str, str]] = {
    "chrome": ("Chrome", "#4285F4"),
    "firefox": ("Firefox", "#FF7139"),
    "safari": ("Safari", "#0FB5EE"),
}


def _scenario_label(name: str) -> str:
    return SCENARIO_LABELS.get(name, name)


def _browser_label(name: str) -> str:
    return BROWSER_STYLES.get(name, (name, "black"))[0]


def _browser_color(name: str) -> str:
    return BROWSER_STYLES.get(name, (name, "black"))[1]


@dataclass(frozen=True)
class Stat:
    mean_ms: float
    ci95_ms: float
    n: int


def _parse_dataset_and_browser(file_path: Path) -> tuple[Optional[str], str]:
    name = file_path.name

    if name.startswith("protspace-webgl-perf-suite-") and name.endswith(".json"):
        return None, "unknown"

    if not (name.startswith("webgl-perf-") and name.endswith(".json")):
        raise ValueError(f"Unexpected filename: {name}")

    stem = name[len("webgl-perf-") : -len(".json")]
    if stem.startswith("suite-"):
        browser = stem[len("suite-") :]
        if not browser:
            raise ValueError(f"Cannot parse browser from suite filename: {name}")
        return None, browser

    dataset, _, browser = stem.rpartition("-")
    if not dataset or not browser:
        raise ValueError(f"Cannot parse dataset/browser from: {name}")
    return dataset, browser


def _mean_ci95_ms(values: list[float]) -> Stat:
    n = len(values)
    if n == 0:
        return Stat(mean_ms=float("nan"), ci95_ms=float("nan"), n=0)

    mean = sum(values) / n
    if n == 1:
        return Stat(mean_ms=mean, ci95_ms=0.0, n=1)

    var = sum((x - mean) ** 2 for x in values) / (n - 1)
    std = math.sqrt(var)
    sem = std / math.sqrt(n)
    ci = 1.96 * sem
    return Stat(mean_ms=mean, ci95_ms=ci, n=n)


def _iter_result_files(input_dir: Path) -> Iterable[Path]:
    files: set[Path] = set()
    files.update(input_dir.rglob("webgl-perf-*.json"))
    files.update(input_dir.rglob("protspace-webgl-perf-suite-*.json"))
    yield from sorted(files)


def _iter_dataset_payloads(payload: Any) -> Iterable[dict[str, Any]]:
    if not isinstance(payload, dict):
        return

    results = payload.get("results")
    if isinstance(results, list):
        for entry in results:
            if isinstance(entry, dict):
                yield entry
        return

    yield payload


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Plot ProtSpace WebGL perf JSON results."
    )
    parser.add_argument("--input", type=Path, default=Path("test-results"))
    parser.add_argument("--output", type=Path, default=Path("plots"))
    parser.add_argument(
        "--subtitle",
        type=str,
        default=None,
        help="Custom subtitle for plots (default: auto-detect CPU, GPU, RAM)",
    )
    args = parser.parse_args()

    input_dir = args.input
    output_dir = args.output
    plot_subtitle = args.subtitle if args.subtitle else _detect_machine_subtitle()
    print(f"Plot subtitle: {plot_subtitle}")
    output_dir.mkdir(parents=True, exist_ok=True)

    records: dict[tuple[str, str, str], Stat] = {}
    datasets: set[str] = set()
    browsers: set[str] = set()
    scenarios: set[str] = set()
    dataset_points: dict[str, int] = {}

    for p in _iter_result_files(input_dir):
        dataset_from_name, browser = _parse_dataset_and_browser(p)
        browsers.add(browser)

        with p.open("r", encoding="utf-8") as f:
            file_payload = json.load(f)

        for payload in _iter_dataset_payloads(file_payload):
            dataset: Optional[str] = dataset_from_name
            ds = payload.get("dataset")
            if isinstance(ds, dict):
                ds_id = ds.get("id")
                if isinstance(ds_id, str) and ds_id:
                    dataset = ds_id
            if not dataset:
                dataset = "unknown"
            datasets.add(dataset)

            for scenario in payload.get("scenarios", []):
                scenario_name = scenario.get("name")
                if not scenario_name:
                    continue
                scenarios.add(scenario_name)
                for pass_ in scenario.get("passes") or []:
                    rp = pass_.get("renderedPoints")
                    if isinstance(rp, int) and rp >= 0:
                        dataset_points[dataset] = max(
                            dataset_points.get(dataset, 0), rp
                        )
                durations = [
                    float(pass_.get("durationMs"))
                    for pass_ in (scenario.get("passes") or [])
                    if isinstance(pass_.get("durationMs"), (int, float))
                ]
                records[(scenario_name, browser, dataset)] = _mean_ci95_ms(durations)

    if not records:
        raise SystemExit(f"No perf JSON files found under {input_dir.resolve()}")

    browser_order = ["chrome", "firefox", "safari"]
    browsers_sorted = [b for b in browser_order if b in browsers] + sorted(
        browsers - set(browser_order)
    )

    dataset_order = [
        "5K",
        "40K",
        "beta_lactamase_ec",
        "beta_lactamase_pn",
        "phosphatase",
    ]
    datasets_known = [d for d in dataset_order if d in datasets] + sorted(
        datasets - set(dataset_order)
    )
    if dataset_points:
        datasets_sorted = sorted(
            datasets_known, key=lambda d: (dataset_points.get(d, float("inf")), d)
        )
    else:
        datasets_sorted = datasets_known
        print(
            "warning: no renderedPoints found in any perf JSON; scatter plots will be skipped",
            file=sys.stderr,
        )

    import numpy as np
    import matplotlib.pyplot as plt

    x = np.arange(len(datasets_sorted))
    bar_width = 0.8 / max(1, len(browsers_sorted))

    scenario_order = [
        "annotationChange",
        "zoomInOut",
        "zoomFarOut",
        "dragCanvas",
        "dragContinuous",
        "densityZoom",
        "clickPoint",
    ]
    scenarios_sorted = [s for s in scenario_order if s in scenarios] + sorted(
        scenarios - set(scenario_order)
    )

    for scenario_name in scenarios_sorted:
        fig, ax = plt.subplots(figsize=(12, 6))

        for i, browser in enumerate(browsers_sorted):
            offsets = x + (i - (len(browsers_sorted) - 1) / 2) * bar_width
            means: list[float] = []
            cis: list[float] = []
            for dataset in datasets_sorted:
                stat = records.get((scenario_name, browser, dataset))
                if stat is None:
                    means.append(float("nan"))
                    cis.append(float("nan"))
                else:
                    means.append(stat.mean_ms)
                    cis.append(stat.ci95_ms)

            ax.bar(
                offsets,
                means,
                bar_width,
                label=_browser_label(browser),
                yerr=cis,
                capsize=3,
                color=_browser_color(browser),
            )

        fig.suptitle(f"WebGL render perf: {_scenario_label(scenario_name)}", y=0.98)
        ax.set_title(plot_subtitle, fontsize=10, pad=2)
        ax.set_ylabel("Render time per pass (ms)")
        ax.set_xticks(x)
        ax.set_xticklabels(datasets_sorted)

        plt.setp(ax.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")
        ax.legend(title="Browser", ncol=3, fontsize=9)
        ax.grid(axis="y", alpha=0.2)

        fig.tight_layout(rect=[0, 0, 1, 0.96])

        safe_name = "".join(
            c if c.isalnum() or c in ("-", "_") else "_" for c in scenario_name
        )
        fig.savefig(output_dir / f"{safe_name}.png", dpi=200)
        fig.savefig(output_dir / f"{safe_name}.svg")
        plt.close(fig)

        if dataset_points:
            fig, ax = plt.subplots(figsize=(10, 6))
            for browser in browsers_sorted:
                pts: list[tuple[float, float, float]] = []
                for dataset in datasets_sorted:
                    n_points = dataset_points.get(dataset)
                    stat = records.get((scenario_name, browser, dataset))
                    if n_points is None or stat is None:
                        continue
                    pts.append((float(n_points), stat.mean_ms, stat.ci95_ms))

                pts.sort(key=lambda t: t[0])
                if not pts:
                    continue
                xs = [t[0] for t in pts]
                ys = [t[1] for t in pts]
                yerr = [t[2] for t in pts]
                color = _browser_color(browser)
                ax.errorbar(
                    xs,
                    ys,
                    yerr=yerr,
                    fmt="o",
                    capsize=3,
                    label=_browser_label(browser),
                    color=color,
                    ecolor=color,
                )

                if len(xs) >= 2:
                    coeffs = np.polyfit(xs, ys, 1)
                    x_line = np.linspace(min(xs), max(xs), 100)
                    y_line = coeffs[0] * x_line + coeffs[1]
                    ax.plot(
                        x_line,
                        y_line,
                        linestyle="--",
                        linewidth=1,
                        color=color,
                        alpha=0.7,
                    )

            fig.suptitle(
                f"Dataset size vs render time: {_scenario_label(scenario_name)}", y=0.98
            )
            ax.set_title(plot_subtitle, fontsize=10, pad=2)
            ax.set_xlabel("Dataset size (number of points)")
            ax.set_ylabel("Render time per pass (ms)")
            ax.legend(title="Browser")
            ax.grid(axis="both", alpha=0.2)

            fig.tight_layout(rect=[0, 0, 1, 0.96])
            fig.savefig(output_dir / f"scatter-{safe_name}.png", dpi=200)
            fig.savefig(output_dir / f"scatter-{safe_name}.svg")
            plt.close(fig)

    print(f"Wrote plots to: {output_dir.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
