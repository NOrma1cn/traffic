from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import sparse


def _safe_std_from_moments(mean: float, second_moment: float) -> float:
    var = max(float(second_moment) - float(mean) ** 2, 0.0)
    std = float(np.sqrt(var))
    return std if std >= 1e-6 else 1.0


@dataclass
class SparseAccidentFeatureSet:
    root: Path
    feature_names: list[str]
    matrices: list[sparse.csr_matrix]
    timestamps: np.ndarray
    use_log1p: bool = True

    @classmethod
    def load(cls, root: str | Path, feature_names: list[str] | None = None, *, use_log1p: bool = True):
        root_path = Path(root)
        with open(root_path / "feature_names.json", "r", encoding="utf-8") as f:
            available = [str(v) for v in json.load(f)]

        selected = available if not feature_names else [str(v) for v in feature_names]
        missing = [name for name in selected if name not in available]
        if missing:
            raise ValueError(f"accident feature names not found: {missing}")

        matrices: list[sparse.csr_matrix] = []
        for name in selected:
            mat = sparse.load_npz(root_path / "feature_matrices" / f"{name}.npz").tocsr().astype(np.float32)
            if use_log1p and mat.nnz:
                mat = mat.copy()
                mat.data = np.log1p(mat.data).astype(np.float32, copy=False)
            matrices.append(mat)

        timestamps = np.load(root_path / "timestamps.npy", allow_pickle=True)
        return cls(root=root_path, feature_names=selected, matrices=matrices, timestamps=timestamps, use_log1p=use_log1p)

    def validate_shape(self, *, t_len: int, n_nodes: int) -> None:
        for name, mat in zip(self.feature_names, self.matrices):
            if mat.shape != (t_len, n_nodes):
                raise ValueError(
                    f"accident matrix shape mismatch for {name}: got {mat.shape}, expected {(t_len, n_nodes)}"
                )

    def validate_timestamps(self, timestamps: np.ndarray) -> None:
        lhs = np.asarray(self.timestamps).astype(str)
        rhs = np.asarray(timestamps).astype(str)
        if lhs.shape != rhs.shape or not np.array_equal(lhs, rhs):
            raise ValueError("accident feature timestamps do not align with traffic timestamps")

    def compute_stats(self, train_time_end: int, n_nodes: int) -> tuple[np.ndarray, np.ndarray]:
        if train_time_end <= 0:
            raise ValueError("train_time_end must be > 0")
        denom = float(train_time_end * n_nodes)
        mean = np.zeros(len(self.matrices), dtype=np.float32)
        std = np.zeros(len(self.matrices), dtype=np.float32)
        for idx, mat in enumerate(self.matrices):
            train_mat = mat[:train_time_end]
            m1 = float(train_mat.sum()) / denom
            sq = train_mat.copy()
            if sq.nnz:
                sq.data = np.square(sq.data, dtype=np.float32)
            m2 = float(sq.sum()) / denom
            mean[idx] = np.float32(m1)
            std[idx] = np.float32(_safe_std_from_moments(m1, m2))
        return mean, std

    def slice_dense(
        self,
        indices: np.ndarray,
        *,
        mean: np.ndarray | None = None,
        std: np.ndarray | None = None,
    ) -> np.ndarray:
        idx = np.asarray(indices, dtype=np.int64)
        parts = []
        for f_idx, mat in enumerate(self.matrices):
            dense = mat[idx].toarray().astype(np.float32, copy=False)
            if mean is not None and std is not None:
                dense = (dense - float(mean[f_idx])) / float(std[f_idx])
            parts.append(dense)
        return np.stack(parts, axis=-1).astype(np.float32, copy=False)
