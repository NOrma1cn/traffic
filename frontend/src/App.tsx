import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudLightning,
  Sun,
  Wind,
  Thermometer,
  Droplets,
  Eye,
  Percent,
} from 'lucide-react';
import { motion } from 'framer-motion';
import ForecastChart from './components/ForecastChart';
import BackgroundShader, { type SunnyDayPhase } from './components/BackgroundShader';
import LogoShader from './components/LogoShader';
import { NetworkSphereModal, type PanoramaMode } from './components/NetworkSphereModal';
import RiskDashboardHUD from './components/RiskDashboardHUD';
import HUDContainer from './components/HUDContainer';
import { type IncidentContext, type IncidentScenario } from './components/IncidentStatusPanel';
import WeatherTopologyRing, { type WeatherRingMetric } from './components/WeatherTopologyRing';
import { deriveWeatherVisual } from './weather';
import { useDesignViewport } from './hooks/useDesignViewport';

const DEFAULT_POLL_MS = import.meta.env.DEV ? 3_000 : 300_000;
const POLL_MS = Number(import.meta.env.VITE_POLL_MS ?? DEFAULT_POLL_MS);
const ENV_API_BASE = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
const DESIRED_MODE = 'multitask_occ_primary_weather_attn';
const DESIGN_WIDTH = 2560;
const DESIGN_HEIGHT = 1600;
const LED_WEATHER_RING_CENTER_X = '58%';
const LED_WEATHER_RING_CENTER_Y = '50%';
const LED_WEATHER_RING_SCALE = 2.07;

const normalizeBase = (base: string) => String(base ?? '').replace(/\/+$/, '');
const apiUrlWithBase = (base: string, path: string) => `${normalizeBase(base)}${path.startsWith('/') ? path : `/${path}`}`;
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
const KMH_PER_MPH = 1.60934;
const MM_PER_INCH = 25.4;
const DAY_START_SLOT = 0;
const DAYS_IN_MONTH_2023 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const clampMonth = (month: number) => Math.max(1, Math.min(12, Math.floor(month)));
const clampDay = (month: number, day: number) => {
  const max = DAYS_IN_MONTH_2023[clampMonth(month) - 1] ?? 31;
  return Math.max(1, Math.min(max, Math.floor(day)));
};

const tObsToMonthDay = (tObs: number): { month: number; day: number } => {
  const dayOfYear = Math.max(0, Math.floor(tObs / 288));
  let remain = dayOfYear;
  for (let m = 1; m <= 12; m++) {
    const len = DAYS_IN_MONTH_2023[m - 1];
    if (remain < len) return { month: m, day: remain + 1 };
    remain -= len;
  }
  return { month: 12, day: 31 };
};

const monthDayToTObs = (month: number, day: number, slot: number, maxTimeIndex: number): number => {
  const m = clampMonth(month);
  const d = clampDay(m, day);
  const dayBefore = DAYS_IN_MONTH_2023.slice(0, m - 1).reduce((acc, v) => acc + v, 0);
  const idx = dayBefore * 288 + (d - 1) * 288 + Math.max(0, Math.min(287, Math.floor(slot)));
  return Math.max(0, Math.min(Math.max(0, maxTimeIndex), idx));
};

type WeatherPresetKey = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
type WeatherOverride = Partial<{
  temp: number;
  humidity: number;
  precip: number;
  windspeed: number;
  cloudcover: number;
  visibility: number;
}>;

type MetricKey = 'risk' | 'speed' | 'occupancy' | 'flow';

type WeatherPacket = {
  datetime: string;
  condition: string;
  temp_c: number;
  humidity: number;
  wind_kmh: number;
  wind_dir_deg?: number;
  wind_dir_cardinal?: string;
  precip_mm: number;
  cloudcover: number;
  visibility_km: number;
  precipitation_pct: number;
  step_index?: number;
  month_index?: number;
  calendar_month?: number;
};

type WindowPacket = {
  step: number;
  minutes_ahead: number;
  datetime: string;
  flow_veh_5min: number;
  occupancy_ratio: number;
  occupancy_pct: number;
  speed_mph: number;
  speed_kmh: number;
  congestion_score: number;
  congestion_probability: number;
  congestion_level: 'low' | 'medium' | 'high' | 'severe';
  baseline_flow_veh_5min: number;
  baseline_occupancy_pct: number;
  baseline_speed_kmh: number;
  delta_vs_now: {
    flow_veh_5min: number;
    occupancy_pct: number;
    speed_kmh: number;
  };
  components: {
    occupancy: number;
    flow: number;
    speed: number;
    pressure: number;
  };
};

type ApiResponse = {
  meta: {
    dataset: string;
    mode: string;
    t_obs: number;
    sensor: number;
    n_sensors: number;
    in_len: number;
    out_horizon: number;
    tick_seconds: number;
    sim_time: string;
    t_obs_source?: 'clock' | 'override';
    counterfactual_weather?: boolean;
  };
  dataset_context?: {
    time_steps?: number;
  };
  station: {
    id: string;
    freeway: string;
    direction: string;
    lane_type: string;
    coverage_ratio: number;
    station_length_mi: number;
  };
  current_weather: WeatherPacket;
  weather: WeatherPacket[];
  weather_transition: {
    active: boolean;
    event_type: 'rain' | 'fog' | 'wind' | 'cloud' | 'stable';
    title: string;
    summary: string;
    eta_min: number | null;
    current_condition: string;
    incoming_condition: string;
  };
  current: {
    flow_veh_5min: number;
    occupancy_ratio: number;
    occupancy_pct: number;
    speed_mph: number;
    speed_kmh: number;
    flow_1h_ago_veh_5min: number;
    occupancy_1h_ago_pct: number;
    speed_1h_ago_kmh: number;
    baseline_flow_veh_5min: number;
    baseline_occupancy_pct: number;
    baseline_speed_kmh: number;
    congestion_score: number;
    congestion_probability: number;
    congestion_level: 'low' | 'medium' | 'high' | 'severe';
    components: {
      occupancy: number;
      flow: number;
      speed: number;
      pressure: number;
    };
  };
  prediction_windows: {
    h1: WindowPacket;
    h6: WindowPacket;
    h12: WindowPacket;
  };
  prediction_series: {
    times: string[];
    flow_veh_5min: number[];
    occupancy_pct: number[];
    speed_kmh: number[];
    risk_score: number[];
    congestion_probability: number[];
    risk_level: Array<'low' | 'medium' | 'high' | 'severe'>;
  };
  history_tail: {
    times: string[];
    flow_veh_5min: number[];
    occupancy_pct: number[];
    speed_kmh: number[];
    risk_score: number[];
    congestion_probability: number[];
  };
  confidence: {
    score: number;
    label: 'low' | 'medium' | 'high';
    summary: string;
    reasons: string[];
    evidence: {
      signal_strength: number;
      agreement_score: number;
      stability_score: number;
      data_score: number;
      horizon_bonus: number;
    };
  };
  scenario_predictions: Array<{
    key: string;
    label: string;
    description: string;
    flow_veh_5min: number;
    occupancy_pct: number;
    speed_kmh: number;
    delta_speed_kmh: number;
    delta_occupancy_pct: number;
    congestion_score: number;
    congestion_probability?: number;
    congestion_level: 'low' | 'medium' | 'high' | 'severe';
  }>;
  accidents?: IncidentContext;
  incident_scenarios?: IncidentScenario[];
  congestion_summary: {
    current_level: 'low' | 'medium' | 'high' | 'severe';
    current_score?: number;
    current_probability?: number;
    peak_window: 'h1' | 'h6' | 'h12';
    peak_minutes_ahead: number;
    peak_level: 'low' | 'medium' | 'high' | 'severe';
    peak_score: number;
    peak_probability?: number;
    headline: string;
  };
  global_state: {
    current_levels?: number[];
    current_scores?: number[];
    pred_levels: number[];
    pred_scores: number[];
  };
};

const WEATHER_PRESETS: Array<{ key: WeatherPresetKey; label: string; desc: string }> = [
  { key: 'clear', label: '晴朗', desc: '低湿度、低云量、高能见度' },
  { key: 'cloudy', label: '阴天', desc: '高云量、轻微扰动' },
  { key: 'rain', label: '降雨', desc: '中雨工况，能见度下降' },
  { key: 'storm', label: '暴雨', desc: '强降雨+大风，极端天气' },
  { key: 'fog', label: '大雾', desc: '高湿低能见度' },
];

const WEATHER_PRESET_COLORS: Record<WeatherPresetKey, string> = {
  clear: '#fbbf24',
  cloudy: '#94a3b8',
  rain: '#38bdf8',
  storm: '#a78bfa',
  fog: '#67e8f9',
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const rangeProgress = (
  value: number,
  samples: number[],
  options: { floor?: number; ceiling?: number; minSpan?: number; fallbackRange?: [number, number] } = {},
) => {
  const finiteSamples = samples.filter(Number.isFinite);
  if (!Number.isFinite(value)) return 0;
  let min = finiteSamples.length ? Math.min(...finiteSamples) : options.fallbackRange?.[0] ?? 0;
  let max = finiteSamples.length ? Math.max(...finiteSamples) : options.fallbackRange?.[1] ?? 1;

  if (options.floor !== undefined) min = Math.min(min, options.floor);
  if (options.ceiling !== undefined) max = Math.max(max, options.ceiling);

  if (options.minSpan !== undefined && max - min < options.minSpan) {
    if (options.fallbackRange) {
      [min, max] = options.fallbackRange;
    } else {
      const middle = (min + max) / 2;
      min = middle - options.minSpan / 2;
      max = middle + options.minSpan / 2;
    }
  }

  if (max <= min) return 0;
  return clamp01((value - min) / (max - min));
};

const resolveCalendarMonth = (packet: WeatherPacket | null | undefined): number | null => {
  if (!packet) return null;
  const calendarMonth = Number(packet.calendar_month);
  if (Number.isFinite(calendarMonth) && calendarMonth >= 1 && calendarMonth <= 12) return calendarMonth;
  const offsetMonth = Number(packet.month_index);
  if (Number.isFinite(offsetMonth) && offsetMonth >= 0 && offsetMonth <= 11) return offsetMonth + 1;
  const parsed = new Date(packet.datetime);
  if (!Number.isNaN(parsed.getTime())) return parsed.getMonth() + 1;
  return null;
};

const normalizePanoramaWeather = (
  weather: WeatherPacket[] | null | undefined,
  fallbackWeather?: WeatherPacket[] | null,
): WeatherPacket[] => {
  const source = Array.isArray(weather) ? weather : [];
  const fallbackSource = Array.isArray(fallbackWeather) ? fallbackWeather : [];
  const fallbackPacket = source[0] ?? fallbackSource[0] ?? null;
  if (!fallbackPacket) return [];

  const normalized = Array.from({ length: 12 }, (_, idx) => {
    const prev = fallbackSource[idx];
    return prev
      ? { ...prev, calendar_month: idx + 1, month_index: idx }
      : { ...fallbackPacket, calendar_month: idx + 1, month_index: idx };
  });

  source.forEach((packet) => {
    const month = resolveCalendarMonth(packet);
    if (!month) return;
    normalized[month - 1] = { ...packet, calendar_month: month, month_index: month - 1 };
  });

  return normalized;
};

const withNormalizedPanoramaWeather = (response: ApiResponse, fallbackWeather?: WeatherPacket[] | null): ApiResponse => ({
  ...response,
  weather: normalizePanoramaWeather(response.weather, fallbackWeather),
});

type HealthResponse = {
  ok: boolean;
  status?: {
    dataset: string;
    mode: string;
    shape: number[];
    ckpt: string;
    device: string;
    in_len: number;
    out_horizon: number;
    tick_seconds: number;
  };
};

const isValidApiResponse = (data: any): data is ApiResponse =>
  Boolean(
    data &&
      data.meta &&
      data.meta.mode === DESIRED_MODE &&
      data.history_tail &&
      Array.isArray(data.history_tail.times) &&
      data.prediction_series &&
      Array.isArray(data.prediction_series.times) &&
      data.prediction_windows?.h1 &&
      data.prediction_windows?.h6 &&
      data.prediction_windows?.h12,
  );

const levelLabel = (level: string) => {
  switch (level) {
    case 'severe': return '极高风险';
    case 'high': return '高风险';
    case 'medium': return '中风险';
    default: return '低风险';
  }
};

const App: React.FC = () => {
  const [sensor, setSensor] = useState<number>(42);
  const [nSensors, setNSensors] = useState<number>(743);
  const [apiBase, setApiBase] = useState<string>(ENV_API_BASE);
  const [api, setApi] = useState<ApiResponse | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState<boolean>(false);
  const [bootPhase, setBootPhase] = useState<'checking' | 'transition' | 'ready' | 'error'>('checking');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number }>(() => ({
    w: typeof window === 'undefined' ? 1024 : window.innerWidth,
    h: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));
  const [isSphereOpen, setIsSphereOpen] = useState<boolean>(false);
  const [panoramaMode, setPanoramaMode] = useState<PanoramaMode>('congestion');
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('risk');
  const [weatherPreset, setWeatherPreset] = useState<WeatherPresetKey>('rain');
  const [weatherOverrideEnabled, setWeatherOverrideEnabled] = useState<boolean>(false);
  const [customApi, setCustomApi] = useState<ApiResponse | null>(null);
  const [spherePreview, setSpherePreview] = useState<{ sensor: number; tObs: number } | null>(null);
  const [spherePreviewApi, setSpherePreviewApi] = useState<ApiResponse | null>(null);
  const [sphereDateSelection, setSphereDateSelection] = useState<{ month: number; day: number } | null>(null);
  const [selectedTObsOverride, setSelectedTObsOverride] = useState<number | null>(null);
  const [backgroundLedMode, setBackgroundLedMode] = useState(false);
  const designViewport = useDesignViewport(viewport.w, viewport.h, DESIGN_WIDTH, DESIGN_HEIGHT);

  const abortRef = useRef<AbortController | null>(null);
  const customAbortRef = useRef<AbortController | null>(null);
  const spherePreviewAbortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef<boolean>(false);
  const mainRequestKeyRef = useRef<string | null>(null);
  const spherePreviewRequestKeyRef = useRef<string | null>(null);
  const selectedTObsOverrideRef = useRef<number | null>(null);
  const datasetTimeStepCount = Math.max(1, Math.floor(api?.dataset_context?.time_steps ?? 1));

  const setManualTObsOverride = (value: number | null) => {
    const next = Number.isFinite(value)
      ? ((Math.floor(Number(value)) % datasetTimeStepCount) + datasetTimeStepCount) % datasetTimeStepCount
      : null;
    selectedTObsOverrideRef.current = next;
    setSelectedTObsOverride(next);
  };

  const advanceManualTObsOverride = () => {
    const current = selectedTObsOverrideRef.current;
    if (current === null) return undefined;
    const next = (Math.floor(current) + 1) % datasetTimeStepCount;
    selectedTObsOverrideRef.current = next;
    return next;
  };

  const toBackendWeatherOverride = (ui: {
    temp_c: number;
    humidity: number;
    precip_mm: number;
    wind_kmh: number;
    cloudcover: number;
    visibility_km: number;
  }): WeatherOverride => ({
    temp: ui.temp_c * 9.0 / 5.0 + 32.0,
    humidity: ui.humidity,
    precip: ui.precip_mm / MM_PER_INCH,
    windspeed: ui.wind_kmh / KMH_PER_MPH,
    cloudcover: ui.cloudcover,
    visibility: ui.visibility_km / KMH_PER_MPH,
  });

  const buildPresetOverride = (preset: WeatherPresetKey, cw: WeatherPacket): WeatherOverride => {
    const baseline = toBackendWeatherOverride({
      temp_c: cw.temp_c,
      humidity: cw.humidity,
      precip_mm: cw.precip_mm,
      wind_kmh: cw.wind_kmh,
      cloudcover: cw.cloudcover,
      visibility_km: cw.visibility_km,
    });
    switch (preset) {
      case 'clear':
        return { ...baseline, precip: 0, cloudcover: 12, humidity: 35, windspeed: 5, visibility: 10 };
      case 'cloudy':
        return { ...baseline, precip: 0.01, cloudcover: 90, humidity: 65, windspeed: 8, visibility: 7 };
      case 'rain':
        return { ...baseline, precip: 0.10, cloudcover: 94, humidity: 86, windspeed: 12, visibility: 3.2 };
      case 'storm':
        return { ...baseline, precip: 0.22, cloudcover: 98, humidity: 94, windspeed: 26, visibility: 1.4 };
      case 'fog':
        return { ...baseline, precip: 0.01, cloudcover: 72, humidity: 97, windspeed: 4, visibility: 0.8 };
      default:
        return baseline;
    }
  };

  const activeWeatherOverride = useMemo<WeatherOverride | null>(() => {
    if (!weatherOverrideEnabled || !api?.current_weather) return null;
    return buildPresetOverride(weatherPreset, api.current_weather);
  }, [weatherOverrideEnabled, weatherPreset, api?.current_weather]);

  const buildForecastUrl = (
    base: string,
    sensorId: number,
    opts?: { tObs?: number; weatherOverride?: WeatherOverride },
  ) => {
    const query = new URLSearchParams();
    query.set('sensor', String(sensorId));
    if (opts?.tObs !== undefined && opts?.tObs !== null && Number.isFinite(opts.tObs)) {
      query.set('t_obs', String(Math.floor(opts.tObs)));
    }
    if (opts?.weatherOverride) {
      Object.entries(opts.weatherOverride).forEach(([k, v]) => {
        if (v === undefined || v === null || !Number.isFinite(v)) return;
        query.set(`wx_${k}`, String(v));
      });
    }
    return apiUrlWithBase(base, `/api/forecast?${query.toString()}`);
  };

  const fetchForecastRequest = async (
    sensorId: number,
    base: string,
    opts?: { tObs?: number; weatherOverride?: WeatherOverride; signal?: AbortSignal },
  ): Promise<ApiResponse> => {
    const res = await fetch(buildForecastUrl(base, sensorId, opts), { signal: opts?.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!isValidApiResponse(j)) {
      throw new Error('Connected backend is not the new Caltrans multitask API');
    }
    return j;
  };

  const fetchForecastOnce = async (
    s?: number,
    base?: string,
    opts?: { abortPrev?: boolean; tObs?: number; weatherOverride?: WeatherOverride },
  ): Promise<ApiResponse | null> => {
    const ss = s ?? sensor;
    const resolvedBase = base ?? apiBase;
    const requestKey = buildForecastUrl(resolvedBase, ss, {
      tObs: opts?.tObs,
      weatherOverride: opts?.weatherOverride,
    });
    const abortPrev = opts?.abortPrev !== false;
    if (mainRequestKeyRef.current === requestKey) return null;
    if (!abortPrev && loadingRef.current) return null;
    if (abortPrev && abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    mainRequestKeyRef.current = requestKey;
    loadingRef.current = true;
    setApiLoading(true);
    setApiError(null);
    try {
      const j = await fetchForecastRequest(ss, resolvedBase, {
        tObs: opts?.tObs,
        weatherOverride: opts?.weatherOverride,
        signal: ctrl.signal,
      });
      const normalized = withNormalizedPanoramaWeather(j, api?.weather);
      setApi(normalized);
      if (normalized.meta?.n_sensors) setNSensors(normalized.meta.n_sensors);
      return normalized;
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setApiError(String(e?.message ?? e));
        throw e;
      }
      throw e;
    } finally {
      if (mainRequestKeyRef.current === requestKey) {
        mainRequestKeyRef.current = null;
      }
      loadingRef.current = false;
      setApiLoading(false);
    }
  };

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      abortRef.current?.abort();
      customAbortRef.current?.abort();
      spherePreviewAbortRef.current?.abort();
    };
  }, []);

  const checkHealthAt = async (base: string): Promise<HealthResponse> => {
    const ctrl = new AbortController();
    const id = window.setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(apiUrlWithBase(base, '/api/health'), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as HealthResponse;
      if (!j?.ok || j?.status?.mode !== DESIRED_MODE) {
        throw new Error(`health check failed: expected ${DESIRED_MODE}, got ${String(j?.status?.mode ?? 'unknown')}`);
      }
      setHealth(j);
      return j;
    } finally {
      window.clearTimeout(id);
    }
  };

  const bootstrap = async () => {
    setBootPhase('checking');
    setBootError(null);
    try {
      const candidates = Array.from(new Set([apiBase, '', 'http://127.0.0.1:8010', 'http://localhost:8010', 'http://127.0.0.1:8000', 'http://localhost:8000'].map(normalizeBase)));
      const deadline = Date.now() + 60_000;
      let lastErr: unknown = null;
      while (Date.now() < deadline) {
        for (const base of candidates) {
          try {
            await checkHealthAt(base);
            await fetchForecastOnce(sensor, base);
            if (base !== apiBase) setApiBase(base);
            setBootPhase('transition');
            return;
          } catch (e) { lastErr = e; }
        }
        await sleep(900);
      }
      throw lastErr ?? new Error('bootstrap timed out');
    } catch (e: any) {
      setBootError(String(e?.message ?? e));
      setBootPhase('error');
    }
  };

  useEffect(() => { bootstrap(); }, []);

  useEffect(() => {
    if (bootPhase === 'transition') {
      const timer = setTimeout(() => setBootPhase('ready'), 1500);
      return () => clearTimeout(timer);
    }
  }, [bootPhase]);

  useEffect(() => {
    if (bootPhase !== 'ready') return;
    const fetchGraph = async () => {
      try {
        const url = apiUrlWithBase(apiBase, '/api/graph_structure');
        const res = await fetch(url);
        const data = await res.json();
        if (data?.nodes && data.nodes.length > 0) setGraphData(data);
      } catch (err) { console.error('[App] Failed to fetch graph topology:', err); }
    };
    fetchGraph();
  }, [apiBase, bootPhase]);

  useEffect(() => {
    if (bootPhase !== 'ready' || isSphereOpen) return;
    fetchForecastOnce(sensor, undefined, {
      tObs: selectedTObsOverrideRef.current ?? undefined,
    }).catch(() => {});
  }, [sensor, bootPhase, apiBase, isSphereOpen, selectedTObsOverride]);

  useEffect(() => {
    if (bootPhase !== 'ready' || isSphereOpen) return;
    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        await sleep(Number.isFinite(POLL_MS) ? POLL_MS : 3000);
        if (cancelled) return;
        const nextManualTObs = advanceManualTObsOverride();
        await fetchForecastOnce(undefined, undefined, {
          abortPrev: false,
          tObs: nextManualTObs,
        }).catch(() => {});
      }
    };
    loop();
    return () => { cancelled = true; };
  }, [bootPhase, apiBase, sensor, isSphereOpen, selectedTObsOverride]);

  useEffect(() => {
    if (bootPhase !== 'ready' || !api || !weatherOverrideEnabled || !activeWeatherOverride) {
      setCustomApi(null);
      customAbortRef.current?.abort();
      return;
    }
    customAbortRef.current?.abort();
    const ctrl = new AbortController();
    customAbortRef.current = ctrl;
    fetchForecastRequest(sensor, apiBase, {
      tObs: api.meta.t_obs,
      weatherOverride: activeWeatherOverride,
      signal: ctrl.signal,
    })
      .then((j) => {
        setCustomApi(withNormalizedPanoramaWeather(j, customApi?.weather ?? api?.weather));
      })
      .catch((e: any) => {
        if (e?.name === 'AbortError') return;
        console.error('[App] Failed to fetch simulated weather branch:', e);
      });
    return () => ctrl.abort();
  }, [bootPhase, apiBase, api, sensor, weatherOverrideEnabled, activeWeatherOverride]);

  useEffect(() => {
    if (!isSphereOpen || !api) return;
    const initialDate = sphereDateSelection ?? tObsToMonthDay(api.meta.t_obs);
    const maxTimeIndex = (api.dataset_context?.time_steps ?? 1) - 1;
    const tObs = monthDayToTObs(initialDate.month, initialDate.day, DAY_START_SLOT, maxTimeIndex);
    setSphereDateSelection(initialDate);
    setSpherePreview((prev) => prev ?? { sensor, tObs });
  }, [isSphereOpen, api, sensor]);

  useEffect(() => {
    if (!isSphereOpen || !api || !sphereDateSelection) return;
    const maxTimeIndex = (api.dataset_context?.time_steps ?? 1) - 1;
    const tObs = monthDayToTObs(sphereDateSelection.month, sphereDateSelection.day, DAY_START_SLOT, maxTimeIndex);
    setSpherePreview((prev) => {
      const nextSensor = prev?.sensor ?? sensor;
      if (prev && prev.sensor === nextSensor && prev.tObs === tObs) return prev;
      return { sensor: nextSensor, tObs };
    });
  }, [isSphereOpen, api, sphereDateSelection?.month, sphereDateSelection?.day, sensor]);

  useEffect(() => {
    if (!isSphereOpen || !spherePreview) {
      spherePreviewAbortRef.current?.abort();
      spherePreviewRequestKeyRef.current = null;
      setSpherePreviewApi(null);
      return;
    }
    if (
      spherePreviewApi?.meta?.sensor === spherePreview.sensor &&
      spherePreviewApi?.meta?.t_obs === spherePreview.tObs
    ) {
      return;
    }
    const requestKey = buildForecastUrl(apiBase, spherePreview.sensor, { tObs: spherePreview.tObs });
    if (spherePreviewRequestKeyRef.current === requestKey) return;
    spherePreviewAbortRef.current?.abort();
    const ctrl = new AbortController();
    spherePreviewAbortRef.current = ctrl;
    spherePreviewRequestKeyRef.current = requestKey;
    fetchForecastRequest(spherePreview.sensor, apiBase, {
      tObs: spherePreview.tObs,
      signal: ctrl.signal,
    })
      .then((j) => {
        const simTime = new Date(j.meta?.sim_time ?? '');
        const selectedMonth = !Number.isNaN(simTime.getTime()) ? simTime.getMonth() + 1 : null;
        const normalizedWeather = selectedMonth && spherePreviewApi?.weather?.length
          ? (() => {
              const nextWeather = normalizePanoramaWeather(j.weather, spherePreviewApi.weather);
              const merged = normalizePanoramaWeather(spherePreviewApi.weather, spherePreviewApi.weather);
              merged[selectedMonth - 1] = nextWeather[selectedMonth - 1] ?? merged[selectedMonth - 1];
              return merged;
            })()
          : normalizePanoramaWeather(j.weather, spherePreviewApi?.weather);
        setSpherePreviewApi({
          ...j,
          weather: normalizedWeather,
        });
      })
      .catch((e) => {
        if ((e as any)?.name === 'AbortError') return;
        console.error('[App] Failed to fetch sphere preview:', e);
      })
      .finally(() => {
        if (spherePreviewRequestKeyRef.current === requestKey) {
          spherePreviewRequestKeyRef.current = null;
        }
      });
    return () => ctrl.abort();
  }, [isSphereOpen, spherePreview?.sensor, spherePreview?.tObs, spherePreviewApi?.meta?.sensor, spherePreviewApi?.meta?.t_obs, apiBase]);

  // LED mode transitions are handled by:
  // - WebGL shader: internal smoothing via u_transition
  // - UI mask: pure CSS opacity transition (GPU-friendly)

  const uiVisible = bootPhase === 'ready';
  const isBackgroundActive = !isSphereOpen;
  const dashboardChromeVisible = uiVisible && !isSphereOpen;
  const weatherVisual = deriveWeatherVisual(api?.current_weather);
  const sphereWeather = (isSphereOpen ? spherePreviewApi?.current_weather : undefined) ?? api?.current_weather;
  const sphereWeatherVisual = deriveWeatherVisual(sphereWeather);
  const congestionWarningLevel = api?.congestion_summary?.peak_level === 'severe' || api?.congestion_summary?.peak_level === 'high' ? 'high' : api?.congestion_summary?.peak_level === 'medium' ? 'medium' : 'low';
  const dayPhase = useMemo<SunnyDayPhase>(() => {
    if (!api?.meta?.sim_time) return 'noon';
    try {
      const date = new Date(api.meta.sim_time);
      if (isNaN(date.getTime())) return 'noon';
      const hour = date.getHours();
      if (hour >= 5 && hour < 9) return 'sunrise';
      if (hour >= 9 && hour < 17) return 'noon';
      if (hour >= 17 && hour < 20) return 'sunset';
      return 'midnight';
    } catch { return 'noon'; }
  }, [api?.meta?.sim_time]);

  const chartConfigs = useMemo(() => {
    if (!api) return {};
    const metrics: MetricKey[] = ['risk', 'speed', 'flow', 'occupancy'];
    const configs: Record<MetricKey, any> = {} as Record<MetricKey, any>;

    metrics.forEach(m => {
      const historyTimes = api.history_tail.times;
      const predTimes = api.prediction_series.times;
      let observed: number[] = [];
      let predicted: number[] = [];
      let branchPredicted: number[] | undefined;
      let referenceValue: number | undefined;
      let metricLabel = '';
      let unit = '';

      if (m === 'speed') {
        observed = api.history_tail.speed_kmh;
        predicted = api.prediction_series.speed_kmh;
        branchPredicted = customApi?.prediction_series?.speed_kmh;
        referenceValue = api.current.baseline_speed_kmh;
        metricLabel = '速度监控';
        unit = 'km/h';
      } else if (m === 'occupancy') {
        observed = api.history_tail.occupancy_pct;
        predicted = api.prediction_series.occupancy_pct;
        branchPredicted = customApi?.prediction_series?.occupancy_pct;
        referenceValue = api.current.baseline_occupancy_pct;
        metricLabel = '路段占有率';
        unit = '%';
      } else if (m === 'flow') {
        observed = api.history_tail.flow_veh_5min;
        predicted = api.prediction_series.flow_veh_5min;
        branchPredicted = customApi?.prediction_series?.flow_veh_5min;
        referenceValue = api.current.baseline_flow_veh_5min;
        metricLabel = '实时流量';
        unit = 'veh/5m';
      } else {
        observed = api.history_tail.risk_score.map((v) => v * 100);
        predicted = api.prediction_series.risk_score.map((v) => v * 100);
        branchPredicted = customApi?.prediction_series?.risk_score?.map((v) => v * 100);
        referenceValue = 60;
        metricLabel = '拥堵程度';
        unit = '%';
      }

      const lastObserved = observed[observed.length - 1] ?? null;
      const historyData = historyTimes.map((time, idx) => ({ time, observed: observed[idx] ?? null, predicted: idx === historyTimes.length - 1 ? lastObserved : null }));
      const predData = predTimes.map((time, idx) => ({ time, observed: null, predicted: predicted[idx] ?? null }));
      const data = [...historyData, ...predData];

      // Unified Dynamic Limit Calculation (Sync with ForecastChart logic)
      const allY = [...observed, ...predicted, ...(branchPredicted ?? [])];
      const rawMin = Math.min(...allY, referenceValue ?? Infinity);
      const rawMax = Math.max(...allY, referenceValue ?? -Infinity);
      const limit = rawMax + ((rawMax - rawMin) * 0.2 || 1);

      configs[m] = {
        data,
        referenceValue,
        metricLabel,
        unit,
        limit,
        branchPredicted: weatherOverrideEnabled ? branchPredicted : undefined,
      };
    });
    return configs;
  }, [api, customApi, weatherOverrideEnabled]);

  const predictionStartIdx = api ? Math.max(api.history_tail.times.length - 1, 0) : 0;
  const activeChart = chartConfigs[selectedMetric];

  const weatherRingData = useMemo(() => {
    if (!api?.current_weather) return null;
    const cw = api.current_weather;
    const annualWeather = api.weather?.length ? api.weather : [cw];
    const fromAnnualRange = (
      value: number,
      selector: (packet: WeatherPacket) => number,
      options?: Parameters<typeof rangeProgress>[2],
    ) => (
      rangeProgress(value, annualWeather.map(selector), options)
    );
    const metrics: WeatherRingMetric[] = [
      { id: 'w_temp', color: '#ef4444', icon: Thermometer, value: `${cw.temp_c.toFixed(1)}°C`, title: '环境温度', progress: fromAnnualRange(cw.temp_c, (packet) => packet.temp_c, { minSpan: 18, fallbackRange: [-5, 45] }) },
      { id: 'w_precip_prob', color: '#84cc16', icon: Percent, value: `${cw.precipitation_pct.toFixed(0)}%`, title: '降水概率', progress: clamp01(cw.precipitation_pct / 100) },
      { id: 'w_precip', color: '#3b82f6', icon: CloudRain, value: `${cw.precip_mm.toFixed(2)} mm`, title: '降水强度', progress: fromAnnualRange(cw.precip_mm, (packet) => packet.precip_mm, { floor: 0, minSpan: 4, fallbackRange: [0, 10] }) },
      { id: 'w_hum', color: '#06b6d4', icon: Droplets, value: `${cw.humidity.toFixed(0)}%`, title: '相对湿度', progress: clamp01(cw.humidity / 100) },
      { id: 'w_vis', color: '#f59e0b', icon: Eye, value: `${cw.visibility_km.toFixed(1)} km`, title: '能见度', progress: fromAnnualRange(cw.visibility_km, (packet) => packet.visibility_km, { floor: 0, minSpan: 10, fallbackRange: [0, 20] }) },
      { id: 'w_cloud', color: '#6366f1', icon: Cloud, value: `${cw.cloudcover.toFixed(0)}%`, title: '云层遮蔽', progress: clamp01(cw.cloudcover / 100) },
      { id: 'w_wind', color: '#8b5cf6', icon: Wind, iconText: cw.wind_dir_cardinal?.toUpperCase(), value: `${cw.wind_kmh.toFixed(1)} km/h`, title: '实时风速', progress: fromAnnualRange(cw.wind_kmh, (packet) => packet.wind_kmh, { floor: 0, minSpan: 20, fallbackRange: [0, 80] }) },
    ];

    const centerIcon = (() => {
      switch (weatherVisual.displayCondition) {
        case 'Sunny': return Sun;
        case 'PartlyCloudy': return CloudSun;
        case 'Overcast': return Cloud;
        case 'Foggy': return CloudFog;
        case 'Drizzle': return CloudDrizzle;
        case 'Rainy': return CloudRain;
        case 'Stormy': return CloudLightning;
        case 'Windy': return Wind;
        default: return Sun;
      }
    })();

    const presetLabel = WEATHER_PRESETS.find((preset) => preset.key === weatherPreset)?.label ?? '天气模拟';
    const simulationIcon = (() => {
      switch (weatherPreset) {
      case 'clear':
          return Sun;
        case 'cloudy':
          return Cloud;
        case 'rain':
          return CloudRain;
        case 'storm':
          return CloudLightning;
        case 'fog':
          return CloudFog;
        default:
          return centerIcon;
      }
    })();

    return {
      metrics,
      defaultCenter: {
        color: weatherOverrideEnabled ? '#f8fafc' : '#ffffff',
        icon: weatherOverrideEnabled ? simulationIcon : centerIcon,
        value: weatherOverrideEnabled ? presetLabel : weatherVisual.label,
        title: weatherOverrideEnabled ? '模拟模式' : '今日概览',
      },
    };
  }, [api, weatherVisual, weatherOverrideEnabled, weatherPreset]);

  const toggleWeatherSimulation = () => {
    setWeatherOverrideEnabled((prev) => !prev);
  };

  const cycleWeatherPreset = (direction: 1 | -1) => {
    setWeatherOverrideEnabled(true);
    setWeatherPreset((prev) => {
      const currentIndex = WEATHER_PRESETS.findIndex((preset) => preset.key === prev);
      const nextIndex = currentIndex === -1
        ? 0
        : (currentIndex + direction + WEATHER_PRESETS.length) % WEATHER_PRESETS.length;
      return WEATHER_PRESETS[nextIndex].key;
    });
  };

  const selectWeatherPreset = (preset: string) => {
    if (!WEATHER_PRESETS.some((item) => item.key === preset)) return;
    setWeatherOverrideEnabled(true);
    setWeatherPreset(preset as WeatherPresetKey);
  };

  const ledWeatherRing = backgroundLedMode && weatherRingData ? (
    <WeatherTopologyRing
      metrics={weatherRingData.metrics}
      defaultCenter={weatherRingData.defaultCenter}
      modes={WEATHER_PRESETS.map((preset) => ({
        id: preset.key,
        label: preset.label,
        color: WEATHER_PRESET_COLORS[preset.key],
      }))}
      activeModeId={weatherOverrideEnabled ? weatherPreset : null}
      className="drop-shadow-[0_0_30px_rgba(255,255,255,0.08)]"
      onCenterClick={toggleWeatherSimulation}
      onCenterWheel={cycleWeatherPreset}
      onModeSelect={selectWeatherPreset}
    />
  ) : null;

  const openNetworkSphere = () => {
    setPanoramaMode('congestion');
    setIsSphereOpen(true);
  };

  return (
    <div
      className="min-h-screen bg-transparent text-white flex overflow-hidden relative"
      onContextMenu={(e) => {
        if (isSphereOpen || e.defaultPrevented) return;
        if (bootPhase !== 'ready') return;
        e.preventDefault();
        setBackgroundLedMode((prev) => !prev);
      }}
    >
      <BackgroundShader
        weatherCondition={weatherVisual.shaderCondition}
        precipitation={api?.current_weather?.precipitation_pct ?? 0}
        dayPhase={dayPhase}
        ledMode={backgroundLedMode}
        isActive={isBackgroundActive}
      />

      {/* Curved diagonal mask: left-bottom darkest in normal, right-bottom darkest in LED */}
      <div className="fixed inset-0 pointer-events-none z-[5]" style={{ display: isBackgroundActive ? 'block' : 'none' }}>
        <div
          className="absolute inset-0"
          style={{
            opacity: backgroundLedMode ? 0 : 1,
            transition: 'opacity 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
            willChange: 'opacity',
            background:
              'radial-gradient(ellipse 100% 100% at 100% 0%, transparent 34%, rgba(8, 8, 12, 0.68) 78%, #030305 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            opacity: backgroundLedMode ? 1 : 0,
            transition: 'opacity 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
            willChange: 'opacity',
            transform: 'scaleX(-1)',
            background:
              'radial-gradient(ellipse 100% 100% at 100% 0%, transparent 34%, rgba(8, 8, 12, 0.68) 78%, #030305 100%)',
          }}
        />
      </div>

      {bootPhase !== 'ready' && (
        <motion.div
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#0A0A0B]"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-12 relative">
            <div className="absolute inset-0 bg-cyan-500/20 blur-[60px] rounded-full animate-pulse-slow" />
            <LogoShader size={120} className="relative z-10" />
          </div>

          <div className="w-[520px] max-w-[90vw]">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-sky-400">系统启动序列</div>
              <div className="text-[10px] font-mono text-zinc-500">Caltrans 多任务解析 v2</div>
            </div>
            <div className="h-1 w-full bg-zinc-900/80 rounded-full overflow-hidden mb-6 border border-zinc-800/50">
              <motion.div className="h-full bg-sky-500 shadow-[0_0_12px_rgba(14,165,233,0.8)]" initial={{ width: '15%' }} animate={{ width: bootPhase === 'transition' ? '100%' : '48%' }} transition={{ duration: 0.8, ease: 'easeInOut' }} />
            </div>
            <div className="bg-[#121214]/60 border border-zinc-800/40 rounded-xl p-5 shadow-2xl font-mono text-xs text-zinc-300">
              {bootPhase === 'checking' && '正在连接 Caltrans 多任务后端...'}
              {bootPhase === 'transition' && '正在初始化数据可视化系统...'}
              {bootPhase === 'error' && <div className="text-rose-400">{bootError}</div>}
            </div>
          </div>
        </motion.div>
      )}
      <NetworkSphereModal
        isOpen={isSphereOpen} onClose={() => { setIsSphereOpen(false); setSpherePreview(null); setSpherePreviewApi(null); }}
        onSelectSensor={(idx, timeIndex) => {
          setManualTObsOverride(Number.isFinite(timeIndex) ? Math.floor(timeIndex) : null);
          setSensor(idx);
          setIsSphereOpen(false);
          setSpherePreview(null);
          setSpherePreviewApi(null);
        }}
        onToggleViewMode={() => setPanoramaMode((p) => p === 'congestion' ? 'segment' : 'congestion')}
        graphData={graphData}
        globalLevels={(isSphereOpen ? spherePreviewApi?.global_state?.current_levels : undefined) ?? api?.global_state?.current_levels ?? api?.global_state?.pred_levels ?? []}
        globalScores={(isSphereOpen ? spherePreviewApi?.global_state?.current_scores : undefined) ?? api?.global_state?.current_scores ?? api?.global_state?.pred_scores ?? []}
        selectedSensor={sensor}
        highlightedSensor={spherePreview?.sensor ?? null}
        viewMode={panoramaMode}
        sensorCount={nSensors}
        currentTimeIndex={api?.meta?.t_obs}
        currentSimTime={(isSphereOpen ? spherePreviewApi?.meta?.sim_time : undefined) ?? api?.meta?.sim_time ?? null}
        maxTimeIndex={(api?.dataset_context?.time_steps ?? 1) - 1}
        previewSensor={spherePreview?.sensor ?? null}
        previewTimeIndex={spherePreview?.tObs ?? null}
        selectedMonth={sphereDateSelection?.month}
        selectedDay={sphereDateSelection?.day}
        weatherCondition={sphereWeatherVisual.displayCondition}
        weatherLabel={sphereWeatherVisual.label}
        weatherTempC={sphereWeather?.temp_c}
        weatherPrecipitationPct={sphereWeather?.precipitation_pct}
        onDateChange={(month, day) => {
          setSphereDateSelection((prev) => {
            const next = { month: clampMonth(month), day: clampDay(month, day) };
            if (prev && prev.month === next.month && prev.day === next.day) return prev;
            return next;
          });
        }}
        onPreviewChange={(previewSensor, previewTimeIndex) => {
          setSpherePreview((prev) => {
            if (prev && prev.sensor === previewSensor && prev.tObs === previewTimeIndex) return prev;
            return { sensor: previewSensor, tObs: previewTimeIndex };
          });
        }}
      />

      <div
        className="fixed left-0 top-0 z-10 overflow-hidden"
        style={designViewport.frameStyle}
      >
        <motion.div
          className="relative flex h-full w-full"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: uiVisible ? (isSphereOpen ? 0 : 1) : 0, y: uiVisible ? (isSphereOpen ? 10 : 0) : 12 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          style={{ pointerEvents: dashboardChromeVisible ? 'auto' : 'none' }}
        >
          <main className="flex-1 min-w-0 flex flex-col h-full relative z-10 pt-28 overflow-hidden pointer-events-none">
          {api && (
            <>
              {/* INTEGRATED BOTTOM ANALYTICS UNIT (CHART + HUD) */}
              <div className="fixed bottom-10 left-8 right-8 z-30 h-[680px] pointer-events-auto">
                <div className="relative h-full w-full">
                  
                  {/* Left: Trend Analysis (Flexible) */}
                  <div className="absolute left-0 top-6 bottom-0 right-[980px] pr-6">
                    <div className="h-full">
                      {activeChart && (
                        <ForecastChart
                          data={activeChart.data}
                          predictionStartIdx={predictionStartIdx}
                          metricLabel={activeChart.metricLabel}
                          unit={activeChart.unit}
                          simTime={api.meta.sim_time}
                          forcedMax={activeChart.limit}
                          branchPredicted={activeChart.branchPredicted}
                          branchLabel={weatherOverrideEnabled ? `${WEATHER_PRESETS.find((preset) => preset.key === weatherPreset)?.label ?? '天气'}模拟分支` : undefined}
                          accidents={api.accidents ?? null}
                          onOpenNetworkSphere={openNetworkSphere}
                        />
                      )}
                    </div>
                  </div>

                  {/* Right: Real-time Telemetry (HUD BAY) */}
                  <div className="absolute right-0 bottom-0 top-6 w-[980px] border-l border-white/5 pl-6">
                    {backgroundLedMode && ledWeatherRing ? (
                      <div className="relative h-full w-full overflow-visible">
                        <div
                          className="pointer-events-auto absolute"
                          style={{
                            left: LED_WEATHER_RING_CENTER_X,
                            top: LED_WEATHER_RING_CENTER_Y,
                            transform: `translate(-50%, -50%) scale(${LED_WEATHER_RING_SCALE})`,
                            transformOrigin: 'center center',
                          }}
                        >
                          {ledWeatherRing}
                        </div>
                      </div>
                    ) : (
                      <div className="relative h-full w-full overflow-visible">
                        <HUDContainer>
                          <RiskDashboardHUD
                            riskScore={api.current.congestion_score}
                            selectedMetric={selectedMetric}
                            onMetricSelect={setSelectedMetric}
                            metrics={{
                              speed: {
                                label: '通道速度',
                                current: api.current.speed_kmh,
                                predicted: api.prediction_series.speed_kmh[0] ?? api.current.speed_kmh,
                                limit: chartConfigs['speed']?.limit,
                                unit: 'km/h',
                                color: '#22d3ee',
                                weight: 0.45
                              },
                              flow: {
                                label: '交通流量',
                                current: api.current.flow_veh_5min,
                                predicted: api.prediction_series.flow_veh_5min[0] ?? api.current.flow_veh_5min,
                                limit: chartConfigs['flow']?.limit,
                                unit: 'veh/5m',
                                color: '#a855f7',
                                weight: 0.30
                              },
                              occupancy: {
                                label: '路段占用',
                                current: api.current.occupancy_pct,
                                predicted: api.prediction_series.occupancy_pct[0] ?? api.current.occupancy_pct,
                                limit: chartConfigs['occupancy']?.limit,
                                unit: '%',
                                color: '#f59e0b',
                                weight: 0.25
                              }
                            }}
                          />
                        </HUDContainer>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </>
          )}
          {apiError && <section className="mx-8 mt-32 rounded-3xl border border-rose-500/20 bg-rose-500/10 px-5 py-4 text-rose-300">{apiError}</section>}
        </main>
        </motion.div>
      </div>
    </div>
  );
};

export default App;
