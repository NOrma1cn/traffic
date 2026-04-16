from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


DEFAULT_NUMERIC_COLUMNS = [
    "lanes",
    "station_length",
    "meta_length",
    "abs_pm",
    "latitude",
    "longitude",
    "coverage_ratio",
    "days_present",
    "meta_snapshot_count",
    "meta_fwy_mismatch",
    "meta_dir_mismatch",
    "meta_type_mismatch",
]
DEFAULT_CATEGORICAL_COLUMNS = [
    "freeway",
    "direction",
    "lane_type",
    "county_code",
]


def _sorted_levels(values: list[str]) -> list[str]:
    def key_fn(value: str) -> tuple[int, int | str]:
        try:
            return (0, int(value))
        except ValueError:
            return (1, value)

    uniq = sorted({str(v) for v in values if str(v)}, key=key_fn)
    if "__UNK__" not in uniq:
        uniq.insert(0, "__UNK__")
    return uniq


def _numeric_series(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series(np.nan, index=df.index, dtype=np.float32)
    series = df[col]
    if pd.api.types.is_bool_dtype(series):
        return series.astype(np.float32)
    return pd.to_numeric(series, errors="coerce").astype(np.float32)


def _categorical_series(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        return pd.Series("__UNK__", index=df.index, dtype="object")
    return (
        df[col]
        .fillna("__UNK__")
        .astype(str)
        .str.strip()
        .replace("", "__UNK__")
        .astype("object")
    )


def build_static_features(
    metadata: pd.DataFrame,
    *,
    spec: dict[str, Any] | None = None,
) -> tuple[np.ndarray, dict[str, Any]]:
    meta = metadata.reset_index(drop=True).copy()
    if spec is None:
        numeric_cols = [col for col in DEFAULT_NUMERIC_COLUMNS if col in meta.columns]
        categorical_cols = [col for col in DEFAULT_CATEGORICAL_COLUMNS if col in meta.columns]
        numeric_fill: dict[str, float] = {}
        numeric_mean: dict[str, float] = {}
        numeric_std: dict[str, float] = {}
        categorical_levels: dict[str, list[str]] = {}
    else:
        numeric_cols = [str(col) for col in spec.get("numeric_cols", [])]
        categorical_cols = [str(col) for col in spec.get("categorical_cols", [])]
        numeric_fill = {str(k): float(v) for k, v in spec.get("numeric_fill", {}).items()}
        numeric_mean = {str(k): float(v) for k, v in spec.get("numeric_mean", {}).items()}
        numeric_std = {str(k): float(v) for k, v in spec.get("numeric_std", {}).items()}
        categorical_levels = {
            str(k): [str(vv) for vv in vals] for k, vals in spec.get("categorical_levels", {}).items()
        }

    parts: list[np.ndarray] = []
    feature_names: list[str] = []

    for col in numeric_cols:
        raw = _numeric_series(meta, col).to_numpy(dtype=np.float32)
        if spec is None:
            finite = raw[np.isfinite(raw)]
            fill = float(np.median(finite)) if finite.size else 0.0
            filled = np.where(np.isfinite(raw), raw, fill).astype(np.float32)
            mean = float(filled.mean()) if filled.size else 0.0
            std = float(filled.std()) if filled.size else 1.0
            if std < 1e-6:
                std = 1.0
            numeric_fill[col] = fill
            numeric_mean[col] = mean
            numeric_std[col] = std
        else:
            fill = float(numeric_fill.get(col, 0.0))
            mean = float(numeric_mean.get(col, 0.0))
            std = float(numeric_std.get(col, 1.0))
            if std < 1e-6:
                std = 1.0
            filled = np.where(np.isfinite(raw), raw, fill).astype(np.float32)
        norm = ((filled - mean) / std).astype(np.float32)
        parts.append(norm[:, None])
        feature_names.append(f"num:{col}")

    for col in categorical_cols:
        raw = _categorical_series(meta, col)
        if spec is None:
            levels = _sorted_levels(raw.tolist())
            categorical_levels[col] = levels
        else:
            levels = [str(v) for v in categorical_levels.get(col, ["__UNK__"])]
            if "__UNK__" not in levels:
                levels = ["__UNK__"] + levels
                categorical_levels[col] = levels
        mapping = {level: idx for idx, level in enumerate(levels)}
        idx = np.asarray([mapping.get(str(v), mapping["__UNK__"]) for v in raw.tolist()], dtype=np.int64)
        one_hot = np.zeros((len(raw), len(levels)), dtype=np.float32)
        one_hot[np.arange(len(raw)), idx] = 1.0
        parts.append(one_hot)
        feature_names.extend([f"cat:{col}={level}" for level in levels])

    if parts:
        features = np.concatenate(parts, axis=1).astype(np.float32, copy=False)
    else:
        features = np.zeros((len(meta), 0), dtype=np.float32)

    out_spec = {
        "numeric_cols": numeric_cols,
        "categorical_cols": categorical_cols,
        "numeric_fill": numeric_fill,
        "numeric_mean": numeric_mean,
        "numeric_std": numeric_std,
        "categorical_levels": categorical_levels,
        "feature_names": feature_names,
        "feature_dim": int(features.shape[1]),
    }
    return features, out_spec
