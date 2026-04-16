# Caltrans D03 2023 Multi-Task Forecasting Server Launcher (PowerShell)
# Sacramento Region (743 sensors)

$ErrorActionPreference = "Stop"

# D03 Dataset Paths
$TRAFFIC_DIR = "Caltrans_2023_D03/processed_d03_2023_ml95_enriched"
$WEATHER_NPY = "Caltrans_2023_D03/weather_d03_2023_rich/d03_weather_aligned_to_processed_d03_2023_ml95_2023.npy"
$WEATHER_CSV = "Caltrans_2023_D03/weather_d03_2023_rich/d03_weather_hourly_mean_2023.csv"
$BASELINE_CKPT = "runs_d03/d03_baseline_pure_st/best.pt"
$CORRECTION_CKPT = "runs_d03/correction_model/correction_model.pt"

# Server Configuration
$SERVER_HOST = "127.0.0.1"
$PORT = 8010
$DEVICE = "cuda"  # or "cpu"
$START_INDEX = 288  # Start at 1 day in (288 * 5min = 1 day)
$TICK_SECONDS = 10  # Simulation speed: 10s real time = 5min sim time

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Caltrans D03 Pipeline Server" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Dataset: Sacramento 2023 (D03)"
Write-Host "Sensors: 743"
Write-Host "Model: HeteroDiffusionGraphForecaster + WeatherCorrectionNet"
Write-Host "Endpoint: http://${SERVER_HOST}:${PORT}/api/forecast?sensor=0"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if required files exist
if (-not (Test-Path $TRAFFIC_DIR)) {
    Write-Host "ERROR: Traffic directory not found: $TRAFFIC_DIR" -ForegroundColor Red
    Write-Host "Please ensure D03 dataset is downloaded and processed."
    exit 1
}

if (-not (Test-Path $WEATHER_NPY)) {
    Write-Host "ERROR: Weather NPY not found: $WEATHER_NPY" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $BASELINE_CKPT)) {
    Write-Host "ERROR: Baseline checkpoint not found: $BASELINE_CKPT" -ForegroundColor Red
    Write-Host "Please train the baseline model first: python train_d03_baseline.py"
    exit 1
}

if (-not (Test-Path $CORRECTION_CKPT)) {
    Write-Host "ERROR: Correction checkpoint not found: $CORRECTION_CKPT" -ForegroundColor Red
    Write-Host "Please train the correction model first: python train_d03_correction.py"
    exit 1
}

# Launch server
python backend/server_d03_pipeline.py `
    --host $SERVER_HOST `
    --port $PORT `
    --traffic-dir $TRAFFIC_DIR `
    --weather-npy $WEATHER_NPY `
    --weather-csv $WEATHER_CSV `
    --ckpt $BASELINE_CKPT `
    --correction-ckpt $CORRECTION_CKPT `
    --device $DEVICE `
    --start-index $START_INDEX `
    --tick-seconds $TICK_SECONDS
