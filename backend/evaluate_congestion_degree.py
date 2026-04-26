from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from traffic_ew.congestion import LEVEL_THRESHOLDS, calculate_congestion_degree, congestion_level_from_score


def fill_nan_with_sensor_median(values: np.ndarray) -> np.ndarray:
    out = values.astype(np.float32, copy=True)
    med = np.nanmedian(out, axis=0)
    if not np.all(np.isfinite(med)):
        global_med = float(np.nanmedian(out))
        med = np.where(np.isfinite(med), med, global_med)
    rows, cols = np.where(~np.isfinite(out))
    if rows.size:
        out[rows, cols] = med[cols]
    return out


def build_profiles(
    *,
    timestamps: pd.DatetimeIndex,
    flow: np.ndarray,
    occupancy: np.ndarray,
    speed: np.ndarray,
) -> dict[str, dict[str, np.ndarray]]:
    n_days = len(timestamps) // 288
    trim = n_days * 288
    weekday_by_day = np.asarray(timestamps.dayofweek[:trim:288] < 5, dtype=bool)
    metrics = {"flow": flow[:trim], "occupancy": occupancy[:trim], "speed": speed[:trim]}
    profiles: dict[str, dict[str, np.ndarray]] = {}
    for name, values in metrics.items():
        _, n_nodes = values.shape
        reshaped = values.reshape(n_days, 288, n_nodes)
        out = {k: np.zeros((2, 288, n_nodes), dtype=np.float32) for k in ("q10", "median", "q90")}
        for day_type, mask in enumerate((weekday_by_day, ~weekday_by_day)):
            segment = reshaped[mask] if np.any(mask) else reshaped
            out["q10"][day_type] = np.percentile(segment, 10, axis=0)
            out["median"][day_type] = np.median(segment, axis=0)
            out["q90"][day_type] = np.percentile(segment, 90, axis=0)
        profiles[name] = out
    return profiles


def old_score(
    *,
    flow: np.ndarray,
    occupancy: np.ndarray,
    speed: np.ndarray,
    flow_med: np.ndarray,
    flow_q90: np.ndarray,
    occ_med: np.ndarray,
    occ_q90: np.ndarray,
    speed_med: np.ndarray,
    speed_q10: np.ndarray,
) -> np.ndarray:
    occ_component = np.clip((occupancy - occ_med) / np.maximum(occ_q90 - occ_med, 1e-6), 0.0, 1.0)
    flow_component = np.clip((flow - flow_med) / np.maximum(flow_q90 - flow_med, 1e-6), 0.0, 1.0)
    speed_component = np.clip((speed_med - speed) / np.maximum(speed_med - speed_q10, 1e-6), 0.0, 1.0)
    pressure = flow / np.maximum(speed, 5.0)
    pressure_base = flow_med / np.maximum(speed_med, 5.0)
    pressure_component = np.clip((pressure - pressure_base) / np.maximum(pressure_base, 1e-6), 0.0, 1.0)
    combined = 0.50 * occ_component + 0.20 * flow_component + 0.20 * speed_component + 0.10 * pressure_component
    combined[(speed_component < 0.15) & (flow_component < 0.15)] *= 0.55
    combined[(occ_component < 0.2) & (speed_component < 0.2)] *= 0.5
    return np.clip(combined, 0.0, 1.0).astype(np.float32)


def level_from_old_score(score: float) -> str:
    if score >= 0.80:
        return "severe"
    if score >= 0.60:
        return "high"
    if score >= 0.35:
        return "medium"
    return "low"


def render_table(headers: list[str], rows: list[list[object]]) -> str:
    text_rows = [[str(item) for item in row] for row in rows]
    widths = [
        max(len(headers[i]), *(len(row[i]) for row in text_rows))
        for i in range(len(headers))
    ]
    lines = [" | ".join(headers[i].ljust(widths[i]) for i in range(len(headers)))]
    lines.append("-+-".join("-" * width for width in widths))
    for row in text_rows:
        lines.append(" | ".join(row[i].ljust(widths[i]) for i in range(len(headers))))
    return "\n".join(lines)


def run_scenarios() -> None:
    baseline = {
        "flow_med": 120.0,
        "flow_q90": 180.0,
        "occ_med": 0.060,
        "occ_q90": 0.130,
        "speed_med": 63.0,
        "speed_q10": 48.0,
        "speed_q90": 68.0,
    }
    scenarios = [
        ("free_flow", 110.0, 4.5, 66.0, "fast and sparse"),
        ("dense_free_flow", 190.0, 16.0, 64.0, "high demand but still fast"),
        ("mild_recurrent", 170.0, 12.0, 50.0, "speed begins to drop"),
        ("queue_discharge", 205.0, 21.0, 42.0, "loaded road with degraded speed"),
        ("breakdown", 160.0, 18.0, 35.0, "clear congestion"),
        ("stop_and_go", 110.0, 25.0, 22.0, "severe stop-go traffic"),
        ("low_demand_slow", 30.0, 5.0, 28.0, "slow but weak demand evidence"),
        ("empty_night", 12.0, 1.5, 58.0, "nearly empty road"),
        ("weather_cautious", 90.0, 8.0, 45.0, "cautious speed without heavy load"),
    ]

    rows: list[list[object]] = []
    for name, flow, occ_pct, speed, note in scenarios:
        occ = occ_pct / 100.0
        old = float(
            old_score(
                flow=np.asarray([flow], dtype=np.float32),
                occupancy=np.asarray([occ], dtype=np.float32),
                speed=np.asarray([speed], dtype=np.float32),
                flow_med=np.asarray([baseline["flow_med"]], dtype=np.float32),
                flow_q90=np.asarray([baseline["flow_q90"]], dtype=np.float32),
                occ_med=np.asarray([baseline["occ_med"]], dtype=np.float32),
                occ_q90=np.asarray([baseline["occ_q90"]], dtype=np.float32),
                speed_med=np.asarray([baseline["speed_med"]], dtype=np.float32),
                speed_q10=np.asarray([baseline["speed_q10"]], dtype=np.float32),
            )[0]
        )
        new = float(
            calculate_congestion_degree(
                flow=flow,
                occupancy=occ,
                speed=speed,
                **baseline,
            )["score"].item()
        )
        rows.append(
            [
                name,
                f"{old:.3f}",
                level_from_old_score(old),
                f"{new:.3f}",
                congestion_level_from_score(new),
                note,
            ]
        )
    print("\nScenario checks")
    print(render_table(["scenario", "old", "old_level", "new", "new_level", "intent"], rows))


def evaluate_dataset(traffic_dir: Path, max_days: int) -> None:
    timestamps = pd.to_datetime(np.load(traffic_dir / "timestamps.npy").astype("datetime64[m]").astype(str))
    flow = fill_nan_with_sensor_median(np.load(traffic_dir / "flow.npy").astype(np.float32))
    occupancy = fill_nan_with_sensor_median(np.load(traffic_dir / "occupancy.npy").astype(np.float32))
    speed = fill_nan_with_sensor_median(np.load(traffic_dir / "speed.npy").astype(np.float32))

    total_days = len(timestamps) // 288
    days = total_days if max_days <= 0 else min(max_days, total_days)
    trim = days * 288
    timestamps = timestamps[:trim]
    flow = flow[:trim]
    occupancy = occupancy[:trim]
    speed = speed[:trim]

    profiles = build_profiles(timestamps=timestamps, flow=flow, occupancy=occupancy, speed=speed)
    n_nodes = speed.shape[1]
    slots = np.tile(np.arange(288, dtype=np.int32), days)
    day_types = np.repeat(np.asarray(timestamps.dayofweek[:trim:288] >= 5, dtype=np.int32), 288)

    old_scores = np.zeros((trim, n_nodes), dtype=np.float32)
    new_scores = np.zeros((trim, n_nodes), dtype=np.float32)

    for day_type in (0, 1):
        for slot in range(288):
            rows = np.where((day_types == day_type) & (slots == slot))[0]
            if rows.size == 0:
                continue
            kwargs = {
                "flow_med": profiles["flow"]["median"][day_type, slot],
                "flow_q90": profiles["flow"]["q90"][day_type, slot],
                "occ_med": profiles["occupancy"]["median"][day_type, slot],
                "occ_q90": profiles["occupancy"]["q90"][day_type, slot],
                "speed_med": profiles["speed"]["median"][day_type, slot],
                "speed_q10": profiles["speed"]["q10"][day_type, slot],
            }
            old_scores[rows] = old_score(
                flow=flow[rows],
                occupancy=occupancy[rows],
                speed=speed[rows],
                **kwargs,
            )
            new_scores[rows] = calculate_congestion_degree(
                flow=flow[rows],
                occupancy=occupancy[rows],
                speed=speed[rows],
                speed_q90=profiles["speed"]["q90"][day_type, slot],
                **kwargs,
            )["score"]

    flat_old = old_scores.ravel()
    flat_new = new_scores.ravel()
    flat_speed = speed.ravel()
    flat_occ_pct = occupancy.ravel() * 100.0

    weak_congestion = (flat_speed < 45.0) & (flat_occ_pct >= 12.0)
    severe_congestion = (flat_speed < 35.0) & (flat_occ_pct >= 14.0)
    free_flow = (flat_speed >= 62.0) & (flat_occ_pct <= 7.0)
    fast_high_occ = (flat_speed >= 60.0) & (flat_occ_pct >= 12.0)

    def binary_stats(scores: np.ndarray, label: np.ndarray) -> tuple[float, float, float]:
        pred = scores >= 0.35
        tp = float(np.sum(pred & label))
        fp = float(np.sum(pred & ~label))
        fn = float(np.sum(~pred & label))
        tn = float(np.sum(~pred & ~label))
        precision = tp / max(tp + fp, 1.0)
        recall = tp / max(tp + fn, 1.0)
        fpr = fp / max(fp + tn, 1.0)
        return precision, recall, fpr

    def alert_rate(scores: np.ndarray, mask: np.ndarray) -> float:
        if not np.any(mask):
            return 0.0
        return float(np.mean(scores[mask] >= 0.35))

    def level_share(
        scores: np.ndarray,
        *,
        medium_threshold: float,
        high_threshold: float,
        severe_threshold: float,
    ) -> str:
        medium = float(np.mean((scores >= medium_threshold) & (scores < high_threshold)))
        high = float(np.mean((scores >= high_threshold) & (scores < severe_threshold)))
        severe = float(np.mean(scores >= severe_threshold))
        return f"M {medium:.3f} / H {high:.3f} / S {severe:.3f}"

    old_precision, old_recall, old_fpr = binary_stats(flat_old, weak_congestion)
    new_precision, new_recall, new_fpr = binary_stats(flat_new, weak_congestion)

    rows = [
        ["days", days, days, "evaluated local period"],
        ["samples", flat_new.size, flat_new.size, "time x sensors"],
        ["weak_congestion_base_rate", f"{np.mean(weak_congestion):.4f}", f"{np.mean(weak_congestion):.4f}", "speed<45 & occ>=12"],
        ["free_flow_base_rate", f"{np.mean(free_flow):.4f}", f"{np.mean(free_flow):.4f}", "speed>=62 & occ<=7"],
        ["medium_plus_share", f"{np.mean(flat_old >= 0.35):.4f}", f"{np.mean(flat_new >= 0.35):.4f}", "avoid broad over-alerting"],
        [
            "level_share",
            level_share(flat_old, medium_threshold=0.35, high_threshold=0.60, severe_threshold=0.80),
            level_share(
                flat_new,
                medium_threshold=LEVEL_THRESHOLDS["medium"],
                high_threshold=LEVEL_THRESHOLDS["high"],
                severe_threshold=LEVEL_THRESHOLDS["severe"],
            ),
            "M/H/S shares",
        ],
        ["weak_congestion_precision", f"{old_precision:.4f}", f"{new_precision:.4f}", "score>=0.35 vs speed<45 & occ>=12"],
        ["weak_congestion_recall", f"{old_recall:.4f}", f"{new_recall:.4f}", "keep recall for loaded slow states"],
        ["weak_congestion_fpr", f"{old_fpr:.4f}", f"{new_fpr:.4f}", "lower is better"],
        ["severe_recall", f"{alert_rate(flat_old, severe_congestion):.4f}", f"{alert_rate(flat_new, severe_congestion):.4f}", "speed<35 & occ>=14"],
        ["free_flow_alert_rate", f"{alert_rate(flat_old, free_flow):.4f}", f"{alert_rate(flat_new, free_flow):.4f}", "speed>=62 & occ<=7"],
        ["fast_high_occ_alert_rate", f"{alert_rate(flat_old, fast_high_occ):.4f}", f"{alert_rate(flat_new, fast_high_occ):.4f}", "speed>=60 & occ>=12"],
        ["q50", f"{np.quantile(flat_old, 0.50):.4f}", f"{np.quantile(flat_new, 0.50):.4f}", "median score"],
        ["q90", f"{np.quantile(flat_old, 0.90):.4f}", f"{np.quantile(flat_new, 0.90):.4f}", "upper-tail score"],
        ["q99", f"{np.quantile(flat_old, 0.99):.4f}", f"{np.quantile(flat_new, 0.99):.4f}", "extreme score"],
    ]
    print("\nDataset sanity metrics")
    print(render_table(["metric", "old", "new", "note"], rows))


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate congestion degree v2 scenarios.")
    parser.add_argument(
        "--traffic-dir",
        default=str(Path(ROOT) / "Caltrans_2023_D03" / "processed_d03_2023_ml95_enriched"),
        help="Directory containing flow/occupancy/speed/timestamps npy files.",
    )
    parser.add_argument(
        "--max-days",
        type=int,
        default=120,
        help="Number of days to evaluate; use 0 for the full local year.",
    )
    parser.add_argument("--scenario-only", action="store_true", help="Skip local dataset metrics.")
    args = parser.parse_args()

    run_scenarios()
    if not args.scenario_only:
        evaluate_dataset(Path(args.traffic_dir), args.max_days)


if __name__ == "__main__":
    main()
