#!/bin/bash
# Caltrans D03 2023 Multi-Task Forecasting Server Launcher
# Sacramento Region (743 sensors)

set -e

# D03 Dataset Paths
TRAFFIC_DIR="Caltrans_2023_D03/processed_d03_2023_ml95_enriched"
WEATHER_NPY="Caltrans_2023_D03/weather_d03_2023_rich/d03_weather_aligned_to_processed_d03_2023_ml95_2023.npy"
WEATHER_CSV="Caltrans_2023_D03/weather_d03_2023_rich/d03_weather_hourly_mean_2023.csv"
BASELINE_CKPT="runs_d03/d03_baseline_pure_st/best.pt"
CORRECTION_CKPT="runs_d03/correction_model/correction_model.pt"

# Server Configuration
HOST="127.0.0.1"
PORT=8010
DEVICE="cuda"  # or "cpu"
START_INDEX=288  # Start at 1 day in (288 * 5min = 1 day)
TICK_SECONDS=10  # Simulation speed: 10s real time = 5min sim time

echo "=========================================="
echo "  Caltrans D03 Pipeline Server"
echo "=========================================="
echo "Dataset: Sacramento 2023 (D03)"
echo "Sensors: 743"
echo "Model: HeteroDiffusionGraphForecaster + WeatherCorrectionNet"
echo "Endpoint: http://${HOST}:${PORT}/api/forecast?sensor=0"
echo "=========================================="
echo ""

# Check if required files exist
if [ ! -d "$TRAFFIC_DIR" ]; then
    echo "ERROR: Traffic directory not found: $TRAFFIC_DIR"
    echo "Please ensure D03 dataset is downloaded and processed."
    exit 1
fi

if [ ! -f "$WEATHER_NPY" ]; then
    echo "ERROR: Weather NPY not found: $WEATHER_NPY"
    exit 1
fi

if [ ! -f "$BASELINE_CKPT" ]; then
    echo "ERROR: Baseline checkpoint not found: $BASELINE_CKPT"
    echo "Please train the baseline model first: python train_d03_baseline.py"
    exit 1
fi

if [ ! -f "$CORRECTION_CKPT" ]; then
    echo "ERROR: Correction checkpoint not found: $CORRECTION_CKPT"
    echo "Please train the correction model first: python train_d03_correction.py"
    exit 1
fi

# Launch server
python backend/server_d03_pipeline.py \
    --host "$HOST" \
    --port "$PORT" \
    --traffic-dir "$TRAFFIC_DIR" \
    --weather-npy "$WEATHER_NPY" \
    --weather-csv "$WEATHER_CSV" \
    --ckpt "$BASELINE_CKPT" \
    --correction-ckpt "$CORRECTION_CKPT" \
    --device "$DEVICE" \
    --start-index "$START_INDEX" \
    --tick-seconds "$TICK_SECONDS"
