import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { NetworkSphereModal, type PanoramaMode } from '../NetworkSphereModal';

interface NetworkStarOrbProps {
  expanded: boolean;
  onToggle: () => void;
}

const ROUTES = [
  'I-5',
  'I-80',
  'US-50',
  'CA-99',
  'CA-160',
  'CA-244',
  'SR-51',
  'SR-65',
  'SR-70',
  'SR-99',
  'I-580',
  'I-680',
];

const DIRECTIONS = ['NB', 'SB', 'EB', 'WB'];
const MOCK_SENSOR_COUNT = 192;
const DESIRED_MODE = 'multitask_occ_primary_weather_attn';
const COMPACT_ORB_TARGET_X = 205;
const COMPACT_ORB_TARGET_BOTTOM = 245;
const COMPACT_RENDER_WIDTH = 460;
const API_BASE_CANDIDATES = [
  String(import.meta.env.VITE_API_BASE ?? ''),
  '',
  'http://127.0.0.1:8010',
  'http://localhost:8010',
  'http://127.0.0.1:8000',
  'http://localhost:8000',
];

type SpherePayload = {
  graphData: { nodes: any[]; links: any[]; metadata?: any };
  globalLevels: number[];
  globalScores: number[];
  sensorCount: number;
  currentTimeIndex: number;
  currentSimTime: string | null;
  maxTimeIndex: number;
  weatherCondition: string;
  weatherLabel: string;
  weatherTempC: number;
  weatherPrecipitationPct: number;
  sourceLabel: string;
};

function normalizeBase(base: string) {
  return String(base ?? '').replace(/\/+$/, '');
}

function apiUrlWithBase(base: string, path: string) {
  const resolvedBase = normalizeBase(base);
  return `${resolvedBase}${path.startsWith('/') ? path : `/${path}`}`;
}

function uniqueApiBases() {
  return Array.from(new Set(API_BASE_CANDIDATES.map(normalizeBase)));
}

function buildMockSphereData(): SpherePayload {
  const nodes = Array.from({ length: MOCK_SENSOR_COUNT }, (_, index) => {
    const routeIndex = index % ROUTES.length;
    const laneIndex = Math.floor(index / ROUTES.length);

    return {
      freeway: ROUTES[routeIndex],
      direction: DIRECTIONS[(routeIndex + laneIndex) % DIRECTIONS.length],
      abs_pm: laneIndex * 1.7 + routeIndex * 0.08,
      station_name: `${ROUTES[routeIndex]} Sensor ${String(index + 1).padStart(3, '0')}`,
    };
  });

  const links = nodes.slice(1).map((_, index) => ({
    source: index,
    target: index + 1,
  }));

  const globalLevels = nodes.map((_, index) => {
    const wave = Math.sin(index * 0.23) + Math.cos(index * 0.11);
    return Math.max(0, Math.min(3, Math.round(wave + 1.7)));
  });

  const globalScores = nodes.map((_, index) => {
    const score = 0.48 + Math.sin(index * 0.17) * 0.28 + Math.cos(index * 0.07) * 0.16;
    return Math.max(0, Math.min(1, score));
  });

  return {
    graphData: {
      nodes,
      links,
      metadata: {
        source: 'v2 mock network sphere dock',
      },
    },
    globalLevels,
    globalScores,
    sensorCount: MOCK_SENSOR_COUNT,
    currentTimeIndex: 1400,
    currentSimTime: '2023-10-10 08:00',
    maxTimeIndex: 105119,
    weatherCondition: 'rain',
    weatherLabel: 'Rain',
    weatherTempC: 8,
    weatherPrecipitationPct: 82,
    sourceLabel: 'Mock graph fallback',
  };
}

async function fetchJson(base: string, path: string, signal: AbortSignal) {
  const response = await fetch(apiUrlWithBase(base, path), { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchBackendSphereData(signal: AbortSignal): Promise<SpherePayload> {
  let lastError: unknown = null;

  for (const base of uniqueApiBases()) {
    try {
      const health = await fetchJson(base, '/api/health', signal);
      if (!health?.ok || health?.status?.mode !== DESIRED_MODE) {
        throw new Error(`Unexpected backend mode: ${String(health?.status?.mode ?? 'unknown')}`);
      }

      const [graphData, forecast] = await Promise.all([
        fetchJson(base, '/api/graph_structure', signal),
        fetchJson(base, '/api/forecast?sensor=42', signal),
      ]);

      const nodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
      if (nodes.length === 0) throw new Error('Graph topology is empty');

      const globalLevels = forecast?.global_state?.current_levels
        ?? forecast?.global_state?.pred_levels
        ?? [];
      const globalScores = forecast?.global_state?.current_scores
        ?? forecast?.global_state?.pred_scores
        ?? [];
      const currentWeather = forecast?.current_weather ?? {};

      return {
        graphData,
        globalLevels,
        globalScores,
        sensorCount: Number(forecast?.meta?.n_sensors) || nodes.length,
        currentTimeIndex: Number(forecast?.meta?.t_obs) || 0,
        currentSimTime: forecast?.meta?.sim_time ?? null,
        maxTimeIndex: Math.max(0, Number(forecast?.dataset_context?.time_steps ?? 105120) - 1),
        weatherCondition: String(currentWeather.condition ?? 'Rain'),
        weatherLabel: String(currentWeather.condition ?? 'Rain'),
        weatherTempC: Number(currentWeather.temp_c ?? 8),
        weatherPrecipitationPct: Number(currentWeather.precipitation_pct ?? 0),
        sourceLabel: `Backend graph ${nodes.length}`,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new Error('No backend candidate responded');
}

const NetworkStarOrb: React.FC<NetworkStarOrbProps> = ({ expanded, onToggle }) => {
  const [viewMode, setViewMode] = useState<PanoramaMode>('congestion');
  const [selectedSensor, setSelectedSensor] = useState(64);
  const [showExpandedUi, setShowExpandedUi] = useState(false);
  const [renderLiveSphere, setRenderLiveSphere] = useState(true);
  const [liveSphereReady, setLiveSphereReady] = useState(false);
  const [showSnapshotOverlay, setShowSnapshotOverlay] = useState(false);
  const [staticSnapshot, setStaticSnapshot] = useState<string | null>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [snapshotRequestKey, setSnapshotRequestKey] = useState(0);
  const [isClosingSphere, setIsClosingSphere] = useState(false);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  }));
  const fallbackData = useMemo(() => buildMockSphereData(), []);
  const [backendData, setBackendData] = useState<SpherePayload | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'backend' | 'fallback'>('loading');
  const sphereData = backendData ?? fallbackData;
  const pendingFocusRequestKeyRef = useRef<number | null>(null);
  const closeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchBackendSphereData(controller.signal)
      .then((payload) => {
        setBackendData(payload);
        setSelectedSensor((current) => Math.min(current, payload.sensorCount - 1));
        setLoadState('backend');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn('[V2 NetworkSphere] Falling back to mock sphere data:', error);
        setLoadState('fallback');
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    return () => {
      if (closeFrameRef.current !== null) window.cancelAnimationFrame(closeFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const syncViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    setShowExpandedUi(false);

    if (expanded) {
      setShowSnapshotOverlay(Boolean(staticSnapshot));
      setRenderLiveSphere(!staticSnapshot);
      setIsClosingSphere(false);
    } else if (!staticSnapshot) {
      setRenderLiveSphere(true);
      setIsClosingSphere(false);
    }
  }, [expanded, staticSnapshot]);

  useEffect(() => {
    if (!renderLiveSphere) setLiveSphereReady(false);
  }, [renderLiveSphere]);

  const compactScale = Math.min(0.36, Math.max(0.23, COMPACT_RENDER_WIDTH / Math.max(1, viewport.width)));
  const compactX = COMPACT_ORB_TARGET_X - viewport.width / 2;
  const compactY = viewport.height - COMPACT_ORB_TARGET_BOTTOM - viewport.height / 2;

  const revealLiveSphere = () => {
    if (renderLiveSphere && liveSphereReady) {
      setShowSnapshotOverlay(false);
      setShowExpandedUi(true);
      return;
    }
    setRenderLiveSphere(true);
  };

  const collapseAfterSnapshot = () => {
    setRenderLiveSphere(false);
    setShowSnapshotOverlay(true);
    setIsClosingSphere(false);
    pendingFocusRequestKeyRef.current = null;
    onToggle();
  };

  const handleSnapshot = (dataUrl: string) => {
    if (!dataUrl) return;
    setStaticSnapshot(dataUrl);
    collapseAfterSnapshot();
  };

  const handleFocusSettled = (settledKey: number) => {
    if (!isClosingSphere || pendingFocusRequestKeyRef.current !== settledKey) return;
    setSnapshotRequestKey((value) => value + 1);
  };

  const handleLiveReady = () => {
    setLiveSphereReady(true);
    if (!expanded || isClosingSphere) return;
    setShowSnapshotOverlay(false);
    setShowExpandedUi(true);
  };

  const handleClose = () => {
    if (isClosingSphere) return;
    setIsClosingSphere(true);
    setShowExpandedUi(false);
    setShowSnapshotOverlay(false);
    setRenderLiveSphere(true);
    pendingFocusRequestKeyRef.current = null;
    onToggle();
    if (closeFrameRef.current !== null) window.cancelAnimationFrame(closeFrameRef.current);
    closeFrameRef.current = window.requestAnimationFrame(() => {
      closeFrameRef.current = null;
      setIsClosingSphere(false);
    });
  };

  return (
    <div
      className={`fixed inset-0 ${expanded ? 'z-50 pointer-events-auto' : 'z-40 pointer-events-none'}`}
      aria-hidden={false}
    >
    <motion.div
      className="absolute inset-0 overflow-hidden bg-transparent [transform-origin:center_center]"
      initial={false}
      animate={
        expanded
          ? {
              x: 0,
              y: 0,
              scale: 1,
            }
          : {
              x: compactX,
              y: compactY,
              scale: compactScale,
            }
      }
      transition={{ type: 'spring', stiffness: 95, damping: 19, mass: 0.9 }}
      style={{ pointerEvents: expanded ? 'auto' : 'none' }}
      onAnimationComplete={() => {
        if (expanded) revealLiveSphere();
      }}
    >
      <div className="absolute inset-0 overflow-hidden">
        {renderLiveSphere && (
        <NetworkSphereModal
          isOpen
          onClose={() => undefined}
          onSelectSensor={(sensorIdx) => setSelectedSensor(sensorIdx)}
          onSelectNation={() => undefined}
          onToggleViewMode={() => {
            setViewMode((current) => (current === 'congestion' ? 'segment' : 'congestion'));
          }}
          graphData={sphereData.graphData}
          globalLevels={sphereData.globalLevels}
          globalScores={sphereData.globalScores}
          selectedSensor={selectedSensor}
          highlightedSensor={showExpandedUi ? selectedSensor : null}
          viewMode={viewMode}
          compactOrb={!showExpandedUi}
          sensorCount={sphereData.sensorCount}
          currentTimeIndex={sphereData.currentTimeIndex}
          currentSimTime={sphereData.currentSimTime}
          maxTimeIndex={sphereData.maxTimeIndex}
          previewSensor={selectedSensor}
          previewTimeIndex={sphereData.currentTimeIndex}
          onPreviewChange={(sensorId) => {
            setSelectedSensor(Math.max(0, Math.min(sphereData.sensorCount - 1, sensorId)));
          }}
          selectedMonth={10}
          selectedDay={10}
          onDateChange={() => undefined}
          weatherCondition={sphereData.weatherCondition}
          weatherLabel={sphereData.weatherLabel}
          weatherTempC={sphereData.weatherTempC}
          weatherPrecipitationPct={sphereData.weatherPrecipitationPct}
          focusRequestKey={focusRequestKey}
          onLiveReady={handleLiveReady}
          renderFps={showExpandedUi ? undefined : 1}
        />
        )}

        {staticSnapshot && (!renderLiveSphere || showSnapshotOverlay) && (
          <motion.img
            src={staticSnapshot}
            alt=""
            className="absolute inset-0 h-full w-full object-fill"
            draggable={false}
            initial={false}
            animate={{ opacity: renderLiveSphere && showExpandedUi ? 0 : 1 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </div>
    </motion.div>

      {!expanded && (
        <button
          type="button"
          className="pointer-events-auto fixed bottom-[92px] left-[72px] z-[90] h-[260px] w-[260px] cursor-pointer rounded-full bg-transparent"
          aria-label="Expand network sphere"
          onClick={onToggle}
        />
      )}

      {showExpandedUi && (
        <motion.div
          className="pointer-events-none absolute left-4 top-4 z-[90] rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55 backdrop-blur-md"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {loadState === 'loading' ? 'Connecting' : sphereData.sourceLabel}
        </motion.div>
      )}

      {showExpandedUi && (
        <motion.button
          type="button"
          className="absolute right-4 top-4 z-[90] rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-white/70 backdrop-blur-md transition hover:border-white/30 hover:text-white"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          onClick={(event) => {
            event.stopPropagation();
            handleClose();
          }}
        >
          Close
        </motion.button>
      )}

      {isClosingSphere && (
        <div
          className="absolute inset-0 z-[100] cursor-wait"
          onPointerDown={(event) => event.preventDefault()}
          onPointerMove={(event) => event.preventDefault()}
          onWheel={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      )}
    </div>
  );
};

export default NetworkStarOrb;
