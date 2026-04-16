from __future__ import annotations

import numpy as np
import pandas as pd
import torch


def distance_matrix_sensors(path: str) -> list[str]:
    cols = pd.read_csv(path, nrows=0).columns.tolist()
    if not cols or cols[0] != "":
        # many distance csvs have an empty first header for the index column
        pass
    return [str(c) for c in cols[1:]]


def load_distance_matrix(path: str, sensor_ids: list[str]) -> np.ndarray:
    df = pd.read_csv(path, index_col=0)
    df.index = df.index.astype(str)
    df.columns = df.columns.astype(str)

    missing = set(sensor_ids) - set(df.columns)
    if missing:
        raise ValueError(f"distance matrix missing sensors: {sorted(list(missing))[:5]} ...")

    df = df.loc[sensor_ids, sensor_ids]
    dist = df.to_numpy(dtype=np.float32, copy=True)
    return dist


def build_adjacency(dist: np.ndarray, k: int = 10, sigma: float | None = None) -> torch.Tensor:
    n = dist.shape[0]
    if dist.shape[0] != dist.shape[1]:
        raise ValueError("dist must be square")

    dist2 = dist.copy()
    dist2[np.diag_indices_from(dist2)] = np.inf
    dist2[dist2 <= 0] = np.inf  # treat -1 and 0 as no-edge

    edges = []
    for i in range(n):
        row = dist2[i]
        nn = np.argsort(row)[:k]
        for j in nn:
            d = row[j]
            if np.isfinite(d):
                edges.append((i, int(j), float(d)))

    if not edges:
        raise ValueError("no edges found from distance matrix")

    dvals = np.array([e[2] for e in edges], dtype=np.float32)
    if sigma is None:
        sigma = float(dvals.std() if dvals.std() > 1e-6 else 1.0)

    a = np.zeros((n, n), dtype=np.float32)
    for i, j, d in edges:
        w = float(np.exp(-((d / sigma) ** 2)))
        a[i, j] = max(a[i, j], w)
        a[j, i] = max(a[j, i], w)

    return torch.from_numpy(a)


def normalize_adjacency(adj: torch.Tensor, add_self_loops: bool = True) -> torch.Tensor:
    a = adj.to(dtype=torch.float32)
    if add_self_loops:
        a = a + torch.eye(a.shape[0], device=a.device, dtype=a.dtype)

    deg = a.sum(dim=1)
    deg_inv_sqrt = torch.pow(deg.clamp_min(1e-12), -0.5)
    d = torch.diag(deg_inv_sqrt)
    return d @ a @ d


def load_edge_list(path: str) -> tuple[np.ndarray, int]:
    df = pd.read_csv(path)
    for c in ("from", "to", "cost"):
        if c not in df.columns:
            raise ValueError(f"edge list missing '{c}': {path}")
    u = df["from"].to_numpy(dtype=np.int64, copy=False)
    v = df["to"].to_numpy(dtype=np.int64, copy=False)
    w = pd.to_numeric(df["cost"], errors="coerce").to_numpy(dtype=np.float32, copy=False)
    mask = np.isfinite(w)
    u, v, w = u[mask], v[mask], w[mask]
    n = int(max(u.max(initial=0), v.max(initial=0)) + 1)
    edges = np.stack([u, v, w], axis=1)
    return edges, n


def build_adjacency_from_edges(
    edges: np.ndarray, num_nodes: int, sigma: float | None = None, symmetrize: bool = True
) -> torch.Tensor:
    if edges.ndim != 2 or edges.shape[1] != 3:
        raise ValueError("edges must be [E,3] = (from,to,cost)")
    if num_nodes <= 0:
        raise ValueError("num_nodes must be > 0")

    costs = edges[:, 2].astype(np.float32, copy=False)
    if sigma is None:
        s = float(costs.std())
        sigma = s if s > 1e-6 else 1.0
    a = np.zeros((num_nodes, num_nodes), dtype=np.float32)

    for u, v, c in edges:
        u = int(u)
        v = int(v)
        if u < 0 or v < 0 or u >= num_nodes or v >= num_nodes:
            continue
        w = float(np.exp(-((float(c) / float(sigma)) ** 2)))
        if w > a[u, v]:
            a[u, v] = w
        if symmetrize and w > a[v, u]:
            a[v, u] = w

    return torch.from_numpy(a)
