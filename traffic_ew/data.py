from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset


@dataclass(frozen=True)
class PemsConfig:
    speed_csv: str
    distance_csv: str
    weather_csv: str

    @staticmethod
    def for_name(name: str, data_root: str) -> "PemsConfig":
        traffic_dir = f"{data_root}/Traffic Datasets"
        weather_dir = f"{data_root}/Weather Datasets"

        if name.lower() == "pemsd4":
            return PemsConfig(
                speed_csv=f"{traffic_dir}/traffic_speed_PeMSD4.csv",
                distance_csv=f"{traffic_dir}/PeMSD4_Distance_Matrix_500_Sensors.csv",
                weather_csv=f"{weather_dir}/Oakland Weather_CA 2022-01-01 to 2022-12-31.csv",
            )
        if name.lower() == "pemsd7":
            return PemsConfig(
                speed_csv=f"{traffic_dir}/traffic_speed_PeMSD7.csv",
                distance_csv=f"{traffic_dir}/PeMSD7_Distance_Matrix_500_Sensors.csv",
                weather_csv=f"{weather_dir}/Los Angeles Weather USA 2022-01-01 to 2023-01-01.csv",
            )
        raise ValueError(f"unknown dataset: {name}")


def load_pems_speed(
    path: str,
    *,
    max_rows: int | None = None,
    sensor_whitelist: list[str] | None = None,
) -> tuple[pd.DatetimeIndex, list[str], np.ndarray]:
    if sensor_whitelist is None:
        df = pd.read_csv(path, nrows=max_rows)
        times = pd.to_datetime(df["Timestamp"])
        sensor_ids = [c for c in df.columns if c != "Timestamp"]
        speed = df[sensor_ids].to_numpy(dtype=np.float32, copy=True)
    else:
        header = pd.read_csv(path, nrows=0).columns.tolist()
        available = set(str(c) for c in header if c != "Timestamp")
        keep = [str(s) for s in sensor_whitelist if str(s) in available]
        if len(keep) < 10:
            raise ValueError(f"too few sensors after whitelist intersection: {len(keep)}")
        usecols = ["Timestamp", *keep]
        df = pd.read_csv(path, usecols=usecols, nrows=max_rows)
        times = pd.to_datetime(df["Timestamp"])
        sensor_ids = keep
        speed = df[keep].to_numpy(dtype=np.float32, copy=True)

    speed = np.nan_to_num(speed, nan=np.nan)
    # forward/back fill per sensor
    speed_df = pd.DataFrame(speed)
    speed_df = speed_df.ffill().bfill()
    speed = speed_df.to_numpy(dtype=np.float32, copy=False)

    return pd.DatetimeIndex(times), sensor_ids, speed


def load_weather_aligned(path: str, times: pd.DatetimeIndex) -> tuple[np.ndarray, list[str]]:
    df = pd.read_csv(path)
    if "datetime" not in df.columns:
        raise ValueError(f"weather csv missing 'datetime': {path}")

    df["datetime"] = pd.to_datetime(df["datetime"])
    df = df.sort_values("datetime")

    # Derive numeric cloudcover from text 'conditions' if cloudcover is absent
    if "cloudcover" not in df.columns and "conditions" in df.columns:
        conditions_map = {
            "clear": 0.0,
            "sunny": 5.0,
            "mostly clear": 10.0,
            "partially cloudy": 35.0,
            "overcast": 85.0,
            "mostly cloudy": 75.0,
            "cloudy": 65.0,
            "rain": 90.0,
            "drizzle": 80.0,
            "snow": 85.0,
            "fog": 70.0,
            "mist": 60.0,
        }
        def _cond_to_cloud(s: str) -> float:
            if not isinstance(s, str):
                return 25.0
            sl = s.lower().strip()
            for k, v in conditions_map.items():
                if k in sl:
                    return v
            return 25.0
        df["cloudcover"] = df["conditions"].apply(_cond_to_cloud)

    candidate = [
        "temp",
        "feelslike",
        "dew",
        "humidity",
        "precip",
        "windspeed",
        "winddir",
        "visibility",
        "cloudcover",
        "sealevelpressure",
    ]
    cols = [c for c in candidate if c in df.columns]
    if not cols:
        raise ValueError(f"no numeric weather columns found in: {path}")

    w = df[["datetime", *cols]].copy()
    for c in cols:
        w[c] = pd.to_numeric(w[c], errors="coerce")
    w = w.dropna(subset=["datetime"]).sort_values("datetime")

    target = pd.DataFrame({"datetime": times})
    aligned = pd.merge_asof(
        target.sort_values("datetime"),
        w,
        on="datetime",
        direction="backward",
        tolerance=pd.Timedelta("2h"),
    )
    aligned = aligned[cols]
    # Some sources (e.g. Open-Meteo) may not provide certain fields (visibility) for all times.
    # Fill missing values per-column to avoid NaNs propagating into model loss.
    aligned = aligned.ffill().bfill()
    for c in cols:
        if aligned[c].isna().any():
            if aligned[c].isna().all():
                aligned[c] = aligned[c].fillna(0.0)
            else:
                aligned[c] = aligned[c].fillna(aligned[c].median(skipna=True))
    return aligned.to_numpy(dtype=np.float32, copy=True), cols


def build_time_features(times: pd.DatetimeIndex) -> np.ndarray:
    minutes = (times.hour * 60 + times.minute).to_numpy(dtype=np.float32)
    tod = minutes / (24.0 * 60.0) * (2.0 * np.pi)
    dow = times.dayofweek.to_numpy(dtype=np.float32) / 7.0 * (2.0 * np.pi)

    feats = np.stack(
        [
            np.sin(tod),
            np.cos(tod),
            np.sin(dow),
            np.cos(dow),
        ],
        axis=1,
    ).astype(np.float32)
    return feats


def build_time_features_from_index(
    t_len: int, *, steps_per_day: int = 288, steps_per_week: int | None = None
) -> np.ndarray:
    t_len = int(t_len)
    if t_len <= 0:
        raise ValueError("t_len must be > 0")
    steps_per_day = int(steps_per_day)
    if steps_per_day <= 0:
        raise ValueError("steps_per_day must be > 0")

    idx = np.arange(t_len, dtype=np.float32)
    tod = (idx % steps_per_day) / float(steps_per_day) * (2.0 * np.pi)

    if steps_per_week is None:
        steps_per_week = steps_per_day * 7
    steps_per_week = int(steps_per_week)
    dow = (idx % steps_per_week) / float(steps_per_week) * (2.0 * np.pi)

    feats = np.stack(
        [
            np.sin(tod),
            np.cos(tod),
            np.sin(dow),
            np.cos(dow),
        ],
        axis=1,
    ).astype(np.float32)
    return feats


def load_pems08_npz(path: str) -> np.ndarray:
    d = np.load(path)
    if "data" not in d.files:
        raise ValueError(f"npz missing 'data': {path}")
    x = d["data"]
    if x.ndim != 3 or x.shape[2] < 3:
        raise ValueError(f"unexpected PEMS08 shape: {x.shape}")
    return x.astype(np.float32, copy=False)


def window_indices(t_len: int, in_len: int, horizon: int) -> np.ndarray:
    m = t_len - in_len - horizon + 1
    if m <= 0:
        raise ValueError("time series too short for given in_len/horizon")
    return np.arange(m, dtype=np.int64)


def make_splits(
    win_starts: np.ndarray,
    train_ratio: float,
    val_ratio: float,
) -> tuple[slice, slice, slice]:
    m = len(win_starts)
    tr = int(m * train_ratio)
    va = int(m * val_ratio)
    tr = max(tr, 1)
    va = max(va, 1)
    te = m - tr - va
    if te <= 0:
        raise ValueError("split ratios leave no test samples")

    tr_slice = slice(0, tr)
    va_slice = slice(tr, tr + va)
    te_slice = slice(tr + va, m)
    return tr_slice, va_slice, te_slice


@dataclass(frozen=True)
class Normalization:
    speed_mean: np.ndarray  # [N]
    speed_std: np.ndarray  # [N]
    weather_mean: np.ndarray  # [W]
    weather_std: np.ndarray  # [W]
    time_mean: np.ndarray  # [D]
    time_std: np.ndarray  # [D]

    def to_dict(self) -> dict:
        return {
            "speed_mean": self.speed_mean.tolist(),
            "speed_std": self.speed_std.tolist(),
            "weather_mean": self.weather_mean.tolist(),
            "weather_std": self.weather_std.tolist(),
            "time_mean": self.time_mean.tolist(),
            "time_std": self.time_std.tolist(),
        }


def _safe_std(x: np.ndarray, axis: int) -> np.ndarray:
    s = x.std(axis=axis)
    s = np.where(s < 1e-6, 1.0, s)
    return s.astype(np.float32)


def normalize_by_train_stats(
    speed: np.ndarray,
    weather: np.ndarray,
    time_feat: np.ndarray,
    train_time_end: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, Normalization]:
    train_time_end = int(min(train_time_end, speed.shape[0]))
    sp_tr = speed[:train_time_end]
    we_tr = weather[:train_time_end]
    ti_tr = time_feat[:train_time_end]

    sp_mean = sp_tr.mean(axis=0).astype(np.float32)
    sp_std = _safe_std(sp_tr, axis=0)
    we_mean = we_tr.mean(axis=0).astype(np.float32)
    we_std = _safe_std(we_tr, axis=0)
    ti_mean = ti_tr.mean(axis=0).astype(np.float32)
    ti_std = _safe_std(ti_tr, axis=0)

    speed_n = ((speed - sp_mean) / sp_std).astype(np.float32)
    weather_n = ((weather - we_mean) / we_std).astype(np.float32)
    time_n = ((time_feat - ti_mean) / ti_std).astype(np.float32)

    return (
        speed_n,
        weather_n,
        time_n,
        Normalization(
            speed_mean=sp_mean,
            speed_std=sp_std,
            weather_mean=we_mean,
            weather_std=we_std,
            time_mean=ti_mean,
            time_std=ti_std,
        ),
    )


class WindowDataset(Dataset):
    def __init__(
        self,
        *,
        speed: np.ndarray,  # [T,N] normalized
        weather: np.ndarray,  # [T,W] normalized
        time_feat: np.ndarray,  # [T,D] normalized
        start_indices: Iterable[int],
        in_len: int,
        horizon: int,
        threshold: np.ndarray,  # [N] normalized threshold
        label_stat: str = "min",
    ) -> None:
        self.speed = speed
        self.weather = weather
        self.time_feat = time_feat
        self.start_indices = list(start_indices)
        self.in_len = int(in_len)
        self.horizon = int(horizon)
        self.threshold = threshold.astype(np.float32, copy=False)
        if label_stat not in {"min", "mean"}:
            raise ValueError("label_stat must be 'min' or 'mean'")
        self.label_stat = label_stat

        t = speed.shape[0]
        wmax = t - self.in_len - self.horizon
        if self.start_indices and (min(self.start_indices) < 0 or max(self.start_indices) > wmax):
            raise ValueError("start_indices out of range")

    def __len__(self) -> int:
        return len(self.start_indices)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        s = int(self.start_indices[idx])
        x_speed = torch.from_numpy(self.speed[s : s + self.in_len])  # [Tin,N]
        x_weather = torch.from_numpy(self.weather[s : s + self.in_len])  # [Tin,W]
        x_time = torch.from_numpy(self.time_feat[s : s + self.in_len])  # [Tin,D]

        x_speed = x_speed.unsqueeze(-1)  # [Tin,N,1]
        n = x_speed.shape[1]
        x_weather = x_weather.unsqueeze(1).expand(-1, n, -1)  # [Tin,N,W]
        x_time = x_time.unsqueeze(1).expand(-1, n, -1)  # [Tin,N,D]
        x = torch.cat([x_speed, x_weather, x_time], dim=-1).to(torch.float32)

        future = self.speed[s + self.in_len : s + self.in_len + self.horizon]  # [H,N]
        if self.label_stat == "min":
            stat = future.min(axis=0)
        else:
            stat = future.mean(axis=0)
        y = (stat < self.threshold).astype(np.float32, copy=False)
        return x, torch.from_numpy(y)


class MultiSourceWindowDataset(Dataset):
    def __init__(
        self,
        *,
        traffic_raw: np.ndarray,  # [T,N,C] unnormalized
        traffic: np.ndarray,  # [T,N,C] normalized
        exo: np.ndarray | None,  # [T,E] normalized
        start_indices: Iterable[int],
        in_len: int,
        horizon: int,
        label_fn,
    ) -> None:
        self.traffic_raw = traffic_raw
        self.traffic = traffic
        self.exo = exo
        self.start_indices = list(start_indices)
        self.in_len = int(in_len)
        self.horizon = int(horizon)
        self.label_fn = label_fn

        t = traffic.shape[0]
        wmax = t - self.in_len - self.horizon
        if self.start_indices and (min(self.start_indices) < 0 or max(self.start_indices) > wmax):
            raise ValueError("start_indices out of range")
        if traffic_raw.shape[:2] != traffic.shape[:2]:
            raise ValueError("traffic_raw and traffic must align in T,N")
        if traffic_raw.shape[2] != traffic.shape[2]:
            raise ValueError("traffic_raw and traffic must align in C")
        if exo is not None and exo.shape[0] != t:
            raise ValueError("exo must align in time dimension")

    def __len__(self) -> int:
        return len(self.start_indices)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        s = int(self.start_indices[idx])
        x_tr = torch.from_numpy(self.traffic[s : s + self.in_len])  # [Tin,N,C]
        if self.exo is None:
            x = x_tr.to(torch.float32)
        else:
            x_exo = torch.from_numpy(self.exo[s : s + self.in_len])  # [Tin,E]
            n = x_tr.shape[1]
            x_exo = x_exo.unsqueeze(1).expand(-1, n, -1)
            x = torch.cat([x_tr, x_exo], dim=-1).to(torch.float32)

        fut = self.traffic_raw[s + self.in_len : s + self.in_len + self.horizon]  # [H,N,C]
        y = self.label_fn(fut).astype(np.float32, copy=False)  # [N]
        return x, torch.from_numpy(y)


class MultiHorizonWindowDataset(Dataset):
    def __init__(
        self,
        *,
        speed: np.ndarray,  # [T,N] normalized
        weather: np.ndarray,  # [T,W] normalized
        time_feat: np.ndarray,  # [T,D] normalized
        start_indices: Iterable[int],
        in_len: int,
        horizon: int,
        threshold: np.ndarray,  # [N] normalized threshold
    ) -> None:
        self.speed = speed
        self.weather = weather
        self.time_feat = time_feat
        self.start_indices = list(start_indices)
        self.in_len = int(in_len)
        self.horizon = int(horizon)
        self.threshold = threshold.astype(np.float32, copy=False)

        t = speed.shape[0]
        wmax = t - self.in_len - self.horizon
        if self.start_indices and (min(self.start_indices) < 0 or max(self.start_indices) > wmax):
            raise ValueError("start_indices out of range")

    def __len__(self) -> int:
        return len(self.start_indices)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        s = int(self.start_indices[idx])
        x_speed = torch.from_numpy(self.speed[s : s + self.in_len]).unsqueeze(-1)  # [Tin,N,1]
        x_weather = torch.from_numpy(self.weather[s : s + self.in_len])  # [Tin,W]
        x_time = torch.from_numpy(self.time_feat[s : s + self.in_len])  # [Tin,D]
        n = x_speed.shape[1]
        x_weather = x_weather.unsqueeze(1).expand(-1, n, -1)  # [Tin,N,W]
        x_time = x_time.unsqueeze(1).expand(-1, n, -1)  # [Tin,N,D]
        x = torch.cat([x_speed, x_weather, x_time], dim=-1).to(torch.float32)  # [Tin,N,F]

        fut = self.speed[s + self.in_len : s + self.in_len + self.horizon]  # [H,N]
        y = (fut < self.threshold[None, :]).astype(np.float32)  # [H,N]
        y = y.T  # [N,H]
        return x, torch.from_numpy(y)


class MultiSourceMultiHorizonDataset(Dataset):
    def __init__(
        self,
        *,
        traffic_raw: np.ndarray,  # [T,N,C] unnormalized
        traffic: np.ndarray,  # [T,N,C] normalized
        exo: np.ndarray | None,  # [T,E] normalized
        start_indices: Iterable[int],
        in_len: int,
        horizon: int,
        label_seq_fn,
    ) -> None:
        self.traffic_raw = traffic_raw
        self.traffic = traffic
        self.exo = exo
        self.start_indices = list(start_indices)
        self.in_len = int(in_len)
        self.horizon = int(horizon)
        self.label_seq_fn = label_seq_fn

        t = traffic.shape[0]
        wmax = t - self.in_len - self.horizon
        if self.start_indices and (min(self.start_indices) < 0 or max(self.start_indices) > wmax):
            raise ValueError("start_indices out of range")
        if traffic_raw.shape[:2] != traffic.shape[:2]:
            raise ValueError("traffic_raw and traffic must align in T,N")
        if traffic_raw.shape[2] != traffic.shape[2]:
            raise ValueError("traffic_raw and traffic must align in C")
        if exo is not None and exo.shape[0] != t:
            raise ValueError("exo must align in time dimension")

    def __len__(self) -> int:
        return len(self.start_indices)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        s = int(self.start_indices[idx])
        x_tr = torch.from_numpy(self.traffic[s : s + self.in_len])  # [Tin,N,C]
        if self.exo is None:
            x = x_tr.to(torch.float32)
        else:
            x_exo = torch.from_numpy(self.exo[s : s + self.in_len])  # [Tin,E]
            n = x_tr.shape[1]
            x_exo = x_exo.unsqueeze(1).expand(-1, n, -1)
            x = torch.cat([x_tr, x_exo], dim=-1).to(torch.float32)

        fut = self.traffic_raw[s + self.in_len : s + self.in_len + self.horizon]  # [H,N,C]
        y = self.label_seq_fn(fut).astype(np.float32, copy=False)  # [N,H]
        return x, torch.from_numpy(y)
