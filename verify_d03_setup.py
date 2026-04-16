#!/usr/bin/env python3
"""
D03 Setup Verification Script
Checks if all required files and models are present for D03 deployment.
"""

import os
import sys
import json
from pathlib import Path

# ANSI color codes
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'
PKG_IMPORT_NAMES = {
    "scikit-learn": "sklearn",
}


def _supports_utf8_stdout() -> bool:
    encoding = getattr(sys.stdout, "encoding", None) or ""
    try:
        "✓✗⚠ℹ".encode(encoding or "utf-8")
        return True
    except LookupError:
        return False
    except UnicodeEncodeError:
        return False


USE_UTF8_SYMBOLS = _supports_utf8_stdout()
OK = "✓" if USE_UTF8_SYMBOLS else "[OK]"
FAIL = "✗" if USE_UTF8_SYMBOLS else "[FAIL]"
WARN = "⚠" if USE_UTF8_SYMBOLS else "[WARN]"
INFO = "ℹ" if USE_UTF8_SYMBOLS else "[INFO]"


def copy_env_hint(src: str, dst: str) -> str:
    if os.name == "nt":
        return f"Copy-Item {src} {dst}"
    return f"cp {src} {dst}"


def check_file(path: str, description: str) -> bool:
    """Check if a file exists."""
    if os.path.exists(path):
        size = os.path.getsize(path)
        size_mb = size / (1024 * 1024)
        print(f"{GREEN}{OK}{RESET} {description}: {path} ({size_mb:.1f} MB)")
        return True
    else:
        print(f"{RED}{FAIL}{RESET} {description}: {path} {RED}NOT FOUND{RESET}")
        return False


def check_dir(path: str, description: str) -> bool:
    """Check if a directory exists."""
    if os.path.isdir(path):
        file_count = len(list(Path(path).rglob('*')))
        print(f"{GREEN}{OK}{RESET} {description}: {path} ({file_count} files)")
        return True
    else:
        print(f"{RED}{FAIL}{RESET} {description}: {path} {RED}NOT FOUND{RESET}")
        return False


def check_numpy_shape(path: str, expected_shape: tuple | None = None) -> bool:
    """Check numpy array shape."""
    try:
        import numpy as np
        arr = np.load(path, allow_pickle=True)
        shape_str = f"shape={arr.shape}, dtype={arr.dtype}"
        if expected_shape and arr.shape != expected_shape:
            print(f"  {YELLOW}{WARN}{RESET}  Expected shape {expected_shape}, got {arr.shape}")
            return False
        print(f"  {BLUE}{INFO}{RESET}  {shape_str}")
        return True
    except Exception as e:
        print(f"  {RED}{FAIL}{RESET} Failed to load: {e}")
        return False


def check_checkpoint(path: str) -> bool:
    """Check PyTorch checkpoint."""
    try:
        import torch
        ckpt = torch.load(path, map_location='cpu', weights_only=False)
        keys = list(ckpt.keys())
        print(f"  {BLUE}{INFO}{RESET}  Keys: {', '.join(keys[:5])}{'...' if len(keys) > 5 else ''}")
        if 'model' in ckpt:
            model_keys = len(ckpt['model'].keys())
            print(f"  {BLUE}{INFO}{RESET}  Model parameters: {model_keys} tensors")
        return True
    except Exception as e:
        print(f"  {RED}{FAIL}{RESET} Failed to load checkpoint: {e}")
        return False


def main():
    print(f"\n{BLUE}{'='*60}{RESET}")
    print(f"{BLUE}  D03 Setup Verification{RESET}")
    print(f"{BLUE}{'='*60}{RESET}\n")

    all_ok = True

    # Load config
    config_path = "config_d03.json"
    if not os.path.exists(config_path):
        print(f"{RED}{FAIL} Configuration file not found: {config_path}{RESET}")
        print(f"{YELLOW}Using default paths...{RESET}\n")
        config = {
            "data_paths": {
                "traffic_dir": "Caltrans_2023_D03/processed_d03_2023_ml95_enriched",
                "weather_npy": "Caltrans_2023_D03/weather_d03_2023_rich/d03_weather_aligned_to_processed_d03_2023_ml95_2023.npy",
                "weather_csv": "Caltrans_2023_D03/weather_d03_2023_rich/d03_weather_hourly_mean_2023.csv",
                "accident_dir": "Caltrans_2023_D03/processed_d03_accident_train_2023"
            },
            "model": {
                "baseline": {"checkpoint": "runs_d03/d03_baseline_pure_st/best.pt"},
                "correction": {"checkpoint": "runs_d03/correction_model/correction_model.pt"}
            }
        }
    else:
        with open(config_path, 'r') as f:
            config = json.load(f)
        print(f"{GREEN}{OK} Configuration loaded: {config_path}{RESET}\n")

    # Check data directories
    print(f"{BLUE}[1] Data Directories{RESET}")
    traffic_dir = config["data_paths"]["traffic_dir"]
    all_ok &= check_dir(traffic_dir, "Traffic data directory")

    # Check traffic files
    print(f"\n{BLUE}[2] Traffic Data Files{RESET}")
    traffic_files = [
        ("flow.npy", "Flow data"),
        ("occupancy.npy", "Occupancy data"),
        ("speed.npy", "Speed data"),
        ("timestamps.npy", "Timestamps"),
        ("station_metadata.csv", "Station metadata"),
        ("adj_mx.npy", "Graph adjacency"),
    ]

    for filename, desc in traffic_files:
        path = os.path.join(traffic_dir, filename)
        if check_file(path, desc):
            if filename.endswith('.npy') and filename != 'timestamps.npy':
                check_numpy_shape(path)
        else:
            all_ok = False

    # Check weather files
    print(f"\n{BLUE}[3] Weather Data Files{RESET}")
    weather_npy = config["data_paths"]["weather_npy"]
    weather_csv = config["data_paths"]["weather_csv"]

    if check_file(weather_npy, "Weather NPY"):
        check_numpy_shape(weather_npy)
    else:
        all_ok = False

    if not check_file(weather_csv, "Weather CSV"):
        all_ok = False

    # Check accident data
    print(f"\n{BLUE}[4] Accident Data{RESET}")
    accident_dir = config["data_paths"]["accident_dir"]
    if check_dir(accident_dir, "Accident data directory"):
        feature_names_path = os.path.join(accident_dir, "feature_names.json")
        timestamps_path = os.path.join(accident_dir, "timestamps.npy")
        matrices_dir = os.path.join(accident_dir, "feature_matrices")

        check_file(feature_names_path, "Feature names")
        check_file(timestamps_path, "Accident timestamps")
        check_dir(matrices_dir, "Feature matrices")
    else:
        all_ok = False

    # Check model checkpoints
    print(f"\n{BLUE}[5] Model Checkpoints{RESET}")
    baseline_ckpt = config["model"]["baseline"]["checkpoint"]
    correction_ckpt = config["model"]["correction"]["checkpoint"]

    if check_file(baseline_ckpt, "Baseline model"):
        check_checkpoint(baseline_ckpt)
    else:
        all_ok = False
        print(f"  {YELLOW}→ Train with: python train_d03_baseline.py{RESET}")

    if check_file(correction_ckpt, "Correction model"):
        check_checkpoint(correction_ckpt)
    else:
        all_ok = False
        print(f"  {YELLOW}→ Train with: python train_d03_correction.py{RESET}")

    # Check frontend config
    print(f"\n{BLUE}[6] Frontend Configuration{RESET}")
    frontend_env = "frontend/.env"
    frontend_env_d03 = "frontend/.env.d03"

    if check_file(frontend_env_d03, "Frontend D03 template"):
        if not os.path.exists(frontend_env):
            print(f"  {YELLOW}{WARN}{RESET}  .env not found, copy from .env.d03 if you want explicit env vars:")
            print(f"  {YELLOW}-> {copy_env_hint('frontend/.env.d03', 'frontend/.env')}{RESET}")
        else:
            print(f"  {GREEN}{OK}{RESET} Frontend .env exists")
    else:
        all_ok = False

    # Check Python dependencies
    print(f"\n{BLUE}[7] Python Dependencies{RESET}")
    required_packages = [
        "torch",
        "numpy",
        "pandas",
        "scipy",
        "scikit-learn",
        "tqdm"
    ]

    missing_packages = []
    for pkg in required_packages:
        try:
            import_name = PKG_IMPORT_NAMES.get(pkg, pkg)
            __import__(import_name)
            print(f"{GREEN}{OK}{RESET} {pkg}")
        except ImportError:
            print(f"{RED}{FAIL}{RESET} {pkg} {RED}NOT INSTALLED{RESET}")
            missing_packages.append(pkg)
            all_ok = False

    if missing_packages:
        print(f"\n  {YELLOW}→ Install missing packages:{RESET}")
        print(f"  {YELLOW}pip install {' '.join(missing_packages)}{RESET}")

    # Summary
    print(f"\n{BLUE}{'='*60}{RESET}")
    if all_ok:
        print(f"{GREEN}{OK} All checks passed! Ready to deploy D03 system.{RESET}")
        print(f"\n{BLUE}Next steps:{RESET}")
        print(f"  1. Start backend: ./start_d03_server.sh (or .ps1 on Windows)")
        print(f"  2. Start frontend: cd frontend && npm install && npm run dev")
        print(f"  3. Open browser: http://localhost:5173")
    else:
        print(f"{RED}{FAIL} Some checks failed. Please fix the issues above.{RESET}")
        sys.exit(1)
    print(f"{BLUE}{'='*60}{RESET}\n")


if __name__ == "__main__":
    main()
