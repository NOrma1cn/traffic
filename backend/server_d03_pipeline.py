"""
Caltrans D03 2023 multi-task forecasting API server.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import traceback
import math
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlparse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import numpy as np
import pandas as pd
import torch

from traffic_ew.accident_features import SparseAccidentFeatureSet
from traffic_ew.caltrans_graph import build_caltrans_graph
from traffic_ew.data import build_time_features
from traffic_ew.graph import build_adjacency_from_edges, normalize_adjacency
from traffic_ew.model import create_model
from traffic_ew.static_features import build_static_features
from traffic_ew.correction_model import WeatherCorrectionNet

MPH_TO_KMH = 1.60934
INCH_TO_MM = 25.4
WEATHER_FIELDS = [
    "temp",
    "feelslike",
    "dew",
    "humidity",
    "precip",
    "windspeed",
    "winddir",
    "cloudcover",
    "visibility",
    "sealevelpressure",
]
TARGET_NAMES = ["flow", "occupancy", "speed"]


def _idx_to_hhmm(idx: int) -> str:
    minute = (idx % 288) * 5
    return f"{minute // 60:02d}:{minute % 60:02d}"


def _round(x: float, n: int = 2) -> float:
    return round(float(x), n)


def _clip01(x: float) -> float:
    return float(np.clip(x, 0.0, 1.0))


def _is_missing(value) -> bool:
    try:
        return bool(pd.isna(value))
    except Exception:
        return value is None


def _maybe_float(value, n: int | None = None):
    if _is_missing(value):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(out):
        return None
    return _round(out, n) if n is not None else out


def _maybe_int(value):
    if _is_missing(value):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _maybe_bool(value):
    if _is_missing(value):
        return None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"true", "1", "yes"}:
        return True
    if text in {"false", "0", "no"}:
        return False
    return None


def _maybe_str(value):
    if _is_missing(value):
        return None
    text = str(value).strip()
    return text if text else None


def fill_nan_with_sensor_median(x: np.ndarray) -> np.ndarray:
    out = np.asarray(x, dtype=np.float32).copy()
    med = np.nanmedian(out, axis=0).astype(np.float32)
    med = np.where(np.isfinite(med), med, 0.0).astype(np.float32)
    nan_mask = ~np.isfinite(out)
    if nan_mask.any():
        cols = np.where(nan_mask)[1]
        out[nan_mask] = med[cols]
    return out


def resolve_weather_field_names(weather_npy_path: str, exo_dim: int) -> list[str]:
    weather_npy_path = os.path.abspath(weather_npy_path)
    weather_dir = os.path.dirname(weather_npy_path)
    schema_path = os.path.join(weather_dir, "schema.json")
    if os.path.exists(schema_path):
        try:
            with open(schema_path, "r", encoding="utf-8") as f:
                schema = json.load(f)
            fields = schema.get("fields")
            if isinstance(fields, list) and len(fields) == exo_dim:
                return [str(v) for v in fields]
        except Exception:
            pass

    csv_guess = os.path.splitext(weather_npy_path)[0] + ".csv"
    if os.path.exists(csv_guess):
        try:
            cols = pd.read_csv(csv_guess, nrows=0).columns.tolist()
            drop = {"datetime", "location_count"}
            fields = [str(c) for c in cols if str(c) not in drop]
            if len(fields) == exo_dim:
                return fields
        except Exception:
            pass

    return WEATHER_FIELDS[:exo_dim]


def select_weather_fields(
    weather: np.ndarray,
    *,
    all_field_names: list[str],
    wanted_fields: list[str] | None = None,
    wanted_idx: list[int] | None = None,
) -> tuple[np.ndarray, list[str], list[int]]:
    if wanted_idx is not None:
        keep_idx = [int(v) for v in wanted_idx]
        if not keep_idx:
            return np.zeros((weather.shape[0], 0), dtype=np.float32), [], []
        if min(keep_idx) < 0 or max(keep_idx) >= weather.shape[1]:
            raise ValueError("weather_keep_idx out of range for weather array")
        return weather[:, keep_idx].astype(np.float32, copy=False), [all_field_names[i] for i in keep_idx], keep_idx

    if wanted_fields is not None:
        idx_by_name = {name: idx for idx, name in enumerate(all_field_names)}
        missing = [name for name in wanted_fields if name not in idx_by_name]
        if missing:
            raise ValueError(f"checkpoint weather fields not found in weather data: {missing}")
        keep_idx = [idx_by_name[name] for name in wanted_fields]
        if not keep_idx:
            return np.zeros((weather.shape[0], 0), dtype=np.float32), [], []
        return weather[:, keep_idx].astype(np.float32, copy=False), list(wanted_fields), keep_idx

    keep_idx = list(range(weather.shape[1]))
    return (
        weather[:, keep_idx].astype(np.float32, copy=False),
        [all_field_names[idx] for idx in keep_idx],
        keep_idx,
    )


class CaltransTrafficService:
    def __init__(
        self,
        *,
        traffic_dir: str,
        weather_npy: str,
        weather_csv: str,
        ckpt_path: str,
        correction_ckpt: str,
        device: str,
        start_index: int,
        tick_seconds: int,
    ) -> None:
        self.device = device
        self.ckpt_path = ckpt_path
        self.traffic_dir = traffic_dir
        self.weather_npy = weather_npy
        self.weather_csv = weather_csv
        self.tick_seconds = int(tick_seconds)
        self.anchor_index = int(start_index)
        self.started_at = time.time()

        print(f"[server] Loading checkpoint: {ckpt_path}")
        ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
        self.ckpt = ckpt
        cfg = ckpt.get("config", {})

        self.in_len = int(ckpt.get("in_len", cfg.get("in_len", 12)))
        self.out_horizon = int(ckpt.get("out_horizon", ckpt.get("horizon", cfg.get("horizon", 12))))
        self.predict_delta = bool(ckpt.get("predict_delta", cfg.get("predict_delta", True)))
        self.corridor_k = int(ckpt.get("corridor_k", cfg.get("corridor_k", 2)))
        self.graph_mode = str(ckpt.get("graph_mode", cfg.get("graph_mode", "legacy")))
        self.graph_lane_penalty = float(ckpt.get("graph_lane_penalty", cfg.get("graph_lane_penalty", 0.08)))
        self.graph_hop_penalty = float(ckpt.get("graph_hop_penalty", cfg.get("graph_hop_penalty", 0.35)))
        self.graph_opposite_radius_km = float(
            ckpt.get("graph_opposite_radius_km", cfg.get("graph_opposite_radius_km", 1.0))
        )
        self.graph_opposite_pm_tolerance_mi = float(
            ckpt.get("graph_opposite_pm_tolerance_mi", cfg.get("graph_opposite_pm_tolerance_mi", 0.6))
        )
        self.graph_same_name_cross_radius_km = float(
            ckpt.get("graph_same_name_cross_radius_km", cfg.get("graph_same_name_cross_radius_km", 1.2))
        )
        self.graph_junction_radius_km = float(
            ckpt.get("graph_junction_radius_km", cfg.get("graph_junction_radius_km", 0.7))
        )
        self.graph_max_junction_edges = int(
            ckpt.get("graph_max_junction_edges", cfg.get("graph_max_junction_edges", 2))
        )
        self.graph_directed = bool(ckpt.get("graph_directed", cfg.get("graph_directed", False)))
        self.graph_summary = ckpt.get("graph_summary", {})
        self.sigma = ckpt.get("sigma", cfg.get("sigma", None))
        self.target_names = list(ckpt.get("target_names", TARGET_NAMES))
        self.model_type = str(ckpt.get("model_type", "GCNTransformerWeatherCrossAttention"))
        self.traffic_core_feat = int(ckpt.get("traffic_core_feat", 3))
        self.accident_feat_dim = int(ckpt.get("accident_feat_dim", len(ckpt.get("accident_feature_names", []))))
        self.static_feat_dim = int(ckpt.get("static_feat_dim", 0))
        self.diffusion_steps = int(ckpt.get("diffusion_steps", cfg.get("diffusion_steps", 2)))
        self.adaptive_rank = int(ckpt.get("adaptive_rank", cfg.get("adaptive_rank", 16)))
        self.static_feature_spec = ckpt.get("static_feature_spec", {})

        self.traffic_mean = np.asarray(ckpt["traffic_mean"], dtype=np.float32)
        self.traffic_std = np.asarray(ckpt["traffic_std"], dtype=np.float32)
        self.exo_mean = np.asarray(ckpt["exo_mean"], dtype=np.float32)
        self.exo_std = np.asarray(ckpt["exo_std"], dtype=np.float32)
        self.alpha = np.asarray(ckpt.get("alpha", np.ones(self.traffic_mean.shape[0])), dtype=np.float32)
        self.station_ids = [str(s) for s in ckpt["station_ids"]]
        # Base ckpt properties
        self.model_weather_fields = [str(v) for v in ckpt.get("weather_fields", [])]
        self.model_weather_keep_idx = [int(v) for v in ckpt.get("weather_keep_idx", [])]

        print("[server] Loading Caltrans data ...")
        t0 = time.time()
        self.metadata = pd.read_csv(os.path.join(traffic_dir, "station_metadata.csv")).reset_index(drop=True)
        self.timestamps = pd.to_datetime(
            np.load(os.path.join(traffic_dir, "timestamps.npy")).astype("datetime64[m]").astype(str)
        )
        flow = fill_nan_with_sensor_median(np.load(os.path.join(traffic_dir, "flow.npy")).astype(np.float32))
        occupancy = fill_nan_with_sensor_median(
            np.load(os.path.join(traffic_dir, "occupancy.npy")).astype(np.float32)
        )
        speed = fill_nan_with_sensor_median(np.load(os.path.join(traffic_dir, "speed.npy")).astype(np.float32))
        weather_all = np.load(weather_npy).astype(np.float32)
        weather_all_field_names = resolve_weather_field_names(weather_npy, weather_all.shape[1])
        weather_model, weather_model_fields, weather_keep_idx = select_weather_fields(
            weather_all,
            all_field_names=weather_all_field_names,
            wanted_fields=self.model_weather_fields,
            wanted_idx=self.model_weather_keep_idx,
        )

        if not (flow.shape == occupancy.shape == speed.shape):
            raise ValueError("flow/occupancy/speed shapes must match")
        if weather_all.shape[0] != flow.shape[0]:
            raise ValueError("weather length must align with traffic tensors")

        self.flow_raw = flow
        self.occupancy_raw = occupancy
        self.speed_raw = speed
        self.weather_raw = weather_all
        self.weather_field_names = weather_all_field_names
        self.weather_model_raw = weather_model
        self.weather_model_fields = weather_model_fields
        self.weather_model_keep_idx = weather_keep_idx
        self.traffic_raw = np.stack([flow, occupancy, speed], axis=-1).astype(np.float32)
        self.t_len, self.n_nodes, _ = self.traffic_raw.shape
        if self.static_feat_dim > 0:
            static_features, static_feature_spec_live = build_static_features(
                self.metadata, spec=self.static_feature_spec
            )
            if int(static_features.shape[1]) != self.static_feat_dim:
                raise ValueError(
                    f"static feature dim mismatch: checkpoint expects {self.static_feat_dim}, "
                    f"but rebuilt features have {static_features.shape[1]}"
                )
            self.static_features = static_features
            self.static_feature_spec_live = static_feature_spec_live
        else:
            self.static_features = np.zeros((self.n_nodes, 0), dtype=np.float32)
            self.static_feature_spec_live = self.static_feature_spec
        accident_dir = os.path.join(ROOT, "Caltrans_2023_D03", "processed_d03_accident_train_2023")
        self.accident_features = SparseAccidentFeatureSet.load(accident_dir)
        self.accident_feature_names = self.accident_features.feature_names
        self.accident_feat_dim = len(self.accident_feature_names)
        self.accident_features.validate_shape(t_len=self.t_len, n_nodes=self.n_nodes)
        self.accident_features.validate_timestamps(np.load(os.path.join(traffic_dir, "timestamps.npy"), allow_pickle=True))
        
        acc_mean, acc_std = self.accident_features.compute_stats(int(self.t_len * 0.7), self.n_nodes)
        self.accident_feature_mean = acc_mean
        self.accident_feature_std = acc_std
        self.time_feat = build_time_features(pd.DatetimeIndex(self.timestamps))
        self.exo_raw = np.concatenate([self.weather_model_raw, self.time_feat], axis=1).astype(np.float32)
        self.traffic_n = ((self.traffic_raw - self.traffic_mean) / self.traffic_std).astype(np.float32)
        self.exo_n = ((self.exo_raw - self.exo_mean) / self.exo_std).astype(np.float32)
        self.static_t = torch.from_numpy(self.static_features).to(self.device, non_blocking=True)
        
        # We need full unnormalized weather for correction net if it wasn't requested by base model
        if "weather_mean" in ckpt:
            we_mean = np.asarray(ckpt["weather_mean"], dtype=np.float32)
            we_std = np.asarray(ckpt["weather_std"], dtype=np.float32)
        else:
            we_mean = np.zeros(self.weather_raw.shape[1], dtype=np.float32)
            we_std = np.ones(self.weather_raw.shape[1], dtype=np.float32)
        self.full_weather_n = ((self.weather_raw - we_mean) / np.where(we_std < 1e-6, 1.0, we_std)).astype(np.float32)

        self.weather_df = self._load_weather_df(weather_csv)
        print(
            f"[server] Loaded T={self.t_len}, N={self.n_nodes}, exo={self.exo_raw.shape[1]}, "
            f"weather_model={len(self.weather_model_fields)}, static={self.static_features.shape[1]}, dt={time.time()-t0:.1f}s"
        )

        print("[server] Building graph ...")
        edges, edge_df, graph_summary_live = build_caltrans_graph(
            self.metadata,
            graph_mode=self.graph_mode,
            corridor_k=self.corridor_k,
            lane_penalty=self.graph_lane_penalty,
            hop_penalty=self.graph_hop_penalty,
            opposite_radius_km=self.graph_opposite_radius_km,
            opposite_pm_tolerance_mi=self.graph_opposite_pm_tolerance_mi,
            same_name_cross_radius_km=self.graph_same_name_cross_radius_km,
            junction_radius_km=self.graph_junction_radius_km,
            max_junction_edges=self.graph_max_junction_edges,
        )
        self.graph_summary_live = graph_summary_live
        self.graph_edge_df = edge_df.reset_index(drop=True).copy()
        self.graph_links = self._build_graph_links(edge_df)
        if self.graph_directed and self.graph_mode == "realistic":
            adj_edges = edges[:, [1, 0, 2]].copy()
            adj = build_adjacency_from_edges(adj_edges, num_nodes=self.n_nodes, sigma=self.sigma, symmetrize=False)
        else:
            adj = build_adjacency_from_edges(edges, num_nodes=self.n_nodes, sigma=self.sigma, symmetrize=True)
        self.adj_n = normalize_adjacency(adj, add_self_loops=True).to(device)

        print("[server] Building historical profiles ...")
        self.profiles = self._build_metric_profiles()

        print("[server] Loading model ...")
        self.model = create_model(
            model_type=self.model_type,
            num_nodes=self.n_nodes,
            traffic_in_feat=int(ckpt.get("traffic_input_feat", self.traffic_n.shape[2] + len(self.accident_feature_names))),
            exo_feat=self.exo_n.shape[1],
            gcn_hidden=int(ckpt.get("gcn_hidden", cfg.get("gcn_hidden", 64))),
            d_model=int(ckpt.get("d_model", cfg.get("d_model", 64))),
            gcn_layers=int(ckpt.get("gcn_layers", cfg.get("gcn_layers", 2))),
            nhead=int(ckpt.get("nhead", cfg.get("nhead", 4))),
            tf_layers=int(ckpt.get("tf_layers", cfg.get("tf_layers", 2))),
            dropout=float(ckpt.get("dropout", cfg.get("dropout", 0.1))),
            out_horizon=self.out_horizon,
            out_dim=3,
            traffic_core_feat=self.traffic_core_feat,
            accident_feat_dim=0, # Base model does not use accidents
            static_feat_dim=self.static_feat_dim,
            diffusion_steps=self.diffusion_steps,
            adaptive_rank=self.adaptive_rank,
            time_feat_dim=int(ckpt.get("time_feat_dim", len(ckpt.get("time_fields", [])) or 4)),
        ).to(device)
        self.model.load_state_dict(ckpt["model"])
        self.model.eval()

        print("[server] Loading Correction model ...")
        self.correction_model = WeatherCorrectionNet(
            weather_dim=self.weather_raw.shape[1],
            accident_dim=self.accident_feat_dim,
            static_dim=self.static_feat_dim
        ).to(device)
        self.correction_model.load_state_dict(torch.load(correction_ckpt, map_location="cpu", weights_only=False))
        self.correction_model.eval()

        self.anchor_index = max(self.in_len - 1, min(self.anchor_index, self.t_len - 1))
        print(f"[server] Ready! Sensors={self.n_nodes}, T={self.t_len}, horizon={self.out_horizon}, device={device}")

    def _load_weather_df(self, path: str) -> pd.DataFrame:
        df = pd.read_csv(path)
        if "datetime" not in df.columns:
            raise ValueError(f"weather csv missing datetime: {path}")
        df["datetime"] = pd.to_datetime(df["datetime"])
        return df.sort_values("datetime").reset_index(drop=True)

    def _build_graph_links(self, edge_df: pd.DataFrame) -> list[dict]:
        if edge_df.empty:
            return []
        sigma = float(np.std(edge_df["cost"].to_numpy(dtype=np.float32)))
        if sigma < 1e-6:
            sigma = 1.0
        self.graph_link_sigma = sigma
        links = []
        for row in edge_df.itertuples(index=False):
            cost = float(row.cost)
            # Ensure cost is finite to avoid weight becoming NaN
            if not math.isfinite(cost):
                weight = 0.0
            else:
                weight = float(np.exp(-((cost / sigma) ** 2)))
                if not math.isfinite(weight):
                    weight = 0.0
            
            payload = {
                "source": str(int(row.source)),
                "target": str(int(row.target)),
                "value": _round(weight, 6),
                "type": str(row.edge_type),
                "cost": _round(cost, 6) if math.isfinite(cost) else None,
            }
            row_dict = row._asdict() if hasattr(row, "_asdict") else {}
            for key, value in row_dict.items():
                if key in {"source", "target", "cost", "edge_type"}:
                    continue
                if isinstance(value, (np.floating, float)):
                    payload[key] = _maybe_float(value, 6)
                elif isinstance(value, (np.integer, int)):
                    payload[key] = int(value)
                else:
                    payload[key] = _maybe_str(value)
            links.append(payload)
        return links

    def _build_metric_profiles(self) -> dict[str, dict[str, np.ndarray]]:
        slot_idx = np.asarray((self.timestamps.hour * 60 + self.timestamps.minute) // 5, dtype=np.int32)
        weekday_mask = np.asarray(self.timestamps.dayofweek < 5, dtype=bool)
        metrics = {
            "flow": self.flow_raw,
            "occupancy": self.occupancy_raw,
            "speed": self.speed_raw,
        }
        profiles: dict[str, dict[str, np.ndarray]] = {}

        for name, values in metrics.items():
            arr = values.astype(np.float32, copy=False)
            n_days = self.t_len // 288
            # Reshape to (Days, 288, Nodes) for vectorized quantile computation
            arr_reshaped = arr[:n_days * 288].reshape(n_days, 288, self.n_nodes)
            day_type_masks = [weekday_mask[:n_days * 288:288], ~weekday_mask[:n_days * 288:288]]

            q50 = np.zeros((2, 288, self.n_nodes), dtype=np.float32)
            q10 = np.zeros((2, 288, self.n_nodes), dtype=np.float32)
            q90 = np.zeros((2, 288, self.n_nodes), dtype=np.float32)

            for dt in range(2):
                mask = day_type_masks[dt]
                if np.any(mask):
                    seg = arr_reshaped[mask]
                    q50[dt] = np.median(seg, axis=0)
                    q10[dt] = np.percentile(seg, 10, axis=0)
                    q90[dt] = np.percentile(seg, 90, axis=0)
                else:
                    q50[dt] = np.median(arr_reshaped, axis=0)
                    q10[dt] = np.percentile(arr_reshaped, 10, axis=0)
                    q90[dt] = np.percentile(arr_reshaped, 90, axis=0)
            
            profiles[name] = {"q10": q10, "median": q50, "q90": q90}
        return profiles

    def _now_index(self) -> int:
        if self.tick_seconds <= 0:
            return self.anchor_index % self.t_len
        steps = int((time.time() - self.started_at) // float(self.tick_seconds))
        return (self.anchor_index + steps) % self.t_len

    def _jump_to_index(self, idx: int) -> None:
        self.anchor_index = int(idx) % self.t_len
        self.started_at = time.time()

    def _circular_indices(self, start: int, length: int) -> np.ndarray:
        return (np.arange(length, dtype=np.int64) + int(start)) % self.t_len

    def _history_indices(self, t_obs: int) -> np.ndarray:
        return self._circular_indices(t_obs - self.in_len + 1, self.in_len)

    def _future_indices(self, t_obs: int, steps: int | None = None) -> np.ndarray:
        use_steps = self.out_horizon if steps is None else int(steps)
        return self._circular_indices(t_obs + 1, use_steps)

    def _weather_field_map(self, row: np.ndarray, *, n: int = 4) -> dict[str, float | None]:
        out: dict[str, float | None] = {}
        for idx, name in enumerate(self.weather_field_names):
            value = row[idx] if idx < row.shape[0] else np.nan
            out[str(name)] = _maybe_float(value, n)
        return out

    def _weather_model_field_map(self, row: np.ndarray, *, n: int = 4) -> dict[str, float | None]:
        out: dict[str, float | None] = {}
        for idx, name in enumerate(self.weather_model_fields):
            value = row[idx] if idx < row.shape[0] else np.nan
            out[str(name)] = _maybe_float(value, n)
        return out

    def _weather_context_packet(self, idx: int) -> dict:
        row = self.weather_raw[int(idx) % self.t_len]
        model_row = self.weather_model_raw[int(idx) % self.t_len]
        return {
            "datetime": self.timestamps[int(idx) % self.t_len].isoformat(),
            "condition": self._weather_condition_from_row(row),
            "raw_fields": self._weather_field_map(row),
            "model_fields": self._weather_model_field_map(model_row),
            "summary": self._weather_packet(idx),
        }

    def _accident_feature_map(self, idx: int, sensor: int) -> dict[str, dict]:
        if self.accident_features is None or not self.accident_feature_names:
            return {}
        raw_logged = self.accident_features.slice_dense(np.asarray([idx], dtype=np.int64))[0, sensor]
        normalized = self.accident_features.slice_dense(
            np.asarray([idx], dtype=np.int64),
            mean=self.accident_feature_mean,
            std=self.accident_feature_std,
        )[0, sensor]
        out: dict[str, dict] = {}
        for feat_idx, name in enumerate(self.accident_feature_names):
            log_value = float(raw_logged[feat_idx]) if feat_idx < raw_logged.shape[0] else 0.0
            raw_value = float(np.expm1(log_value)) if self.accident_features.use_log1p else log_value
            out[str(name)] = {
                "value": _round(raw_value, 3),
                "log_value": _round(log_value, 4),
                "normalized": _round(float(normalized[feat_idx]), 4) if feat_idx < normalized.shape[0] else 0.0,
                "active": bool(raw_value > 0.0),
            }
        return out

    def _accident_context_packet(self, t_obs: int, sensor: int) -> dict:
        if self.accident_features is None or not self.accident_feature_names:
            return {
                "feature_names": [],
                "current": {},
                "active_features": [],
                "history": [],
                "summary": {"has_active_incident": False, "incident_total": 0.0},
            }

        current = self._accident_feature_map(t_obs, sensor)
        hist_idx = self._circular_indices(t_obs - 11, 12)
        history = []
        for idx in hist_idx:
            feature_map = self._accident_feature_map(int(idx), sensor)
            total = float(feature_map.get("incident_total", {}).get("value", 0.0) or 0.0)
            active = [name for name, payload in feature_map.items() if bool(payload.get("active"))]
            history.append(
                {
                    "datetime": self.timestamps[int(idx) % self.t_len].isoformat(),
                    "incident_total": _round(total, 3),
                    "active_features": active,
                    "features": feature_map,
                }
            )

        active_features = [name for name, payload in current.items() if bool(payload.get("active"))]
        return {
            "feature_names": list(self.accident_feature_names),
            "current": current,
            "active_features": active_features,
            "history": history,
            "summary": {
                "has_active_incident": bool(float(current.get("incident_total", {}).get("value", 0.0) or 0.0) > 0.0),
                "incident_total": _round(float(current.get("incident_total", {}).get("value", 0.0) or 0.0), 3),
                "active_feature_count": int(len(active_features)),
            },
        }

    def _metric_profile_packet(self, sensor: int, idx: int, current_packet: dict) -> dict:
        day_type = self._day_type_index(idx)
        slot = self._slot_index(idx)
        metrics = {
            "flow": {
                "current": float(current_packet["flow_veh_5min"]),
                "unit": "veh/5m",
                "q10": float(self.profiles["flow"]["q10"][day_type, slot, sensor]),
                "median": float(self.profiles["flow"]["median"][day_type, slot, sensor]),
                "q90": float(self.profiles["flow"]["q90"][day_type, slot, sensor]),
            },
            "occupancy": {
                "current": float(current_packet["occupancy_pct"]),
                "unit": "%",
                "q10": float(self.profiles["occupancy"]["q10"][day_type, slot, sensor] * 100.0),
                "median": float(self.profiles["occupancy"]["median"][day_type, slot, sensor] * 100.0),
                "q90": float(self.profiles["occupancy"]["q90"][day_type, slot, sensor] * 100.0),
            },
            "speed": {
                "current": float(current_packet["speed_kmh"]),
                "unit": "km/h",
                "q10": float(self.profiles["speed"]["q10"][day_type, slot, sensor] * MPH_TO_KMH),
                "median": float(self.profiles["speed"]["median"][day_type, slot, sensor] * MPH_TO_KMH),
                "q90": float(self.profiles["speed"]["q90"][day_type, slot, sensor] * MPH_TO_KMH),
            },
        }
        for payload in metrics.values():
            payload["delta_vs_median"] = _round(float(payload["current"]) - float(payload["median"]), 2)
            payload["range_q10_q90"] = [_round(float(payload["q10"]), 2), _round(float(payload["q90"]), 2)]
            payload["current"] = _round(float(payload["current"]), 2)
            payload["q10"] = _round(float(payload["q10"]), 2)
            payload["median"] = _round(float(payload["median"]), 2)
            payload["q90"] = _round(float(payload["q90"]), 2)
        return {
            "day_type": "weekday" if day_type == 0 else "weekend",
            "slot_index": int(slot),
            "slot_time": _idx_to_hhmm(int(idx)),
            "metrics": metrics,
        }

    def _static_feature_packet(self, sensor: int) -> dict:
        spec = self.static_feature_spec_live or {}
        row = self.metadata.iloc[sensor]
        encoded = self.static_features[sensor] if 0 <= sensor < self.static_features.shape[0] else np.zeros((0,), dtype=np.float32)

        numeric_cols = [str(col) for col in spec.get("numeric_cols", [])]
        categorical_cols = [str(col) for col in spec.get("categorical_cols", [])]
        categorical_levels = {str(k): [str(v) for v in vals] for k, vals in spec.get("categorical_levels", {}).items()}

        cursor = 0
        numeric: dict[str, dict] = {}
        for col in numeric_cols:
            value = _maybe_float(row.get(col), 4)
            encoded_value = float(encoded[cursor]) if cursor < encoded.shape[0] else 0.0
            numeric[col] = {"raw": value, "normalized": _round(encoded_value, 4)}
            cursor += 1

        categorical: dict[str, dict] = {}
        for col in categorical_cols:
            levels = categorical_levels.get(col, ["__UNK__"])
            width = len(levels)
            one_hot = encoded[cursor : cursor + width] if cursor + width <= encoded.shape[0] else np.zeros((width,), dtype=np.float32)
            active_idx = int(np.argmax(one_hot)) if one_hot.size else 0
            categorical[col] = {
                "raw": _maybe_str(row.get(col)),
                "active_level": levels[active_idx] if 0 <= active_idx < len(levels) else "__UNK__",
                "encoded": {levels[i]: int(one_hot[i] > 0.5) for i in range(min(len(levels), len(one_hot)))},
            }
            cursor += width

        return {
            "feature_dim": int(spec.get("feature_dim", int(self.static_features.shape[1]))),
            "numeric": numeric,
            "categorical": categorical,
        }

    def _node_packet(self, sensor: int, *, include_runtime: bool = False, idx: int | None = None) -> dict:
        row = self.metadata.iloc[sensor]
        packet = {
            "index": int(sensor),
            "station_id": _maybe_str(row.get("station_id")),
            "station_name": _maybe_str(row.get("station_name")),
            "district": _maybe_int(row.get("district")) or _maybe_int(row.get("District")),
            "freeway": _maybe_str(row.get("freeway")),
            "direction": _maybe_str(row.get("direction")),
            "lane_type": _maybe_str(row.get("lane_type")) or _maybe_str(row.get("meta_type")),
            "lanes": _maybe_int(row.get("lanes")),
            "state_pm": _maybe_str(row.get("state_pm")),
            "abs_pm": _maybe_float(row.get("abs_pm"), 3),
            "latitude": _maybe_float(row.get("latitude"), 6),
            "longitude": _maybe_float(row.get("longitude"), 6),
            "station_length_mi": _maybe_float(row.get("station_length"), 3),
            "coverage_ratio": _maybe_float(row.get("coverage_ratio"), 4),
            "days_present": _maybe_int(row.get("days_present")),
            "county_code": _maybe_int(row.get("county_code")),
            "city_code": _maybe_int(row.get("city_code")),
            "meta_snapshot_count": _maybe_int(row.get("meta_snapshot_count")),
            "meta_flags": {
                "freeway_mismatch": bool(_maybe_bool(row.get("meta_fwy_mismatch"))),
                "direction_mismatch": bool(_maybe_bool(row.get("meta_dir_mismatch"))),
                "type_mismatch": bool(_maybe_bool(row.get("meta_type_mismatch"))),
            },
        }
        if include_runtime and idx is not None:
            flow = float(self.flow_raw[int(idx) % self.t_len, sensor])
            occupancy = float(self.occupancy_raw[int(idx) % self.t_len, sensor])
            speed = float(self.speed_raw[int(idx) % self.t_len, sensor])
            risk = self._risk_from_state(sensor=sensor, idx=int(idx), flow=flow, occupancy=occupancy, speed=speed)
            packet["runtime"] = {
                "datetime": self.timestamps[int(idx) % self.t_len].isoformat(),
                "flow_veh_5min": _round(flow, 1),
                "occupancy_pct": _round(occupancy * 100.0, 2),
                "speed_kmh": _round(speed * MPH_TO_KMH, 2),
                "congestion_score": _round(risk["score"], 3),
                "congestion_level": risk["level"],
            }
        return packet

    def _local_network_packet(self, sensor: int, t_obs: int, *, max_neighbors: int = 10, max_links: int = 20) -> dict:
        if not hasattr(self, "graph_edge_df") or self.graph_edge_df.empty:
            return {"neighbors": [], "links": []}

        local_df = self.graph_edge_df[
            (self.graph_edge_df["source"] == int(sensor)) | (self.graph_edge_df["target"] == int(sensor))
        ].copy()
        if local_df.empty:
            return {"neighbors": [], "links": []}

        local_df = local_df.sort_values(["cost", "edge_type", "source", "target"]).reset_index(drop=True)
        neighbor_ids: list[int] = []
        for row in local_df.itertuples(index=False):
            source = int(row.source)
            target = int(row.target)
            other = target if source == int(sensor) else source
            if other not in neighbor_ids:
                neighbor_ids.append(other)
            if len(neighbor_ids) >= max_neighbors:
                break

        allowed_nodes = {int(sensor), *neighbor_ids}
        link_df = local_df[
            local_df["source"].astype(int).isin(allowed_nodes) & local_df["target"].astype(int).isin(allowed_nodes)
        ].head(max_links)

        neighbors = [self._node_packet(nb, include_runtime=True, idx=t_obs) for nb in neighbor_ids]
        links = []
        sigma = max(float(getattr(self, "graph_link_sigma", 1.0)), 1e-6)
        for row in link_df.itertuples(index=False):
            cost = float(row.cost) if math.isfinite(float(row.cost)) else 0.0
            weight = float(np.exp(-((cost / sigma) ** 2))) if sigma > 0 else 0.0
            payload = {
                "source": int(row.source),
                "target": int(row.target),
                "type": _maybe_str(getattr(row, "edge_type", None)),
                "cost": _round(cost, 6),
                "weight": _round(weight, 6),
            }
            row_dict = row._asdict() if hasattr(row, "_asdict") else {}
            for key, value in row_dict.items():
                if key in {"source", "target", "cost", "edge_type"}:
                    continue
                if isinstance(value, (np.floating, float)):
                    payload[key] = _maybe_float(value, 6)
                elif isinstance(value, (np.integer, int)):
                    payload[key] = int(value)
                else:
                    payload[key] = _maybe_str(value)
            links.append(payload)
        return {"neighbors": neighbors, "links": links}

    def _dataset_context_packet(self) -> dict:
        return {
            "dataset": "Caltrans D03 2023",
            "sensor_count": int(self.n_nodes),
            "time_steps": int(self.t_len),
            "time_range": {
                "start": self.timestamps[0].isoformat(),
                "end": self.timestamps[-1].isoformat(),
            },
            "tick_seconds": int(self.tick_seconds),
            "in_len": int(self.in_len),
            "out_horizon": int(self.out_horizon),
            "weather_fields": list(self.weather_field_names),
            "weather_model_fields": list(self.weather_model_fields),
            "accident_feature_names": list(self.accident_feature_names),
            "static_feature_spec": self.static_feature_spec_live,
            "graph_summary": self.graph_summary_live,
            "model": {
                "model_type": str(self.model_type),
                "target_names": list(self.target_names),
                "traffic_core_feat": int(self.traffic_core_feat),
                "static_feat_dim": int(self.static_feat_dim),
                "accident_feat_dim": int(self.accident_feat_dim),
                "diffusion_steps": int(self.diffusion_steps),
                "adaptive_rank": int(self.adaptive_rank),
            },
        }

    def _weather_value(
        self,
        row: np.ndarray,
        field: str,
        default: float = 0.0,
        *,
        field_names: list[str] | None = None,
    ) -> float:
        use_fields = self.weather_field_names if field_names is None else field_names
        if field not in use_fields:
            return float(default)
        idx = use_fields.index(field)
        if idx >= row.shape[0]:
            return float(default)
        val = row[idx]
        if not np.isfinite(val):
            return float(default)
        return float(val)

    def _weather_condition_from_row(self, row: np.ndarray) -> str:
        precip = self._weather_value(row, "precip", 0.0)
        cloud = self._weather_value(row, "cloudcover", 0.0)
        humidity = self._weather_value(row, "humidity", 50.0)
        wind = self._weather_value(row, "windspeed", 0.0)
        visibility = self._weather_value(row, "visibility", 10.0)

        if visibility <= 2.5 and humidity >= 92:
            return "Foggy"
        if precip >= 0.18:
            return "Rainy"
        if precip >= 0.04:
            return "Drizzle"
        if wind >= 22 and cloud < 70 and precip < 0.02:
            return "Windy"
        if cloud >= 85:
            return "Overcast"
        if cloud >= 35:
            return "Partly Cloudy"
        return "Sunny"

    def _weather_packet(self, idx: int, *, step_index: int | None = None) -> dict:
        row = self.weather_raw[int(idx) % self.t_len]
        ts = self.timestamps[int(idx) % self.t_len]
        precip_in = self._weather_value(row, "precip", 0.0)
        wind_mph = self._weather_value(row, "windspeed", 0.0)
        cloud = self._weather_value(row, "cloudcover", 0.0)
        humidity = self._weather_value(row, "humidity", 50.0)
        visibility = self._weather_value(row, "visibility", 10.0)
        temp_f = self._weather_value(row, "temp", 60.0)

        pkt = {
            "datetime": ts.isoformat(),
            "condition": self._weather_condition_from_row(row),
            "temp_c": _round((temp_f - 32.0) * 5.0 / 9.0, 1),
            "humidity": _round(humidity, 1),
            "wind_kmh": _round(wind_mph * MPH_TO_KMH, 1),
            "precip_mm": _round(precip_in * INCH_TO_MM, 2),
            "cloudcover": _round(cloud, 1),
            "visibility_km": _round(max(visibility, 0.0) * 1.60934, 2),
            "precipitation_pct": int(np.clip((precip_in / 0.2) * 100.0, 0, 100)),
        }
        if step_index is not None:
            pkt["step_index"] = int(step_index)
        return pkt

    def _monthly_weather_panorama(self, t_obs: int) -> list[dict]:
        ts = self.timestamps[int(t_obs) % self.t_len]
        cur_month = int(ts.month)
        cur_day = int(ts.day)
        cur_hour = int(ts.hour)
        cur_minute = int(ts.minute)
        out: list[dict] = []

        for offset in range(12):
            target_month = ((cur_month - 1 + offset) % 12) + 1
            month_rows = self.weather_df[self.weather_df["datetime"].dt.month == target_month].copy()
            if month_rows.empty:
                continue

            month_rows["slot_dist"] = (
                (month_rows["datetime"].dt.hour - cur_hour).abs() * 60
                + (month_rows["datetime"].dt.minute - cur_minute).abs()
            )
            month_rows["day_dist"] = (month_rows["datetime"].dt.day - cur_day).abs()
            month_rows = month_rows.sort_values(["day_dist", "slot_dist", "datetime"])
            row = month_rows.iloc[0]
            wx_ts = pd.Timestamp(row["datetime"])

            def pd_val(col: str, default: float) -> float:
                v = row.get(col, default)
                if pd.isna(v): return float(default)
                try:
                    vf = float(v)
                    if math.isnan(vf): return float(default)
                    return vf
                except (ValueError, TypeError):
                    return float(default)

            packet = {
                "datetime": wx_ts.isoformat(),
                "condition": self._weather_condition_from_row(
                    np.asarray([pd_val(field, 0.0) for field in WEATHER_FIELDS], dtype=np.float32)
                ),
                "temp_c": _round((pd_val("temp", 60.0) - 32.0) * 5.0 / 9.0, 1),
                "humidity": _round(pd_val("humidity", 50.0), 1),
                "wind_kmh": _round(pd_val("windspeed", 0.0) * MPH_TO_KMH, 1),
                "precip_mm": _round(pd_val("precip", 0.0) * INCH_TO_MM, 2),
                "cloudcover": _round(pd_val("cloudcover", 0.0), 1),
                "visibility_km": _round(max(pd_val("visibility", 10.0), 0.0) * 1.60934, 2),
                "precipitation_pct": int(np.clip((pd_val("precip", 0.0) / 0.2) * 100.0, 0, 100)),
                "month_index": offset,
                "calendar_month": target_month,
            }
            out.append(packet)
        return out

    def _build_input_tensors(
        self,
        t_obs: int,
        *,
        weather_override: dict[str, float] | None = None,
        accident_override: np.ndarray | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        hist_idx = self._history_indices(t_obs)
        future_idx = self._future_indices(t_obs)
        x_base = self.traffic_n[hist_idx]
        if self.accident_features is not None:
            x_acc = self.accident_features.slice_dense(
                hist_idx,
                mean=self.accident_feature_mean,
                std=self.accident_feature_std,
            )
            x_tr = np.concatenate([x_base, x_acc], axis=-1).astype(np.float32, copy=False)[None, ...]
            x_acc_future = self.accident_features.slice_dense(
                future_idx,
                mean=self.accident_feature_mean,
                std=self.accident_feature_std,
            ).astype(np.float32, copy=False)
        else:
            x_tr = x_base.astype(np.float32, copy=False)[None, ...]
            x_acc_future = np.zeros((self.out_horizon, self.n_nodes, 0), dtype=np.float32)
        if accident_override is not None:
            if accident_override.shape != x_acc_future.shape:
                raise ValueError(
                    f"accident_override shape mismatch: expected {x_acc_future.shape}, got {accident_override.shape}"
                )
            x_acc_future = accident_override.astype(np.float32, copy=False)

        x_exo_hist_raw = self.exo_raw[hist_idx].copy()
        x_exo_future_raw = self.exo_raw[future_idx].copy()
        if weather_override:
            for field, value in weather_override.items():
                if field not in self.weather_model_fields:
                    continue
                col = self.weather_model_fields.index(field)
                x_exo_future_raw[:, col] = float(value)
        x_exo_hist_n = ((x_exo_hist_raw - self.exo_mean) / self.exo_std).astype(np.float32)
        x_exo_future_n = ((x_exo_future_raw - self.exo_mean) / self.exo_std).astype(np.float32)
        
        # Build w_fut_raw for CorrectionNet which takes raw full weather tensor
        w_fut_raw = self.weather_raw[future_idx].copy()
        if weather_override:
            for field, value in weather_override.items():
                if field in self.weather_field_names:
                    col = self.weather_field_names.index(field)
                    w_fut_raw[:, col] = float(value)

        x_tr_t = torch.from_numpy(x_tr).to(self.device, non_blocking=True)
        x_exo_hist_t = torch.from_numpy(x_exo_hist_n[None, ...]).to(self.device, non_blocking=True)
        x_exo_future_t = torch.from_numpy(x_exo_future_n[None, ...]).to(self.device, non_blocking=True)
        x_acc_future_t = torch.from_numpy(x_acc_future[None, ...]).to(self.device, non_blocking=True)
        w_fut_t = torch.from_numpy(w_fut_raw[None, ...]).to(self.device, non_blocking=True)
        return x_tr_t, x_exo_hist_t, x_exo_future_t, x_acc_future_t, w_fut_t

    @torch.no_grad()
    def _predict_future(
        self,
        t_obs: int,
        *,
        weather_overrides: list[dict[str, float] | None] | None = None,
        accident_overrides: list[np.ndarray | None] | None = None,
    ) -> np.ndarray:
        # If no overrides, default to single prediction
        if weather_overrides is None and accident_overrides is None:
            weather_overrides = [None]
            accident_overrides = [None]
        
        # Normalize lengths
        n_batch = max(len(weather_overrides or []), len(accident_overrides or []))
        w_ovs = weather_overrides or [None] * n_batch
        a_ovs = accident_overrides or [None] * n_batch
        if len(w_ovs) < n_batch: w_ovs += [None] * (n_batch - len(w_ovs))
        if len(a_ovs) < n_batch: a_ovs += [None] * (n_batch - len(a_ovs))

        batch_x_tr = []
        batch_x_exo_hist = []
        batch_x_exo_future = []
        batch_x_acc_future = []
        batch_w_fut = []

        for i in range(n_batch):
            x_tr_i, x_exo_hist_i, x_exo_future_i, x_acc_future_i, w_fut_i = self._build_input_tensors(
                t_obs,
                weather_override=w_ovs[i],
                accident_override=a_ovs[i],
            )
            batch_x_tr.append(x_tr_i)
            batch_x_exo_hist.append(x_exo_hist_i)
            batch_x_exo_future.append(x_exo_future_i)
            batch_x_acc_future.append(x_acc_future_i)
            batch_w_fut.append(w_fut_i)

        # Concatenate into batches
        x_tr_t = torch.cat(batch_x_tr, dim=0)
        x_exo_hist_t = torch.cat(batch_x_exo_hist, dim=0)
        x_exo_future_t = torch.cat(batch_x_exo_future, dim=0)
        x_acc_future_t = torch.cat(batch_x_acc_future, dim=0)
        w_fut_t = torch.cat(batch_w_fut, dim=0)
        
        # 1. Base Model
        if self.model_type == "ScenarioConditionedDiffusionForecaster":
            base_pred = self.model(x_tr_t, self.adj_n, x_exo_hist_t, self.static_t, x_exo_future_t, x_acc_future_t)
        else:
            base_pred = self.model(x_tr_t, self.adj_n, x_exo_hist_t, self.static_t)
            
        if base_pred.dim() == 4:
            base_pred = base_pred.transpose(1, 2)
            
        if self.predict_delta:
            last = x_tr_t[:, -1:, :, :3]
            base_pred = base_pred + last
            
        # 2. Correction Model
        residual_pred = self.correction_model(
            torch.nan_to_num(w_fut_t), 
            torch.nan_to_num(x_acc_future_t), 
            self.static_t, 
            self.adj_n
        )
        
        pred = base_pred + residual_pred # [B, H, N, 3]

        pred_np = pred.detach().cpu().numpy().astype(np.float32, copy=False)
        # Correct broadcasting for node-specific stats: (B, H, N, 3) * (None, None, N, 3)
        pred_raw = pred_np * self.traffic_std[None, None, :, :] + self.traffic_mean[None, None, :, :]
        pred_raw = np.maximum(pred_raw, 0.0)
        
        # Return [B, N, H, 3]
        return pred_raw.transpose(0, 2, 1, 3)

    def _day_type_index(self, idx: int) -> int:
        return 0 if int(self.timestamps[int(idx) % self.t_len].dayofweek) < 5 else 1

    def _slot_index(self, idx: int) -> int:
        ts = self.timestamps[int(idx) % self.t_len]
        return int((ts.hour * 60 + ts.minute) // 5)

    def _normalize_signal(self, value: float, median: float, upper: float) -> float:
        span = max(float(upper - median), 1e-6)
        return _clip01((float(value) - float(median)) / span)

    def _normalize_inverse_signal(self, value: float, median: float, lower: float) -> float:
        span = max(float(median - lower), 1e-6)
        return _clip01((float(median) - float(value)) / span)

    def _risk_from_state(self, *, sensor: int, idx: int, flow: float, occupancy: float, speed: float) -> dict:
        day_type = self._day_type_index(idx)
        slot = self._slot_index(idx)
        flow_med = float(self.profiles["flow"]["median"][day_type, slot, sensor])
        flow_q90 = float(self.profiles["flow"]["q90"][day_type, slot, sensor])
        occ_med = float(self.profiles["occupancy"]["median"][day_type, slot, sensor])
        occ_q90 = float(self.profiles["occupancy"]["q90"][day_type, slot, sensor])
        speed_med = float(self.profiles["speed"]["median"][day_type, slot, sensor])
        speed_q10 = float(self.profiles["speed"]["q10"][day_type, slot, sensor])

        occ_score = self._normalize_signal(occupancy, occ_med, occ_q90)
        flow_score = self._normalize_signal(flow, flow_med, flow_q90)
        speed_score = self._normalize_inverse_signal(speed, speed_med, speed_q10)
        pressure = float(flow / max(speed, 5.0))
        pressure_base = float(flow_med / max(speed_med, 5.0))
        pressure_score = _clip01((pressure - pressure_base) / max(pressure_base, 1e-6))

        combined = 0.50 * occ_score + 0.20 * flow_score + 0.20 * speed_score + 0.10 * pressure_score
        if speed_score < 0.15 and flow_score < 0.15:
            combined *= 0.55
        if occ_score < 0.2 and speed_score < 0.2:
            combined *= 0.5

        score = float(np.clip(combined, 0.0, 1.0))
        if score >= 0.8:
            level = "severe"
        elif score >= 0.6:
            level = "high"
        elif score >= 0.35:
            level = "medium"
        else:
            level = "low"

        return {
            "score": score,
            "level": level,
            "components": {
                "occupancy": float(occ_score),
                "flow": float(flow_score),
                "speed": float(speed_score),
                "pressure": float(pressure_score),
            },
            "baseline": {
                "flow": flow_med,
                "occupancy": occ_med,
                "speed": speed_med,
            },
        }

    def _risk_from_arrays(
        self,
        *,
        indices: np.ndarray,
        flow: np.ndarray,
        occupancy: np.ndarray,
        speed: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        scores = np.zeros((indices.shape[0], self.n_nodes), dtype=np.float32)
        levels = np.zeros((indices.shape[0], self.n_nodes), dtype=np.int32)
        for i, idx in enumerate(indices.tolist()):
            day_type = self._day_type_index(idx)
            slot = self._slot_index(idx)
            flow_med = self.profiles["flow"]["median"][day_type, slot]
            flow_q90 = self.profiles["flow"]["q90"][day_type, slot]
            occ_med = self.profiles["occupancy"]["median"][day_type, slot]
            occ_q90 = self.profiles["occupancy"]["q90"][day_type, slot]
            speed_med = self.profiles["speed"]["median"][day_type, slot]
            speed_q10 = self.profiles["speed"]["q10"][day_type, slot]

            occ_score = np.clip((occupancy[i] - occ_med) / np.maximum(occ_q90 - occ_med, 1e-6), 0.0, 1.0)
            flow_score = np.clip((flow[i] - flow_med) / np.maximum(flow_q90 - flow_med, 1e-6), 0.0, 1.0)
            speed_score = np.clip((speed_med - speed[i]) / np.maximum(speed_med - speed_q10, 1e-6), 0.0, 1.0)
            pressure = flow[i] / np.maximum(speed[i], 5.0)
            pressure_base = flow_med / np.maximum(speed_med, 5.0)
            pressure_score = np.clip((pressure - pressure_base) / np.maximum(pressure_base, 1e-6), 0.0, 1.0)

            combined = 0.50 * occ_score + 0.20 * flow_score + 0.20 * speed_score + 0.10 * pressure_score
            combined[(speed_score < 0.15) & (flow_score < 0.15)] *= 0.55
            combined[(occ_score < 0.2) & (speed_score < 0.2)] *= 0.5
            combined = np.clip(combined, 0.0, 1.0)
            scores[i] = combined.astype(np.float32)

            lv = np.zeros(self.n_nodes, dtype=np.int32)
            lv[combined >= 0.35] = 1
            lv[combined >= 0.60] = 2
            lv[combined >= 0.80] = 3
            levels[i] = lv
        return scores, levels

    def _window_packet(
        self,
        *,
        sensor: int,
        step: int,
        idx: int,
        flow: float,
        occupancy: float,
        speed: float,
        current: dict,
    ) -> dict:
        risk = self._risk_from_state(sensor=sensor, idx=idx, flow=flow, occupancy=occupancy, speed=speed)
        return {
            "step": int(step),
            "minutes_ahead": int(step * 5),
            "datetime": self.timestamps[int(idx) % self.t_len].isoformat(),
            "flow_veh_5min": _round(flow, 1),
            "occupancy_ratio": _round(occupancy, 4),
            "occupancy_pct": _round(occupancy * 100.0, 2),
            "speed_mph": _round(speed, 2),
            "speed_kmh": _round(speed * MPH_TO_KMH, 2),
            "congestion_score": _round(risk["score"], 3),
            "congestion_level": risk["level"],
            "baseline_flow_veh_5min": _round(risk["baseline"]["flow"], 1),
            "baseline_occupancy_pct": _round(risk["baseline"]["occupancy"] * 100.0, 2),
            "baseline_speed_kmh": _round(risk["baseline"]["speed"] * MPH_TO_KMH, 2),
            "delta_vs_now": {
                "flow_veh_5min": _round(flow - current["flow_veh_5min"], 1),
                "occupancy_pct": _round(occupancy * 100.0 - current["occupancy_pct"], 2),
                "speed_kmh": _round(speed * MPH_TO_KMH - current["speed_kmh"], 2),
            },
            "components": {k: _round(v, 3) for k, v in risk["components"].items()},
        }

    def _detect_weather_transition(self, t_obs: int) -> dict:
        current = self.weather_raw[t_obs]
        future_idx = self._future_indices(t_obs, min(12, self.out_horizon))
        future = self.weather_raw[future_idx]
        if future.shape[0] == 0:
            cond = self._weather_condition_from_row(current)
            return {
                "active": False,
                "event_type": "stable",
                "title": "天气稳定",
                "summary": "未来 1 小时内没有明显天气变化。",
                "eta_min": None,
                "current_condition": cond,
                "incoming_condition": cond,
            }

        cur_precip = self._weather_value(current, "precip", 0.0)
        cur_cloud = self._weather_value(current, "cloudcover", 0.0)
        cur_humidity = self._weather_value(current, "humidity", 50.0)
        cur_visibility = self._weather_value(current, "visibility", 10.0)
        cur_wind = self._weather_value(current, "windspeed", 0.0)

        max_precip = float(np.max(future[:, WEATHER_FIELDS.index("precip")]))
        max_cloud = float(np.max(future[:, WEATHER_FIELDS.index("cloudcover")]))
        max_humidity = float(np.max(future[:, WEATHER_FIELDS.index("humidity")]))
        min_visibility = float(np.min(future[:, WEATHER_FIELDS.index("visibility")]))
        max_wind = float(np.max(future[:, WEATHER_FIELDS.index("windspeed")]))

        event_type = "stable"
        if max_precip >= max(cur_precip + 0.015, 0.03):
            event_type = "rain"
        elif min_visibility <= min(cur_visibility - 2.5, 6.0) and max_humidity >= max(cur_humidity + 5.0, 88.0):
            event_type = "fog"
        elif max_wind >= max(cur_wind + 8.0, 18.0):
            event_type = "wind"
        elif max_cloud >= max(cur_cloud + 20.0, 80.0):
            event_type = "cloud"

        eta_step = None
        for offset, row in enumerate(future, start=1):
            row_precip = self._weather_value(row, "precip", 0.0)
            row_visibility = self._weather_value(row, "visibility", 10.0)
            row_humidity = self._weather_value(row, "humidity", 50.0)
            row_wind = self._weather_value(row, "windspeed", 0.0)
            row_cloud = self._weather_value(row, "cloudcover", 0.0)
            if event_type == "rain" and row_precip >= max(cur_precip + 0.015, 0.03):
                eta_step = offset
                break
            if event_type == "fog" and row_visibility <= min(cur_visibility - 2.5, 6.0) and row_humidity >= max(cur_humidity + 5.0, 88.0):
                eta_step = offset
                break
            if event_type == "wind" and row_wind >= max(cur_wind + 8.0, 18.0):
                eta_step = offset
                break
            if event_type == "cloud" and row_cloud >= max(cur_cloud + 20.0, 80.0):
                eta_step = offset
                break

        incoming_row = future[min(max((eta_step or 1) - 1, 0), future.shape[0] - 1)]
        incoming_condition = self._weather_condition_from_row(incoming_row)
        current_condition = self._weather_condition_from_row(current)
        title_map = {
            "rain": "即将进入降雨窗口",
            "fog": "即将进入低能见度窗口",
            "wind": "即将进入大风窗口",
            "cloud": "即将转阴",
            "stable": "天气稳定",
        }
        summary_map = {
            "rain": "检测到未来 1 小时内降雨增强，可以对不同雨强进行情景推演。",
            "fog": "检测到未来 1 小时内能见度下降，可以对不同雾强进行情景推演。",
            "wind": "检测到未来 1 小时内风速上升，可以评估风扰动对交通的影响。",
            "cloud": "检测到未来 1 小时内云量上升，可能伴随轻微交通扰动。",
            "stable": "未来 1 小时内没有明显天气变化。",
        }
        return {
            "active": event_type != "stable",
            "event_type": event_type,
            "title": title_map[event_type],
            "summary": summary_map[event_type],
            "eta_min": None if eta_step is None else int(eta_step * 5),
            "current_condition": current_condition,
            "incoming_condition": incoming_condition,
        }

    def _get_weather_scenario_specs(self, transition: dict, t_obs: int) -> list[dict]:
        current = self.weather_raw[t_obs]
        future_idx = self._future_indices(t_obs, min(12, self.out_horizon))
        future_ref = self.weather_raw[int(future_idx[-1])] if future_idx.size else current

        def cur(field: str, default: float = 0.0) -> float:
            return self._weather_value(current, field, default)

        def fut(field: str, default: float = 0.0) -> float:
            return self._weather_value(future_ref, field, default)

        event_type = str(transition["event_type"])
        if event_type == "rain":
            wind_base = max(cur("windspeed", 0.0), fut("windspeed", 0.0))
            return [
                {"key": "light_rain", "label": "小雨", "description": "湿路面开始出现", "override": {"precip": 0.03, "cloudcover": max(65.0, fut("cloudcover", 60.0)), "humidity": max(78.0, fut("humidity", 72.0)), "visibility": min(cur("visibility", 10.0), 8.0), "windspeed": wind_base + 1.0}},
                {"key": "moderate_rain", "label": "中雨", "description": "车距会明显拉大", "override": {"precip": 0.07, "cloudcover": max(80.0, fut("cloudcover", 76.0)), "humidity": max(86.0, fut("humidity", 82.0)), "visibility": min(cur("visibility", 10.0), 6.0), "windspeed": wind_base + 3.0}},
                {"key": "heavy_rain", "label": "大雨", "description": "低速保守驾驶明显", "override": {"precip": 0.14, "cloudcover": max(92.0, fut("cloudcover", 88.0)), "humidity": max(92.0, fut("humidity", 90.0)), "visibility": min(cur("visibility", 10.0), 4.0), "windspeed": wind_base + 6.0}},
                {"key": "storm_rain", "label": "暴雨", "description": "高风险强干扰", "override": {"precip": 0.22, "cloudcover": 100.0, "humidity": 98.0, "visibility": 2.0, "windspeed": wind_base + 10.0}},
            ]
        elif event_type == "fog":
            return [
                {"key": "light_fog", "label": "薄雾", "description": "轻度视距下降", "override": {"humidity": max(84.0, fut("humidity", 82.0)), "visibility": 8.0, "cloudcover": max(60.0, fut("cloudcover", 58.0))}},
                {"key": "fog", "label": "大雾", "description": "驾驶感知受限", "override": {"humidity": max(92.0, fut("humidity", 90.0)), "visibility": 5.0, "cloudcover": max(75.0, fut("cloudcover", 74.0))}},
                {"key": "dense_fog", "label": "浓雾", "description": "车流将更保守", "override": {"humidity": 96.0, "visibility": 3.0, "cloudcover": max(88.0, fut("cloudcover", 86.0))}},
                {"key": "severe_fog", "label": "强浓雾", "description": "极低能见度", "override": {"humidity": 98.0, "visibility": 1.5, "cloudcover": 96.0}},
            ]
        elif event_type == "wind":
            wind_base = max(cur("windspeed", 0.0), fut("windspeed", 0.0))
            return [
                {"key": "gust", "label": "阵风", "description": "轻度风扰动", "override": {"windspeed": wind_base + 4.0, "cloudcover": max(cur("cloudcover", 40.0), 55.0)}},
                {"key": "strong_wind", "label": "强风", "description": "车速更保守", "override": {"windspeed": wind_base + 8.0, "cloudcover": max(cur("cloudcover", 40.0), 68.0)}},
                {"key": "gale", "label": "大风", "description": "波动将放大", "override": {"windspeed": wind_base + 12.0, "cloudcover": max(cur("cloudcover", 40.0), 80.0)}},
                {"key": "severe_wind", "label": "烈风", "description": "高干扰场景", "override": {"windspeed": wind_base + 16.0, "cloudcover": max(cur("cloudcover", 40.0), 90.0)}},
            ]
        else:
            return [
                {"key": "cloud_1", "label": "多云", "description": "阴云开始增多", "override": {"cloudcover": max(60.0, fut("cloudcover", 58.0))}},
                {"key": "cloud_2", "label": "阴天", "description": "行驶会更保守", "override": {"cloudcover": max(78.0, fut("cloudcover", 76.0))}},
                {"key": "cloud_3", "label": "厚云层", "description": "天气摩擦增强", "override": {"cloudcover": max(90.0, fut("cloudcover", 88.0)), "humidity": max(cur("humidity", 50.0), 78.0)}},
                {"key": "cloud_4", "label": "压低云层", "description": "接近差天气", "override": {"cloudcover": 98.0, "humidity": max(cur("humidity", 50.0), 86.0)}},
            ]

    def _get_accident_scenario_specs(self, t_obs: int, sensor: int) -> list[dict]:
        if self.accident_features is None or not self.accident_feature_names:
            return []
        cur_raw = self.accident_features.slice_dense(np.asarray([t_obs], dtype=np.int64))[0, sensor]
        if cur_raw.shape[0] == 0: return []
        total_idx = self.accident_feature_names.index("incident_total") if "incident_total" in self.accident_feature_names else 0
        if float(cur_raw[total_idx]) <= 0.0: return []

        base_future = self.accident_features.slice_dense(
            self._future_indices(t_obs),
            mean=self.accident_feature_mean,
            std=self.accident_feature_std,
        ).astype(np.float32, copy=False)
        neighbor_w = self.adj_n[sensor].detach().cpu().numpy().astype(np.float32)
        neighbor_w = np.clip(neighbor_w / max(float(neighbor_w.max(initial=1.0)), 1e-6), 0.0, 1.0)
        neighbor_w[sensor] = 1.0

        templates = [
            ("accident_persist_light", "事故持续 30 分钟", "轻度持续干扰", 0.6),
            ("accident_persist_mid", "事故持续 1 小时", "中度持续干扰", 1.0),
            ("accident_persist_heavy", "事故持续 2 小时", "重度持续干扰", 1.4),
        ]
        specs = []
        for key, label, desc, scale in templates:
            override = base_future.copy()
            for h in range(self.out_horizon):
                decay = float(scale * (0.92 ** h))
                override[h] = override[h] + neighbor_w[:, None] * (cur_raw.astype(np.float32, copy=False)[None, :] * decay)
            specs.append({"key": key, "label": label, "description": desc, "override": override})
        return specs

    # Refactored _build_accident_scenarios removed in favor of batching logic in forecast()

    def _find_next_weather_transition(self, start_idx: int | None = None) -> tuple[int, dict] | None:
        base = self._now_index() if start_idx is None else int(start_idx) % self.t_len
        for step in range(self.t_len):
            idx = (base + step) % self.t_len
            transition = self._detect_weather_transition(idx)
            if transition["active"]:
                return idx, transition
        return None

    def debug_jump_to_next_weather_transition(self) -> dict:
        cur_idx = self._now_index()
        found = self._find_next_weather_transition(cur_idx + 1)
        if found is None:
            return {"ok": False, "error": "no upcoming weather transition found"}
        idx, transition = found
        self._jump_to_index(idx)
        return {
            "ok": True,
            "jumped_to": int(idx),
            "sim_time": self.timestamps[int(idx)].isoformat(),
            "weather_transition": transition,
        }

    def _build_confidence(self, *, current_risk: dict, windows: dict[str, dict], station_idx: int) -> dict:
        h1 = windows["h1"]
        h6 = windows["h6"]
        h12 = windows["h12"]
        scores = np.asarray(
            [
                current_risk["score"],
                float(h1["congestion_score"]),
                float(h6["congestion_score"]),
                float(h12["congestion_score"]),
            ],
            dtype=np.float32,
        )
        stability = _clip01(1.0 - float(np.std(scores)) / 0.25)
        signal_strength = _clip01(float(np.max(scores)))
        agreement = _clip01(
            (
                float(h12["components"]["occupancy"])
                + float(h12["components"]["speed"])
                + max(float(h12["components"]["flow"]), float(h12["components"]["pressure"]))
            )
            / 3.0
        )
        data_score = _clip01(float(self.metadata.iloc[station_idx].get("coverage_ratio", 0.95)))
        horizon_bonus = _clip01(
            0.45 * float(h1["congestion_score"]) + 0.55 * max(float(h6["congestion_score"]), float(h12["congestion_score"]))
        )

        confidence = 0.30 * signal_strength + 0.25 * agreement + 0.25 * stability + 0.10 * data_score + 0.10 * horizon_bonus
        score = int(round(confidence * 100))
        label = "high" if score >= 72 else "medium" if score >= 48 else "low"

        reasons = []
        if float(h12["components"]["occupancy"]) >= 0.55:
            reasons.append("占有率已明显高于该时段常态。")
        if float(h12["components"]["speed"]) >= 0.45:
            reasons.append("车速较该时段历史中位显著下降。")
        if max(float(h12["components"]["flow"]), float(h12["components"]["pressure"])) >= 0.4:
            reasons.append("车流和流量/车速压力共同支持拥堵判断。")
        if stability >= 0.6:
            reasons.append("5/30/60 分钟风险走势较一致。")
        if not reasons:
            reasons.append("当前风险信号偏弱，结论更多依赖模型趋势而非强证据共振。")

        peak_key = max(windows, key=lambda k: float(windows[k]["congestion_score"]))
        summary = (
            f"当前置信度由占有率、速度回落和多步走势一致性共同决定。"
            f" 未来最强风险窗口在 {windows[peak_key]['minutes_ahead']} 分钟。"
        )
        return {
            "score": score,
            "label": label,
            "summary": summary,
            "reasons": reasons,
            "evidence": {
                "signal_strength": _round(signal_strength, 3),
                "agreement_score": _round(agreement, 3),
                "stability_score": _round(stability, 3),
                "data_score": _round(data_score, 3),
                "horizon_bonus": _round(horizon_bonus, 3),
            },
        }

    def forecast(self, *, sensor: int) -> dict:
        if not (0 <= sensor < self.n_nodes):
            raise ValueError(f"sensor must be in [0, {self.n_nodes - 1}]")

        t_obs = self._now_index()
        # 1. Collect all scenario specifications
        weather_transition = self._detect_weather_transition(t_obs)
        weather_specs = self._get_weather_scenario_specs(weather_transition, t_obs) if weather_transition["active"] else []
        accident_specs = self._get_accident_scenario_specs(t_obs, sensor)
        
        # 2. Prepare batch: [Main, WeatherScenarios..., AccidentScenarios...]
        w_ovs = [None] + [s["override"] for s in weather_specs] + [None] * len(accident_specs)
        a_ovs = [None] + [None] * len(weather_specs) + [s["override"] for s in accident_specs]
        
        # 3. RUN BATCH INFERENCE
        print(f"[server] Request: sensor={sensor}, t_obs={t_obs}, scenarios={len(w_ovs)}")
        print(f"[server] Running batch inference (batch_size={len(w_ovs)})...")
        batch_preds = self._predict_future(t_obs, weather_overrides=w_ovs, accident_overrides=a_ovs)
        
        if np.isnan(batch_preds).any():
            print(f"[WARNING] NaN values detected in batch_preds! Imputing with 0.0")
            batch_preds = np.nan_to_num(batch_preds, nan=0.0)
            
        print(f"[server] Batch inference complete. Result shape: {batch_preds.shape}")
        
        pred = batch_preds[0] # Main prediction [N, H, 3]

        pred_flow = pred[:, :, 0].transpose(1, 0)
        pred_occ = pred[:, :, 1].transpose(1, 0)
        pred_speed = pred[:, :, 2].transpose(1, 0)
        
        # Current state and risk
        current_flow = float(self.flow_raw[t_obs, sensor])
        current_occ = float(self.occupancy_raw[t_obs, sensor])
        current_speed = float(self.speed_raw[t_obs, sensor])
        prev_1h_idx = (t_obs - 12) % self.t_len
        prev_flow = float(self.flow_raw[prev_1h_idx, sensor])
        prev_occ = float(self.occupancy_raw[prev_1h_idx, sensor])
        prev_speed = float(self.speed_raw[prev_1h_idx, sensor])

        current_risk = self._risk_from_state(sensor=sensor, idx=t_obs, flow=current_flow, occupancy=current_occ, speed=current_speed)
        current_packet = {
            "flow_veh_5min": _round(current_flow, 1),
            "occupancy_ratio": _round(current_occ, 4),
            "occupancy_pct": _round(current_occ * 100.0, 2),
            "speed_mph": _round(current_speed, 2),
            "speed_kmh": _round(current_speed * MPH_TO_KMH, 2),
            "flow_1h_ago_veh_5min": _round(prev_flow, 1),
            "occupancy_1h_ago_pct": _round(prev_occ * 100.0, 2),
            "speed_1h_ago_kmh": _round(prev_speed * MPH_TO_KMH, 2),
            "baseline_flow_veh_5min": _round(current_risk["baseline"]["flow"], 1),
            "baseline_occupancy_pct": _round(current_risk["baseline"]["occupancy"] * 100.0, 2),
            "baseline_speed_kmh": _round(current_risk["baseline"]["speed"] * MPH_TO_KMH, 2),
            "congestion_score": _round(current_risk["score"], 3),
            "congestion_level": current_risk["level"],
            "components": {k: _round(v, 3) for k, v in current_risk["components"].items()},
        }

        # Prediction windows
        steps_map = {"h1": 1, "h6": min(6, self.out_horizon), "h12": self.out_horizon}
        windows: dict[str, dict] = {}
        future_idx = self._future_indices(t_obs)
        print(f"[server] Calculating window metrics for sensor {sensor}...")
        for key, step in steps_map.items():
            idx = int(future_idx[step - 1])
            windows[key] = self._window_packet(
                sensor=sensor,
                step=step,
                idx=idx,
                flow=float(pred[sensor, step - 1, 0]),
                occupancy=float(pred[sensor, step - 1, 1]),
                speed=float(pred[sensor, step - 1, 2]),
                current=current_packet,
            )

        # Build scenario results from batch
        cursor = 1
        scenario_predictions = []
        for spec in weather_specs:
            spred = batch_preds[cursor]
            cursor += 1
            sflow, socc, sspeed = float(spred[sensor, 0, 0]), float(spred[sensor, 0, 1]), float(spred[sensor, 0, 2])
            srisk = self._risk_from_state(sensor=sensor, idx=(t_obs + 1) % self.t_len, flow=sflow, occupancy=socc, speed=sspeed)
            scenario_predictions.append({
                "key": spec["key"], "label": spec["label"], "description": spec["description"],
                "flow_veh_5min": _round(sflow, 1), "occupancy_pct": _round(socc * 100.0, 2), "speed_kmh": _round(sspeed * MPH_TO_KMH, 2),
                "delta_speed_kmh": _round(sspeed * MPH_TO_KMH - current_packet["speed_kmh"], 2),
                "delta_occupancy_pct": _round(socc * 100.0 - current_packet["occupancy_pct"], 2),
                "congestion_score": _round(srisk["score"], 3), "congestion_level": srisk["level"],
            })

        incident_scenarios = []
        for spec in accident_specs:
            spred = batch_preds[cursor]
            cursor += 1
            sflow, socc, sspeed = float(spred[sensor, 0, 0]), float(spred[sensor, 0, 1]), float(spred[sensor, 0, 2])
            srisk = self._risk_from_state(sensor=sensor, idx=(t_obs + 1) % self.t_len, flow=sflow, occupancy=socc, speed=sspeed)
            incident_scenarios.append({
                "key": spec["key"], "label": spec["label"], "description": spec["description"],
                "flow_veh_5min": _round(sflow, 1), "occupancy_pct": _round(socc * 100.0, 2), "speed_kmh": _round(sspeed * MPH_TO_KMH, 2),
                "delta_speed_kmh": _round(sspeed * MPH_TO_KMH - current_packet["speed_kmh"], 2),
                "delta_occupancy_pct": _round(socc * 100.0 - current_packet["occupancy_pct"], 2),
                "congestion_score": _round(srisk["score"], 3), "congestion_level": srisk["level"],
            })

        confidence = self._build_confidence(current_risk=current_risk, windows=windows, station_idx=sensor)
        # scenario_predictions already built above
        # incident_scenarios already built above

        tail_len = 24
        hist_idx = self._circular_indices(t_obs - tail_len + 1, tail_len)
        history_tail = {
            "times": [_idx_to_hhmm(i) for i in hist_idx],
            "flow_veh_5min": [_round(v, 1) for v in self.flow_raw[hist_idx, sensor]],
            "occupancy_pct": [_round(v * 100.0, 2) for v in self.occupancy_raw[hist_idx, sensor]],
            "speed_kmh": [_round(v * MPH_TO_KMH, 2) for v in self.speed_raw[hist_idx, sensor]],
            "risk_score": [
                _round(
                    self._risk_from_state(
                        sensor=sensor,
                        idx=int(idx),
                        flow=float(self.flow_raw[idx, sensor]),
                        occupancy=float(self.occupancy_raw[idx, sensor]),
                        speed=float(self.speed_raw[idx, sensor]),
                    )["score"],
                    3,
                )
                for idx in hist_idx
            ],
        }

        pred_scores_sensor = []
        pred_levels_sensor = []
        for h in range(self.out_horizon):
            risk = self._risk_from_state(
                sensor=sensor,
                idx=int(future_idx[h]),
                flow=float(pred[sensor, h, 0]),
                occupancy=float(pred[sensor, h, 1]),
                speed=float(pred[sensor, h, 2]),
            )
            pred_scores_sensor.append(_round(risk["score"], 3))
            pred_levels_sensor.append(risk["level"])

        prediction_series = {
            "times": [_idx_to_hhmm(i) for i in future_idx],
            "flow_veh_5min": [_round(v, 1) for v in pred[sensor, :, 0]],
            "occupancy_pct": [_round(v * 100.0, 2) for v in pred[sensor, :, 1]],
            "speed_kmh": [_round(v * MPH_TO_KMH, 2) for v in pred[sensor, :, 2]],
            "risk_score": pred_scores_sensor,
            "risk_level": pred_levels_sensor,
        }

        # Weekly compare: last 7 days, same time-of-day window (2h tail, downsampled to 8 points).
        weekly_points = 8
        weekly_tail_len = 24
        weekly_stride = max(1, weekly_tail_len // weekly_points)  # 24 -> 3 (15min)
        weekly_pos = list(range(0, weekly_tail_len, weekly_stride))[:weekly_points]

        weekly_days = []
        for day_back in range(6, -1, -1):  # oldest -> today
            t_day = int(t_obs - day_back * 288)
            idx_full = self._circular_indices(t_day - weekly_tail_len + 1, weekly_tail_len)
            idx = np.asarray(idx_full, dtype=np.int64)[weekly_pos]

            try:
                ts = self.timestamps[int(t_day) % self.t_len]
                day_label = str(ts.strftime("%a")).upper()[:3]
                date_label = str(ts.strftime("%Y-%m-%d"))
            except Exception:
                day_label = f"D{day_back}"
                date_label = ""

            weekly_days.append(
                {
                    "day": day_label,
                    "date": date_label,
                    "is_today": bool(day_back == 0),
                    "flow_veh_5min": [_round(v, 1) for v in self.flow_raw[idx, sensor]],
                    "occupancy_pct": [_round(v * 100.0, 2) for v in self.occupancy_raw[idx, sensor]],
                    "speed_kmh": [_round(v * MPH_TO_KMH, 2) for v in self.speed_raw[idx, sensor]],
                    "risk_score": [
                        _round(
                            self._risk_from_state(
                                sensor=sensor,
                                idx=int(ii),
                                flow=float(self.flow_raw[int(ii), sensor]),
                                occupancy=float(self.occupancy_raw[int(ii), sensor]),
                                speed=float(self.speed_raw[int(ii), sensor]),
                            )["score"],
                            3,
                        )
                        for ii in idx
                    ],
                }
            )

        weekly_compare = {
            "points": int(weekly_points),
            "tail_len": int(weekly_tail_len),
            "stride": int(weekly_stride),
            "times": [_idx_to_hhmm(int(hist_idx[int(i)])) for i in weekly_pos],
            "days": weekly_days,
        }

        all_scores, all_levels = self._risk_from_arrays(
            indices=future_idx,
            flow=pred_flow,
            occupancy=pred_occ,
            speed=pred_speed,
        )
        peak_scores = all_scores.max(axis=0)
        peak_levels = all_levels.max(axis=0)

        peak_key = max(windows, key=lambda k: float(windows[k]["congestion_score"]))
        station_meta = self.metadata.iloc[sensor]
        current_weather = self._weather_packet(t_obs, step_index=0)
        weather_out = self._monthly_weather_panorama(t_obs)
        recent_weather_idx = self._circular_indices(t_obs - 11, 12)
        future_weather_idx = self._future_indices(t_obs, min(12, self.out_horizon))
        station_packet = self._node_packet(sensor, include_runtime=True, idx=t_obs)
        station_packet["id"] = station_packet.get("station_id")
        station_packet["coverage_ratio"] = _maybe_float(station_meta.get("coverage_ratio"), 4)
        station_packet["station_length_mi"] = _maybe_float(station_meta.get("station_length"), 3)
        station_packet["static_features"] = self._static_feature_packet(sensor)
        weather_context = {
            "field_names": list(self.weather_field_names),
            "model_field_names": list(self.weather_model_fields),
            "current": self._weather_context_packet(t_obs),
            "recent_history": [self._weather_context_packet(int(idx)) for idx in recent_weather_idx],
            "forecast_window": [self._weather_context_packet(int(idx)) for idx in future_weather_idx],
            "monthly_panorama": weather_out,
        }
        accident_context = self._accident_context_packet(t_obs, sensor)
        local_network = self._local_network_packet(sensor, t_obs)
        profile_context = self._metric_profile_packet(sensor, t_obs, current_packet)

        final_out = {
            "meta": {
                "dataset": "Caltrans D03 2023",
                "mode": "multitask_occ_primary_weather_attn",
                "t_obs": int(t_obs),
                "sensor": int(sensor),
                "n_sensors": int(self.n_nodes),
                "in_len": int(self.in_len),
                "out_horizon": int(self.out_horizon),
                "tick_seconds": int(self.tick_seconds),
                "sim_time": self.timestamps[int(t_obs)].isoformat(),
                "day_type": "weekday" if self._day_type_index(t_obs) == 0 else "weekend",
                "slot_index": int(self._slot_index(t_obs)),
            },
            "dataset_context": self._dataset_context_packet(),
            "station": station_packet,
            "network": {
                "graph_summary": self.graph_summary_live,
                "local_neighbors": local_network["neighbors"],
                "local_links": local_network["links"],
            },
            "current_weather": current_weather,
            "weather": weather_out,
            "weather_transition": weather_transition,
            "weather_context": weather_context,
            "accidents": accident_context,
            "profiles": profile_context,
            "current": current_packet,
            "prediction_windows": windows,
            "prediction_series": prediction_series,
            "history_tail": history_tail,
            "weekly_compare": weekly_compare,
            "confidence": confidence,
            "scenario_predictions": scenario_predictions,
            "incident_scenarios": incident_scenarios,
            "congestion_summary": {
                "current_level": current_packet["congestion_level"],
                "peak_window": peak_key,
                "peak_minutes_ahead": int(windows[peak_key]["minutes_ahead"]),
                "peak_level": windows[peak_key]["congestion_level"],
                "peak_score": _round(float(windows[peak_key]["congestion_score"]), 3),
                "headline": f"{windows[peak_key]['minutes_ahead']} 分钟窗口风险最高",
            },
            "global_state": {
                "pred_levels": peak_levels.astype(int).tolist(),
                "pred_scores": [_round(v, 3) for v in peak_scores.tolist()],
            },
            "model_context": {
                "type": str(self.model_type),
                "target_names": list(self.target_names),
                "weather_fields_used": list(self.weather_model_fields),
                "accident_features_used": list(self.accident_feature_names),
                "static_feature_dim": int(self.static_feat_dim),
            },
        }
        print(f"[server] Response prepared. Keys: {list(final_out.keys())}")
        return final_out

    def get_graph_structure(self) -> dict:
        nodes = []
        for i in range(self.n_nodes):
            node = self._node_packet(i)
            node["id"] = str(i)
            node["name"] = str(self.station_ids[i])
            nodes.append(node)

        # Calculate range for frontend auto-centering
        lats = pd.to_numeric(self.metadata["latitude"], errors="coerce").fillna(0.0).values
        lons = pd.to_numeric(self.metadata["longitude"], errors="coerce").fillna(0.0).values

        return {
            "nodes": nodes, 
            "links": self.graph_links,
            "metadata": {
                "min_lat": float(lats.min()) if len(lats) > 0 else 0.0,
                "max_lat": float(lats.max()) if len(lats) > 0 else 0.0,
                "min_lon": float(lons.min()) if len(lons) > 0 else 0.0,
                "max_lon": float(lons.max()) if len(lons) > 0 else 0.0,
                "center_lat": float(lats.mean()) if len(lats) > 0 else 0.0,
                "center_lon": float(lons.mean()) if len(lons) > 0 else 0.0,
                "graph_summary": self.graph_summary_live,
                "edge_count": int(len(self.graph_links)),
            }
        }

    def get_dataset_context(self) -> dict:
        return self._dataset_context_packet()

    def health(self) -> dict:
        return {
            "dataset": "Caltrans D03 2023",
            "mode": "multitask_occ_primary_weather_attn",
            "shape": [int(self.t_len), int(self.n_nodes), 3],
            "ckpt": os.path.abspath(self.ckpt_path),
            "device": str(self.device),
            "in_len": int(self.in_len),
            "out_horizon": int(self.out_horizon),
            "predict_delta": bool(self.predict_delta),
            "graph_mode": str(self.graph_mode),
            "graph_directed": bool(self.graph_directed and self.graph_mode == "realistic"),
            "graph_summary": self.graph_summary_live,
            "accident_features": list(self.accident_feature_names),
            "traffic_core_feat": int(self.traffic_core_feat),
            "accident_feat_dim": int(self.accident_feat_dim),
            "static_feat_dim": int(self.static_feat_dim),
            "diffusion_steps": int(self.diffusion_steps),
            "adaptive_rank": int(self.adaptive_rank),
            "tick_seconds": int(self.tick_seconds),
            "start_index": int(self.anchor_index),
            "has_weather": True,
        }


class Handler(BaseHTTPRequestHandler):
    service: CaltransTrafficService

    def log_message(self, format, *args):
        # Restore standard logging to terminal
        sys.stderr.write("%s - - [%s] %s\n" %
                         (self.address_string(),
                          self.log_date_time_string(),
                          format%args))

    def _send_json(self, code: int, obj: dict) -> None:
        # Serializing with allow_nan=False is safer, but we should fix the data instead.
        # Here we use a custom encoder or just rely on the manual fixes above.
        try:
            raw = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except ValueError:
            # Fallback: if somehow NaN still exists, replace it with null or 0.0 using a regular dump
            # then manually replacing NaN (not perfect but better than crashing)
            raw = json.dumps(obj, ensure_ascii=False).replace('NaN', 'null').encode("utf-8")
        
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, socket.error):
            return

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        try:
            u = urlparse(self.path)
            if u.path == "/api/health":
                self._send_json(200, {"ok": True, "status": self.service.health()})
                return
            if u.path == "/api/dataset_context":
                self._send_json(200, self.service.get_dataset_context())
                return
            if u.path == "/api/graph_structure":
                self._send_json(200, self.service.get_graph_structure())
                return
            if u.path == "/api/debug_jump_weather":
                self._send_json(200, self.service.debug_jump_to_next_weather_transition())
                return
            if u.path == "/api/forecast":
                q = parse_qs(u.query)
                sensor = int(q.get("sensor", ["0"])[0])
                self._send_json(200, self.service.forecast(sensor=sensor))
                return
            self._send_json(404, {"error": "not_found", "path": u.path})
        except Exception as e:
            traceback.print_exc()
            self._send_json(400, {"error": str(e)})


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Caltrans D03 Pipeline API server")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--traffic-dir", required=True)
    p.add_argument("--weather-npy", required=True)
    p.add_argument("--weather-csv", required=True)
    p.add_argument("--ckpt", required=True)
    p.add_argument("--correction-ckpt", required=True)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--start-index", type=int, default=12 * 24)
    p.add_argument("--tick-seconds", type=int, default=10)
    return p.parse_args()


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

def main() -> None:
    args = parse_args()
    print(f"[main] Starting D03 Pipeline Server")
    print(f"[main] Traffic Dir: {args.traffic_dir}")
    print(f"[main] Weather NPY: {args.weather_npy}")
    print(f"[main] Checkpoint: {args.ckpt}")
    print(f"[main] Correction Model: {args.correction_ckpt}")
    svc = CaltransTrafficService(
        traffic_dir=args.traffic_dir,
        weather_npy=args.weather_npy,
        weather_csv=args.weather_csv,
        ckpt_path=args.ckpt,
        correction_ckpt=args.correction_ckpt,
        device=args.device,
        start_index=args.start_index,
        tick_seconds=args.tick_seconds,
    )
    Handler.service = svc

    httpd = ThreadedHTTPServer((args.host, args.port), Handler)
    print(f"\n{'=' * 50}")
    print("  Caltrans Multi-Task Traffic API Server")
    print(f"  http://{args.host}:{args.port}/api/forecast?sensor=0")
    print(f"  http://{args.host}:{args.port}/api/health")
    print(f"  tick={args.tick_seconds}s  device={args.device}")
    print(f"{'=' * 50}\n")
    try:
        httpd.serve_forever(poll_interval=0.5)
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
