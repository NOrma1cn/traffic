from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.sparse.csgraph import connected_components


MILES_TO_KM = 1.60934
OPPOSITE_DIRECTION = {"N": "S", "S": "N", "E": "W", "W": "E"}
STOP_TOKENS = {
    "N",
    "S",
    "E",
    "W",
    "NB",
    "SB",
    "EB",
    "WB",
    "ONR",
    "OFR",
    "ON",
    "OFF",
    "LOOP",
    "OC",
    "IC",
    "NO",
    "SO",
    "EO",
    "WO",
    "NO",
    "SO",
    "EO",
    "WO",
    "T",
    "L",
    "R",
}


def normalize_direction(value) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip().upper()
    return text if text else None


def normalize_int(value) -> int | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    if not text:
        return None
    match = re.search(r"-?\d+", text)
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def normalize_station_name(value) -> str:
    text = str(value or "").upper()
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    tokens = [tok for tok in text.split() if tok]
    if not tokens:
        return ""
    keep: list[str] = []
    for tok in tokens:
        if tok in STOP_TOKENS:
            continue
        if re.fullmatch(r"\d+(\.\d+)?", tok):
            continue
        if tok in {"MI", "MILE", "MILES"}:
            continue
        keep.append(tok)
    if keep:
        return " ".join(keep)
    return " ".join(tokens)


def haversine_km(lat1: float, lon1: float, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    lat1_rad = np.radians(lat1)
    lon1_rad = np.radians(lon1)
    lats_rad = np.radians(lats)
    lons_rad = np.radians(lons)
    dlat = lats_rad - lat1_rad
    dlon = lons_rad - lon1_rad
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1_rad) * np.cos(lats_rad) * np.sin(dlon / 2.0) ** 2
    return 6371.0088 * 2.0 * np.arcsin(np.sqrt(a))


def _prep_metadata(metadata: pd.DataFrame) -> pd.DataFrame:
    meta = metadata.copy().reset_index(drop=True)
    meta["station_id_num"] = pd.to_numeric(meta["station_id"], errors="coerce")
    meta["freeway_num"] = meta["freeway"].map(normalize_int)
    meta["direction_norm"] = meta["direction"].map(normalize_direction)
    meta["abs_pm_num"] = pd.to_numeric(meta["abs_pm"], errors="coerce")
    meta["latitude_num"] = pd.to_numeric(meta["latitude"], errors="coerce")
    meta["longitude_num"] = pd.to_numeric(meta["longitude"], errors="coerce")
    meta["lanes_num"] = pd.to_numeric(meta.get("lanes"), errors="coerce")
    meta["station_name_norm"] = meta["station_name"].map(normalize_station_name)
    return meta


def build_legacy_corridor_edges(metadata: pd.DataFrame, corridor_k: int) -> tuple[np.ndarray, pd.DataFrame, dict[str, Any]]:
    meta = _prep_metadata(metadata)
    edges: list[tuple[int, int, float, str]] = []
    if corridor_k < 1:
        raise ValueError("corridor_k must be >= 1")

    for _, grp in meta.groupby(["freeway", "direction"], sort=False):
        grp2 = grp.sort_values(["station_id_num", "station_id"])
        idxs = grp2.index.to_list()
        for pos, u in enumerate(idxs):
            lo = max(0, pos - corridor_k)
            hi = min(len(idxs), pos + corridor_k + 1)
            for nb_pos in range(lo, hi):
                if nb_pos == pos:
                    continue
                v = idxs[nb_pos]
                rank_dist = abs(nb_pos - pos)
                edges.append((int(u), int(v), float(rank_dist), "legacy_corridor"))

    edge_df = pd.DataFrame(edges, columns=["source", "target", "cost", "edge_type"])
    summary = summarize_graph_edges(edge_df, len(meta))
    summary["graph_mode"] = "legacy"
    return edge_df[["source", "target", "cost"]].to_numpy(dtype=np.float32), edge_df, summary


def build_realistic_highway_edges(
    metadata: pd.DataFrame,
    *,
    corridor_k: int,
    lane_penalty: float = 0.08,
    hop_penalty: float = 0.35,
    opposite_radius_km: float = 1.0,
    opposite_pm_tolerance_mi: float = 0.6,
    same_name_cross_radius_km: float = 1.2,
    junction_radius_km: float = 0.7,
    max_junction_edges: int = 2,
) -> tuple[np.ndarray, pd.DataFrame, dict[str, Any]]:
    meta = _prep_metadata(metadata)
    if corridor_k < 1:
        raise ValueError("corridor_k must be >= 1")

    dedup: dict[tuple[int, int], dict[str, Any]] = {}

    def add_edge(u: int, v: int, cost: float, edge_type: str, **extra) -> None:
        if u == v:
            return
        key = (int(u), int(v))
        payload = {"source": int(u), "target": int(v), "cost": float(cost), "edge_type": edge_type}
        payload.update(extra)
        prev = dedup.get(key)
        if prev is None or float(cost) < float(prev["cost"]):
            dedup[key] = payload

    # 1) Same freeway + direction corridor edges, ordered by true postmile.
    for (freeway, direction), grp in meta.groupby(["freeway_num", "direction_norm"], sort=False):
        grp = grp.sort_values(
            ["abs_pm_num", "latitude_num", "longitude_num", "station_name_norm", "station_id_num", "station_id"]
        )
        idxs = grp.index.to_list()
        abs_pm = grp["abs_pm_num"].to_numpy(dtype=float)
        lats = grp["latitude_num"].to_numpy(dtype=float)
        lons = grp["longitude_num"].to_numpy(dtype=float)
        lanes = grp["lanes_num"].to_numpy(dtype=float)

        for pos, u in enumerate(idxs):
            for hop in range(1, corridor_k + 1):
                if pos + hop >= len(idxs):
                    break
                v = idxs[pos + hop]
                pm_delta_mi = float(abs_pm[pos + hop] - abs_pm[pos]) if np.isfinite(abs_pm[pos + hop] - abs_pm[pos]) else np.nan
                geo_km = float(haversine_km(float(lats[pos]), float(lons[pos]), np.asarray([lats[pos + hop]]), np.asarray([lons[pos + hop]]) )[0])
                roadway_km = float(pm_delta_mi * MILES_TO_KM) if np.isfinite(pm_delta_mi) and pm_delta_mi > 0 else np.nan
                base_km = roadway_km if np.isfinite(roadway_km) and roadway_km >= geo_km * 0.6 else geo_km
                base_km = max(base_km, 0.03)
                lane_gap = abs(float(lanes[pos]) - float(lanes[pos + hop])) if np.isfinite(lanes[pos]) and np.isfinite(lanes[pos + hop]) else 0.0
                cost = base_km * (1.0 + hop_penalty * float(hop - 1)) + lane_penalty * lane_gap
                if str(direction) in {"W", "S"}:
                    src = int(v)
                    dst = int(u)
                else:
                    src = int(u)
                    dst = int(v)
                add_edge(
                    src,
                    dst,
                    float(cost),
                    "corridor",
                    freeway=int(freeway) if freeway is not None else None,
                    direction=str(direction) if direction is not None else None,
                    hop=int(hop),
                    geo_km=geo_km,
                    pm_delta_mi=float(pm_delta_mi) if np.isfinite(pm_delta_mi) else None,
                )

    # 2) Opposite directions of same freeway at the same named location.
    for (freeway, station_name_norm), grp in meta.groupby(["freeway_num", "station_name_norm"], sort=False):
        if not station_name_norm or grp["direction_norm"].nunique() < 2:
            continue
        for direction, opposite in OPPOSITE_DIRECTION.items():
            left = grp[grp["direction_norm"] == direction]
            right = grp[grp["direction_norm"] == opposite]
            if left.empty or right.empty:
                continue
            candidates: list[tuple[float, int, int, float, float]] = []
            for u_idx, u_row in left.iterrows():
                r_lats = right["latitude_num"].to_numpy(dtype=float)
                r_lons = right["longitude_num"].to_numpy(dtype=float)
                geos = haversine_km(float(u_row["latitude_num"]), float(u_row["longitude_num"]), r_lats, r_lons)
                pm_diffs = np.abs(right["abs_pm_num"].to_numpy(dtype=float) - float(u_row["abs_pm_num"]))
                for pos, (v_idx, v_row) in enumerate(right.iterrows()):
                    geo_km = float(geos[pos])
                    pm_delta_mi = float(pm_diffs[pos]) if np.isfinite(pm_diffs[pos]) else math.inf
                    if geo_km <= float(opposite_radius_km) or pm_delta_mi <= float(opposite_pm_tolerance_mi):
                        score = geo_km + 0.2 * min(pm_delta_mi, 1.0)
                        candidates.append((score, int(u_idx), int(v_idx), geo_km, pm_delta_mi))
            used_left: set[int] = set()
            used_right: set[int] = set()
            for _, u_idx, v_idx, geo_km, pm_delta_mi in sorted(candidates):
                if u_idx in used_left or v_idx in used_right:
                    continue
                used_left.add(u_idx)
                used_right.add(v_idx)
                cost = max(geo_km, 0.05) + 0.15 + 0.1 * min(pm_delta_mi, 1.0)
                add_edge(
                    u_idx,
                    v_idx,
                    cost,
                    "opposite_pair",
                    freeway=int(freeway) if freeway is not None else None,
                    station_name=str(station_name_norm),
                    geo_km=geo_km,
                    pm_delta_mi=float(pm_delta_mi),
                )
                add_edge(
                    v_idx,
                    u_idx,
                    cost,
                    "opposite_pair",
                    freeway=int(freeway) if freeway is not None else None,
                    station_name=str(station_name_norm),
                    geo_km=geo_km,
                    pm_delta_mi=float(pm_delta_mi),
                )

    # 3) Same named location across different freeways, usually interchange neighborhoods.
    for station_name_norm, grp in meta.groupby("station_name_norm", sort=False):
        if not station_name_norm or grp["freeway_num"].nunique() < 2:
            continue
        rows = list(grp.itertuples())
        for i, u_row in enumerate(rows):
            for v_row in rows[i + 1 :]:
                if int(u_row.Index) == int(v_row.Index):
                    continue
                if u_row.freeway_num == v_row.freeway_num:
                    continue
                geo_km = float(
                    haversine_km(
                        float(u_row.latitude_num),
                        float(u_row.longitude_num),
                        np.asarray([float(v_row.latitude_num)]),
                        np.asarray([float(v_row.longitude_num)]),
                    )[0]
                )
                if geo_km > float(same_name_cross_radius_km):
                    continue
                cost = max(geo_km, 0.05) + 0.35
                add_edge(
                    int(u_row.Index),
                    int(v_row.Index),
                    cost,
                    "same_name_cross_fwy",
                    station_name=str(station_name_norm),
                    geo_km=geo_km,
                )
                add_edge(
                    int(v_row.Index),
                    int(u_row.Index),
                    cost,
                    "same_name_cross_fwy",
                    station_name=str(station_name_norm),
                    geo_km=geo_km,
                )

    # 4) Extremely close cross-freeway junctions even if names differ.
    lats_all = meta["latitude_num"].to_numpy(dtype=float)
    lons_all = meta["longitude_num"].to_numpy(dtype=float)
    fwy_all = meta["freeway_num"].to_numpy(dtype=object)
    for i in range(len(meta)):
        geos = haversine_km(float(lats_all[i]), float(lons_all[i]), lats_all, lons_all)
        candidate_idx = [
            j
            for j in np.argsort(geos)
            if j != i and fwy_all[j] != fwy_all[i] and geos[j] <= float(junction_radius_km)
        ]
        kept = 0
        for j in candidate_idx:
            cost = max(float(geos[j]), 0.03) + 0.45
            add_edge(
                int(i),
                int(j),
                cost,
                "junction",
                geo_km=float(geos[j]),
            )
            add_edge(
                int(j),
                int(i),
                cost,
                "junction",
                geo_km=float(geos[j]),
            )
            kept += 1
            if kept >= int(max_junction_edges):
                break

    edge_df = pd.DataFrame(dedup.values()).sort_values(["edge_type", "source", "target"]).reset_index(drop=True)
    summary = summarize_graph_edges(edge_df, len(meta))
    summary["graph_mode"] = "realistic"
    return edge_df[["source", "target", "cost"]].to_numpy(dtype=np.float32), edge_df, summary


def summarize_graph_edges(edge_df: pd.DataFrame, num_nodes: int) -> dict[str, Any]:
    if edge_df.empty:
        return {
            "num_nodes": int(num_nodes),
            "num_unique_edges": 0,
            "connected_components": int(num_nodes),
            "largest_component": 1 if num_nodes > 0 else 0,
            "edge_type_counts": {},
            "degree_quantiles": {"q10": 0.0, "q50": 0.0, "q90": 0.0},
        }

    rows = edge_df["source"].to_numpy(dtype=np.int32)
    cols = edge_df["target"].to_numpy(dtype=np.int32)
    data = np.ones(len(edge_df), dtype=np.float32)
    undirected = sparse.coo_matrix((data, (rows, cols)), shape=(num_nodes, num_nodes), dtype=np.float32)
    undirected = undirected + undirected.T
    undirected.data[:] = 1.0
    undirected = undirected.tocsr()
    component_count, labels = connected_components(undirected, directed=False, return_labels=True)
    component_sizes = np.bincount(labels, minlength=component_count) if labels.size else np.asarray([], dtype=np.int64)
    degree = np.asarray(undirected.sum(axis=1)).ravel()

    return {
        "num_nodes": int(num_nodes),
        "num_unique_edges": int(len(edge_df)),
        "connected_components": int(component_count),
        "largest_component": int(component_sizes.max()) if component_sizes.size else 0,
        "edge_type_counts": {str(k): int(v) for k, v in edge_df["edge_type"].value_counts().to_dict().items()},
        "degree_quantiles": {
            "q10": float(np.quantile(degree, 0.1)),
            "q50": float(np.quantile(degree, 0.5)),
            "q90": float(np.quantile(degree, 0.9)),
        },
    }


def build_caltrans_graph(
    metadata: pd.DataFrame,
    *,
    graph_mode: str = "realistic",
    corridor_k: int = 2,
    lane_penalty: float = 0.08,
    hop_penalty: float = 0.35,
    opposite_radius_km: float = 1.0,
    opposite_pm_tolerance_mi: float = 0.6,
    same_name_cross_radius_km: float = 1.2,
    junction_radius_km: float = 0.7,
    max_junction_edges: int = 2,
) -> tuple[np.ndarray, pd.DataFrame, dict[str, Any]]:
    if graph_mode == "legacy":
        return build_legacy_corridor_edges(metadata, corridor_k=corridor_k)
    if graph_mode != "realistic":
        raise ValueError(f"unknown graph_mode: {graph_mode}")
    return build_realistic_highway_edges(
        metadata,
        corridor_k=corridor_k,
        lane_penalty=lane_penalty,
        hop_penalty=hop_penalty,
        opposite_radius_km=opposite_radius_km,
        opposite_pm_tolerance_mi=opposite_pm_tolerance_mi,
        same_name_cross_radius_km=same_name_cross_radius_km,
        junction_radius_km=junction_radius_km,
        max_junction_edges=max_junction_edges,
    )
