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
  Zap,
  Percent,
  Clock,
  FlaskConical,
  Network,
  Terminal,
  LayoutGrid,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ForecastChart from './components/ForecastChart';
import BackgroundShader, { type SunnyDayPhase } from './components/BackgroundShader';
import LogoShader from './components/LogoShader';
import { NetworkSphereModal, type PanoramaMode } from './components/NetworkSphereModal';
import DevConsole from './components/DevConsole';
import RiskDashboardHUD from './components/RiskDashboardHUD';
import HUDContainer from './components/HUDContainer';
import SankeyFlowChart, { FlowNode } from './components/SankeyFlowChart';
import { deriveWeatherVisual } from './weather';

const DEFAULT_POLL_MS = import.meta.env.DEV ? 3_000 : 300_000;
const POLL_MS = Number(import.meta.env.VITE_POLL_MS ?? DEFAULT_POLL_MS);
const ENV_API_BASE = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');
const LOGO_W = 180;
const LOGO_H = 44;
const DESIRED_MODE = 'multitask_occ_primary_weather_attn';

const normalizeBase = (base: string) => String(base ?? '').replace(/\/+$/, '');
const apiUrlWithBase = (base: string, path: string) => `${normalizeBase(base)}${path.startsWith('/') ? path : `/${path}`}`;
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

type MetricKey = 'risk' | 'speed' | 'occupancy' | 'flow';

type WeatherPacket = {
  datetime: string;
  condition: string;
  temp_c: number;
  humidity: number;
  wind_kmh: number;
  precip_mm: number;
  cloudcover: number;
  visibility_km: number;
  precipitation_pct: number;
  step_index?: number;
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
    risk_level: Array<'low' | 'medium' | 'high' | 'severe'>;
  };
  history_tail: {
    times: string[];
    flow_veh_5min: number[];
    occupancy_pct: number[];
    speed_kmh: number[];
    risk_score: number[];
  };
  weekly_compare?: {
    points: number;
    tail_len: number;
    stride: number;
    times: string[];
    days: Array<{
      day: string;
      date: string;
      is_today: boolean;
      flow_veh_5min: number[];
      occupancy_pct: number[];
      speed_kmh: number[];
      risk_score: number[];
    }>;
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
    congestion_level: 'low' | 'medium' | 'high' | 'severe';
  }>;
  congestion_summary: {
    current_level: 'low' | 'medium' | 'high' | 'severe';
    peak_window: 'h1' | 'h6' | 'h12';
    peak_minutes_ahead: number;
    peak_level: 'low' | 'medium' | 'high' | 'severe';
    peak_score: number;
    headline: string;
  };
  global_state: {
    pred_levels: number[];
    pred_scores: number[];
  };
};

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
  const [isDevOpen, setIsDevOpen] = useState(false);
  const [devTab, setDevTab] = useState<any>('home');
  const [isSphereOpen, setIsSphereOpen] = useState<boolean>(false);
  const [panoramaMode, setPanoramaMode] = useState<PanoramaMode>('weather');
  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('risk');

  const abortRef = useRef<AbortController | null>(null);
  const loadingRef = useRef<boolean>(false);
  const spacetimeMonths = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);



  const fetchForecastOnce = async (
    s?: number,
    base?: string,
    opts?: { abortPrev?: boolean },
  ): Promise<ApiResponse | null> => {
    const abortPrev = opts?.abortPrev !== false;
    if (!abortPrev && loadingRef.current) return null;
    if (abortPrev && abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    loadingRef.current = true;
    setApiLoading(true);
    setApiError(null);
    try {
      const ss = s ?? sensor;
      const res = await fetch(apiUrlWithBase(base ?? apiBase, `/api/forecast?sensor=${ss}`), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!isValidApiResponse(j)) {
        throw new Error('Connected backend is not the new Caltrans multitask API');
      }
      setApi(j);
      if (j.meta?.n_sensors) setNSensors(j.meta.n_sensors);
      return j;
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setApiError(String(e?.message ?? e));
        throw e;
      }
      throw e;
    } finally {
      loadingRef.current = false;
      setApiLoading(false);
    }
  };

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); abortRef.current?.abort(); };
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
    if (bootPhase !== 'ready') return;
    fetchForecastOnce(sensor).catch(() => {});
  }, [sensor, bootPhase, apiBase]);

  useEffect(() => {
    if (bootPhase !== 'ready') return;
    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        await fetchForecastOnce(undefined, undefined, { abortPrev: false }).catch(() => {});
        await sleep(Number.isFinite(POLL_MS) ? POLL_MS : 3000);
      }
    };
    loop();
    return () => { cancelled = true; };
  }, [bootPhase, apiBase, sensor]);

  const uiVisible = bootPhase === 'ready';
  const logoMode = bootPhase === 'checking' || bootPhase === 'error' ? 'center' : 'corner';
  const weatherVisual = deriveWeatherVisual(api?.current_weather);
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
      let referenceValue: number | undefined;
      let referenceLabel: string | undefined;
      let metricLabel = '';
      let unit = '';

      if (m === 'speed') {
        observed = api.history_tail.speed_kmh;
        predicted = api.prediction_series.speed_kmh;
        referenceValue = api.current.baseline_speed_kmh;
        referenceLabel = '历史统计均值';
        metricLabel = '速度监控';
        unit = 'km/h';
      } else if (m === 'occupancy') {
        observed = api.history_tail.occupancy_pct;
        predicted = api.prediction_series.occupancy_pct;
        referenceValue = api.current.baseline_occupancy_pct;
        referenceLabel = '历史统计均值';
        metricLabel = '路段占有率';
        unit = '%';
      } else if (m === 'flow') {
        observed = api.history_tail.flow_veh_5min;
        predicted = api.prediction_series.flow_veh_5min;
        referenceValue = api.current.baseline_flow_veh_5min;
        referenceLabel = '历史统计均值';
        metricLabel = '实时流量';
        unit = 'veh/5m';
      } else {
        observed = api.history_tail.risk_score;
        predicted = api.prediction_series.risk_score;
        referenceValue = 0.6;
        referenceLabel = '高风险';
        metricLabel = '叠加风险指数';
        unit = 'score';
      }

      const lastObserved = observed[observed.length - 1] ?? null;
      const historyData = historyTimes.map((time, idx) => ({ time, observed: observed[idx] ?? null, predicted: idx === historyTimes.length - 1 ? lastObserved : null }));
      const predData = predTimes.map((time, idx) => ({ time, observed: null, predicted: predicted[idx] ?? null }));
      const data = [...historyData, ...predData];
      const multiDayData = api.weekly_compare?.days?.map((d) => {
        let series: number[] = [];
        if (m === 'speed') series = d.speed_kmh;
        else if (m === 'occupancy') series = d.occupancy_pct;
        else if (m === 'flow') series = d.flow_veh_5min;
        else series = d.risk_score;
        return { day: d.day, date: d.date, data: Array.isArray(series) ? series : [], isToday: Boolean(d.is_today) };
      });

      // Unified Dynamic Limit Calculation (Sync with ForecastChart logic)
      const allY = [...observed, ...predicted];
      const rawMin = Math.min(...allY, referenceValue ?? Infinity);
      const rawMax = Math.max(...allY, referenceValue ?? -Infinity);
      const limit = rawMax + ((rawMax - rawMin) * 0.2 || 1);

      configs[m] = { data, referenceValue, referenceLabel, metricLabel, unit, multiDayData, weeklyTimes: api.weekly_compare?.times, limit };
    });
    return configs;
  }, [api]);

  const predictionStartIdx = api ? Math.max(api.history_tail.times.length - 1, 0) : 0;
  const activeChart = chartConfigs[selectedMetric];

  const weatherFlowData = useMemo(() => {
    if (!api?.current_weather) return null;
    const cw = api.current_weather;
    const wt = api.weather_transition;

    const left: FlowNode[] = [
      { id: 'w_temp', title: '环境温度', value: `${cw.temp_c.toFixed(1)}°C`, subValue: '环境', icon: <Thermometer size={14} />, thickness: Math.max(10, Math.min(30, cw.temp_c * 1.5 + 5)), gradient: { from: '#3b82f6', to: '#60a5fa' } },
      { id: 'w_hum', title: '相对湿度', value: `${cw.humidity.toFixed(0)}%`, subValue: '相对值', icon: <Droplets size={14} />, thickness: Math.max(10, Math.min(30, cw.humidity / 3)), gradient: { from: '#10b981', to: '#34d399' } },
      { id: 'w_cloud', title: '云层遮蔽', value: `${cw.cloudcover.toFixed(0)}%`, subValue: '遮蔽度', icon: <Cloud size={14} />, thickness: Math.max(10, Math.min(35, cw.cloudcover / 3)), gradient: { from: '#6366f1', to: '#818cf8' } },
      { id: 'w_vis', title: '能见度', value: `${cw.visibility_km.toFixed(1)}km`, subValue: '视距范围', icon: <Eye size={14} />, thickness: Math.max(10, Math.min(30, (20 - cw.visibility_km) * 1.5)), gradient: { from: '#f59e0b', to: '#fbbf24' } },
    ];

    const right: FlowNode[] = [
      { id: 'w_wind', title: '实时风速', value: `${cw.wind_kmh.toFixed(1)}km/h`, subValue: '风量', icon: <Wind size={14} />, thickness: Math.max(10, Math.min(35, cw.wind_kmh * 1.5)), gradient: { from: '#ec4899', to: '#f472b6' } },
      { id: 'w_precip', title: '降水量', value: `${cw.precip_mm.toFixed(2)}mm`, subValue: '强度', icon: <CloudRain size={14} />, thickness: Math.max(10, Math.min(40, cw.precip_mm * 8 + 10)), gradient: { from: '#ef4444', to: '#f87171' } },
      { id: 'w_prob', title: '降水概率', value: `${cw.precipitation_pct}%`, subValue: '预测', icon: <Percent size={14} />, thickness: Math.max(10, Math.min(35, cw.precipitation_pct / 3)), gradient: { from: '#8b5cf6', to: '#a78bfa' } },
      { id: 'w_eta', title: '气象切换', value: wt.eta_min ? `${wt.eta_min}m` : '当前稳定', subValue: wt.active ? '即将到来' : '当前', icon: <Clock size={14} />, thickness: 20, gradient: { from: '#14b8a6', to: '#2dd4bf' } },
    ];

    const center = { 
      title: '', // Empty to focus on icon
      smallValue: '', // Empty to focus on icon
      icon: (() => {
        const iconSize = 120; // Max impact
        const iconProps = { size: iconSize, strokeWidth: 1.75, className: 'overflow-visible' };
        switch (weatherVisual.displayCondition) {
          case 'Sunny': return <Sun {...iconProps} />;
          case 'PartlyCloudy': return <CloudSun {...iconProps} />;
          case 'Overcast': return <Cloud {...iconProps} />;
          case 'Foggy': return <CloudFog {...iconProps} />;
          case 'Drizzle': return <CloudDrizzle {...iconProps} />;
          case 'Rainy': return <CloudRain {...iconProps} />;
          case 'Stormy': return <CloudLightning {...iconProps} />;
          case 'Windy': return <Wind {...iconProps} />;
          default: return <Sun {...iconProps} />;
        }
      })()
    };
    
    return { left, right, center };
  }, [api, weatherVisual]);

  return (
    <div className="min-h-screen bg-transparent text-white flex overflow-hidden relative">
      <BackgroundShader
        weatherCondition={weatherVisual.shaderCondition}
        precipitation={api?.current_weather?.precipitation_pct ?? 0}
        dayPhase={dayPhase}
      />

      {/* Curved dashboard mask: arc split from top-right toward bottom-left, darkest on the lower-right side */}
      <div
        className="fixed inset-0 pointer-events-none z-[5]"
        style={{
          background:
            'radial-gradient(130% 115% at 108% -8%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 43%, rgba(0,0,0,0.35) 56%, rgba(0,0,0,0.72) 70%, rgba(0,0,0,0.94) 84%, rgba(0,0,0,1) 100%)',
        }}
      />

      <motion.div
        className="fixed z-[100] flex items-center gap-3 select-none"
        variants={{
          center: { top: viewport.h / 2, left: viewport.w / 2, x: -32, y: -LOGO_H / 2 - 100, scale: 1.2, opacity: 1 },
          corner: { top: 32, left: 32, x: 0, y: 0, scale: 1.0, opacity: 1 },
        }}
        initial="center"
        animate={logoMode}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        onAnimationComplete={() => { if (bootPhase === 'transition') setBootPhase('ready'); }}
      >
        {logoMode === 'center' ? (
          <LogoShader size={64} />
        ) : (
          <div 
            className="flex flex-col cursor-pointer transition-all duration-300 hover:opacity-70 active:scale-95 group"
            onClick={() => {
              if (bootPhase === 'ready' && logoMode === 'corner') {
                setPanoramaMode('weather');
                setIsSphereOpen(true);
              }
            }}
          >
            <div className="text-xl font-technical font-black text-white tracking-[0.2em] leading-tight group-hover:text-cyan-400 transition-colors">
              WEATHER NET
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="text-[8px] font-technical font-bold text-cyan-400 tracking-widest opacity-80">
                DISTRICT 03 / SACRAMENTO
              </div>
              <div className="w-12 h-[1px] bg-white/10 group-hover:bg-cyan-400/50 transition-colors" />
            </div>
          </div>
        )}
      </motion.div>




      <motion.div
        className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#0A0A0B]"
        initial={{ opacity: 1 }}
        animate={{ opacity: bootPhase === 'ready' ? 0 : 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{ pointerEvents: bootPhase === 'ready' ? 'none' : 'auto' }}
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


      <AnimatePresence>
        {isDevOpen && (
          <DevConsole isOpen={isDevOpen} initialTab={devTab} onClose={() => setIsDevOpen(false)} />
        )}
      </AnimatePresence>
      <NetworkSphereModal
        isOpen={isSphereOpen} onClose={() => setIsSphereOpen(false)}
        onSelectSensor={(idx) => { setSensor(idx); setIsSphereOpen(false); }}
        onToggleViewMode={() => setPanoramaMode((p) => p === 'weather' ? 'congestion' : p === 'congestion' ? 'spacetime' : 'weather')}
        graphData={graphData} globalLevels={api?.global_state?.pred_levels ?? []} selectedSensor={sensor} viewMode={panoramaMode} weather={api?.weather} spacetimeMonths={spacetimeMonths}
      />

      <motion.div
        className="flex w-full"
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: uiVisible ? 1 : 0, y: uiVisible ? 0 : 12 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        style={{ pointerEvents: uiVisible ? 'auto' : 'none' }}
      >
        <main className="flex-1 min-w-0 flex flex-col h-screen relative z-10 pt-28 overflow-hidden pointer-events-none">
          {api && (
            <>
              <div className="fixed top-12 right-8 z-20 w-[850px] pointer-events-auto">
                {weatherFlowData && (
                  <SankeyFlowChart
                    leftNodes={weatherFlowData.left}
                    rightNodes={weatherFlowData.right}
                    centerNode={weatherFlowData.center}
                    height={460}
                    compact={true}
                    hideTitle={true}
                    background={false}
                    className="drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]"
                  />
                )}
              </div>

              {/* Developer Entrance Button - Positioned left of the weather chart to avoid blockage */}
              <div className="fixed top-12 right-[880px] z-[150] pointer-events-auto flex gap-3">
                <button
                  onClick={() => { setDevTab('gallery'); setIsDevOpen(true); }}
                  className="w-10 h-10 flex items-center justify-center bg-black/40 backdrop-blur-md border border-white/10 rounded-xl hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all active:scale-95 group"
                  aria-label="Open Gallery"
                >
                  <LayoutGrid size={18} className="text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                </button>
                <button
                  onClick={() => { setDevTab('home'); setIsDevOpen(true); }}
                  className="w-10 h-10 flex items-center justify-center bg-black/40 backdrop-blur-md border border-white/10 rounded-xl hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all active:scale-95 group"
                  aria-label="Open Dev Console"
                >
                  <Terminal size={18} className="text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                </button>
              </div>

              {/* INTEGRATED BOTTOM ANALYTICS UNIT (CHART + HUD) */}
              <div className="fixed bottom-28 left-8 right-24 z-30 pointer-events-auto">
                <div className="max-w-[1600px] ml-0 flex flex-col md:flex-row items-center gap-8">
                  
                  {/* Left: Trend Analysis (Flexible) */}
                  <div className="flex-1 flex flex-col gap-2 min-w-0">
                    {activeChart && (
                      <ForecastChart
                        data={activeChart.data}
                        predictionStartIdx={predictionStartIdx}
                        metricLabel={activeChart.metricLabel}
                        unit={activeChart.unit}
                        referenceValue={activeChart.referenceValue}
                        referenceLabel={activeChart.referenceLabel}
                        multiDayData={activeChart.multiDayData}
                        weeklyTimes={activeChart.weeklyTimes}
                        simTime={api.meta.sim_time}
                        forcedMax={activeChart.limit}
                      />
                    )}
                  </div>

                  {/* Right: Real-time Telemetry (HUD BAY) */}
                  <div className="w-[800px] flex flex-col gap-2 border-l border-white/5 pl-12">
                    <div className="relative overflow-visible scale-110 origin-center -translate-x-12">
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
                  </div>
                </div>
              </div>

            </>
          )}
          {apiError && <section className="mx-8 mt-32 rounded-3xl border border-rose-500/20 bg-rose-500/10 px-5 py-4 text-rose-300">{apiError}</section>}
        </main>
      </motion.div>
    </div>
  );
};

export default App;
