from __future__ import annotations

from typing import Any

import numpy as np


LEVEL_THRESHOLDS = {
    "medium": 0.35,
    "high": 0.62,
    "severe": 0.82,
}


def smoothstep01(value: Any) -> np.ndarray:
    x = np.clip(np.asarray(value, dtype=np.float32), 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def congestion_levels_from_scores(scores: Any) -> np.ndarray:
    arr = np.asarray(scores, dtype=np.float32)
    levels = np.zeros(arr.shape, dtype=np.int32)
    levels[arr >= LEVEL_THRESHOLDS["medium"]] = 1
    levels[arr >= LEVEL_THRESHOLDS["high"]] = 2
    levels[arr >= LEVEL_THRESHOLDS["severe"]] = 3
    return levels


def congestion_level_from_score(score: float) -> str:
    value = float(score)
    if value >= LEVEL_THRESHOLDS["severe"]:
        return "severe"
    if value >= LEVEL_THRESHOLDS["high"]:
        return "high"
    if value >= LEVEL_THRESHOLDS["medium"]:
        return "medium"
    return "low"


def calculate_congestion_degree(
    *,
    flow: Any,
    occupancy: Any,
    speed: Any,
    flow_med: Any,
    flow_q90: Any,
    occ_med: Any,
    occ_q90: Any,
    speed_med: Any,
    speed_q10: Any,
    speed_q90: Any,
) -> dict[str, np.ndarray]:
    """Compute a continuous congestion degree.

    The score is led by speed loss and confirmed by demand pressure. High
    occupancy or high flow alone cannot create a high congestion degree while
    speed remains close to free flow.
    """

    flow_arr = np.maximum(np.asarray(flow, dtype=np.float32), 0.0)
    occ_arr = np.maximum(np.asarray(occupancy, dtype=np.float32), 0.0)
    speed_arr = np.maximum(np.asarray(speed, dtype=np.float32), 0.0)
    flow_med_arr = np.maximum(np.asarray(flow_med, dtype=np.float32), 0.0)
    flow_q90_arr = np.maximum(np.asarray(flow_q90, dtype=np.float32), flow_med_arr)
    occ_med_arr = np.maximum(np.asarray(occ_med, dtype=np.float32), 0.0)
    occ_q90_arr = np.maximum(np.asarray(occ_q90, dtype=np.float32), occ_med_arr)
    speed_med_arr = np.maximum(np.asarray(speed_med, dtype=np.float32), 0.0)
    speed_q10_arr = np.minimum(np.asarray(speed_q10, dtype=np.float32), speed_med_arr)
    speed_q90_arr = np.maximum(np.asarray(speed_q90, dtype=np.float32), speed_med_arr)

    ref_speed = np.maximum(np.maximum(speed_med_arr, speed_q90_arr * 0.85), 35.0)
    speed_loss = smoothstep01((ref_speed - speed_arr) / np.maximum(ref_speed * 0.42, 12.0))
    speed_abs = smoothstep01((50.0 - speed_arr) / 25.0)
    historical_drop = smoothstep01(
        (speed_med_arr - speed_arr) / np.maximum(speed_med_arr - speed_q10_arr, 8.0)
    )
    speed_component = np.maximum(
        0.58 * speed_loss + 0.24 * speed_abs + 0.18 * historical_drop,
        speed_abs * 0.90,
    )

    occ_pct = occ_arr * 100.0
    occ_med_pct = occ_med_arr * 100.0
    occ_q90_pct = occ_q90_arr * 100.0
    occ_span = np.maximum(np.maximum(occ_q90_pct - occ_med_pct, occ_med_pct * 0.60), 2.5)
    occ_rel = smoothstep01((occ_pct - occ_med_pct) / occ_span)
    occ_abs = smoothstep01((occ_pct - 9.0) / 13.0)
    occupancy_component = np.clip(0.62 * occ_rel + 0.38 * occ_abs, 0.0, 1.0)

    flow_span = np.maximum(flow_q90_arr - flow_med_arr, 12.0)
    flow_rel = smoothstep01((flow_arr - flow_med_arr) / flow_span)
    flow_load = smoothstep01((flow_arr - 0.75 * flow_med_arr) / np.maximum(flow_med_arr * 0.65, 12.0))
    flow_component = np.clip(0.72 * flow_rel + 0.28 * flow_load, 0.0, 1.0)

    pressure = flow_arr / np.maximum(speed_arr, 5.0)
    pressure_base = flow_med_arr / np.maximum(speed_med_arr, 5.0)
    pressure_component = smoothstep01(
        (pressure - pressure_base) / np.maximum(pressure_base * 0.80, 0.12)
    )

    demand_component = np.maximum(
        occupancy_component,
        np.clip(0.55 * pressure_component + 0.45 * flow_component, 0.0, 1.0),
    )
    agreement = np.sqrt(np.maximum(speed_component * demand_component, 0.0))
    degree = (
        speed_component * (0.35 + 0.45 * demand_component)
        + 0.15 * agreement
        + 0.05 * speed_component * pressure_component
    )

    degree = np.where(
        (speed_arr <= 45.0) & (occ_pct >= 12.0),
        np.maximum(degree, 0.52),
        degree,
    )
    degree = np.where(
        (speed_arr <= 35.0) & (occ_pct >= 14.0),
        np.maximum(degree, 0.72),
        degree,
    )
    degree = np.where(
        (speed_arr <= 25.0) & (occ_pct >= 18.0),
        np.maximum(degree, 0.88),
        degree,
    )
    degree = np.where(
        (speed_arr <= 40.0) & (occ_pct >= 25.0),
        np.maximum(degree, 0.82),
        degree,
    )

    low_demand = (
        (occ_pct <= np.maximum(occ_med_pct + 2.5, 8.0))
        & (flow_arr <= np.maximum(flow_med_arr * 0.65, 12.0))
    )
    degree = np.where(low_demand & (speed_arr > 30.0), np.minimum(degree, 0.28), degree)
    degree = np.where(low_demand & (speed_arr <= 30.0), np.minimum(degree, 0.42), degree)

    free_flow_strong = (speed_arr >= 62.0) & (occ_pct <= 7.0)
    degree = np.where(free_flow_strong, np.minimum(degree, 0.10), degree)
    free_flow_normal = (
        (speed_arr >= np.maximum(58.0, ref_speed * 0.92))
        & (occ_pct <= np.maximum(occ_med_pct + 2.5, 8.0))
        & (pressure_component <= 0.30)
    )
    degree = np.where(free_flow_normal, np.minimum(degree, 0.15), degree)

    return {
        "score": np.asarray(np.clip(degree, 0.0, 1.0), dtype=np.float32),
        "speed": np.asarray(np.clip(speed_component, 0.0, 1.0), dtype=np.float32),
        "occupancy": np.asarray(np.clip(occupancy_component, 0.0, 1.0), dtype=np.float32),
        "flow": np.asarray(np.clip(flow_component, 0.0, 1.0), dtype=np.float32),
        "pressure": np.asarray(np.clip(pressure_component, 0.0, 1.0), dtype=np.float32),
        "demand": np.asarray(np.clip(demand_component, 0.0, 1.0), dtype=np.float32),
        "reference_speed": np.asarray(ref_speed, dtype=np.float32),
    }
