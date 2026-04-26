import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Sun, Wind } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
// @ts-ignore
import { geoVoronoi } from 'd3-geo-voronoi';

/* ─────────────────────────── Types ─────────────────────────── */

export type PanoramaMode = 'congestion' | 'segment';

interface NetworkSphereModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSensor: (sensorIdx: number, timeIndex: number) => void;
  onSelectNation?: (nationIdx: number) => void;
  onToggleViewMode?: () => void;
  graphData: { nodes: any[]; links: any[]; metadata?: any } | null;
  globalLevels: number[];
  globalScores?: number[];
  selectedSensor: number;
  highlightedSensor?: number | null;
  viewMode?: PanoramaMode;
  sensorCount?: number;
  currentTimeIndex?: number;
  currentSimTime?: string | null;
  maxTimeIndex?: number;
  previewSensor?: number | null;
  previewTimeIndex?: number | null;
  onPreviewChange?: (sensorId: number, timeIndex: number) => void;
  selectedMonth?: number;
  selectedDay?: number;
  onDateChange?: (month: number, day: number) => void;
  weatherCondition?: string;
  weatherLabel?: string;
  weatherTempC?: number;
  weatherPrecipitationPct?: number;
  compactOrb?: boolean;
  focusRequestKey?: number;
  snapshotRequestKey?: number;
  onSnapshot?: (dataUrl: string) => void;
  onFocusSettled?: (focusRequestKey: number) => void;
  onLiveReady?: () => void;
  renderFps?: number;
  entryTransition?: {
    x: number;
    y: number;
    scale: number;
  };
}

export interface RegionNation {
  nationIdx: number;
  key: string;
  label: string;
  childSensors: number[];
  polygon3D: THREE.Vector3[]; // Border ring
  centroid3D: THREE.Vector3;  // Capital / Icon location
  level: number;
}

/* ─────────────────── Constants ─────────────────── */

const SPHERE_R = 2.0;
const PHI = Math.PI * (3 - Math.sqrt(5));
const MIN_CAMERA_DISTANCE = 3.8;
const MAX_CAMERA_DISTANCE = 9.0;
const MIN_ROTATE_SPEED = 0.22;
const MAX_ROTATE_SPEED = 0.9;
const TIME_WIDGET_RADIUS = 60;
const DAY_WIDGET_ITEM_HEIGHT = 30;
const DAY_WIDGET_VIEWPORT_HEIGHT = 120;
const DAY_WIDGET_CENTER_PADDING = (DAY_WIDGET_VIEWPORT_HEIGHT - DAY_WIDGET_ITEM_HEIGHT) / 2;
const DAY_WIDGET_SCROLL_ANIMATION_MS = 220;
const DAY_WIDGET_WHEEL_COOLDOWN_MS = DAY_WIDGET_SCROLL_ANIMATION_MS + 40;
const DAY_WIDGET_PROGRAMMATIC_LOCK_MS = DAY_WIDGET_SCROLL_ANIMATION_MS + 80;
const SENSOR_WIDGET_MIN_WIDTH = 56;
const SENSOR_WIDGET_MAX_WIDTH = 320;
const SENSOR_WIDGET_ANIMATION_MS = 500;
const SENSOR_HANDLE_WIDTH = 28;
const DAY_START_SLOT = 0;
const DEFAULT_CAMERA_DISTANCE = 6.5;
const GLOBE_ZOOM_SPEED = 0.55;
const CAMERA_FOCUS_DONE_EPS_SQ = 0.000001;
const CAMERA_DISTANCE_DONE_EPS = 0.002;
const CAMERA_FOCUS_SNAP_ANGLE = 0.0015;
const CAMERA_FOCUS_SNAP_UP_DISTANCE = 0.002;
const CAMERA_FOCUS_MIN_DURATION = 0.08;
const CAMERA_FOCUS_MAX_DURATION = 0.95;
const CAMERA_FOCUS_ANGULAR_SPEED = 2.6;
const CAMERA_FOCUS_DISTANCE_SPEED = 7.0;
const CAMERA_FOCUS_UP_SPEED = 5.0;
const DAYS_IN_MONTH_2023 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_MAPPING = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const FINAL_ANGLES = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180];
const COLLAPSED_ANGLES = Array.from({ length: 12 }, (_, i) => -45 + i * (90 / 11));
const NETWORK_STRIP_VISIBLE_COUNT = 19;
const SELECTOR_BASE_WIDTH = 656;
const SELECTOR_BASE_HEIGHT = 200;
const WEATHER_ICON_BASE_SIZE = 76;

type OverlayViewport = {
  width: number;
  height: number;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getOverlayViewport(): OverlayViewport {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

function useOverlayViewport(active: boolean): OverlayViewport {
  const [viewport, setViewport] = useState<OverlayViewport>(() => getOverlayViewport());

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setViewport(getOverlayViewport()));
    };
    update();
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
    };
  }, [active]);

  return viewport;
}

function clampMonth(month: number) {
  const m = Math.floor(month);
  return Math.max(1, Math.min(12, m));
}

function wrapMonth(month: number) {
  const normalized = ((Math.floor(month) - 1) % 12 + 12) % 12;
  return normalized + 1;
}

function clampDay(month: number, day: number) {
  const m = clampMonth(month);
  const max = DAYS_IN_MONTH_2023[m - 1] ?? 31;
  return Math.max(1, Math.min(max, Math.floor(day)));
}

function getDaysInMonth(month: number) {
  return DAYS_IN_MONTH_2023[clampMonth(month) - 1] ?? 31;
}

function tObsToMonthDay(tObs: number): { month: number; day: number } {
  const dayOfYear = Math.max(0, Math.floor(tObs / 288));
  let remain = dayOfYear;
  for (let m = 1; m <= 12; m++) {
    const len = DAYS_IN_MONTH_2023[m - 1];
    if (remain < len) return { month: m, day: remain + 1 };
    remain -= len;
  }
  return { month: 12, day: 31 };
}

function monthDayToTObs(month: number, day: number, slot: number, maxTimeIndex: number): number {
  const m = clampMonth(month);
  const d = clampDay(m, day);
  const dayBefore = DAYS_IN_MONTH_2023.slice(0, m - 1).reduce((acc, v) => acc + v, 0);
  const dayOfYear = dayBefore + (d - 1);
  const s = Math.max(0, Math.min(287, Math.floor(slot)));
  const idx = dayOfYear * 288 + s;
  return Math.max(0, Math.min(Math.max(0, maxTimeIndex), idx));
}

function tObsSlot(tObs: number): number {
  const slot = Math.floor(Number.isFinite(tObs) ? tObs : 0) % 288;
  return Math.max(0, Math.min(287, slot < 0 ? slot + 288 : slot));
}

function monthDayToPreviewTObs(month: number, day: number, currentTObs: number, maxTimeIndex: number): number {
  const target = { month: clampMonth(month), day: clampDay(month, day) };
  const current = tObsToMonthDay(currentTObs);
  const slot = current.month === target.month && current.day === target.day
    ? tObsSlot(currentTObs)
    : DAY_START_SLOT;
  return monthDayToTObs(target.month, target.day, slot, maxTimeIndex);
}

function clampSensorId(sensorId: number, sensorCount: number): number {
  const safeCount = Math.max(1, Math.floor(sensorCount));
  return Math.max(1, Math.min(safeCount, Math.round(sensorId)));
}

function sensorIdToWidth(sensorId: number, sensorCount: number): number {
  const safeCount = Math.max(1, Math.floor(sensorCount));
  if (safeCount <= 1) return SENSOR_WIDGET_MIN_WIDTH;
  const clamped = clampSensorId(sensorId, safeCount);
  const ratio = (clamped - 1) / (safeCount - 1);
  return SENSOR_WIDGET_MIN_WIDTH + ratio * (SENSOR_WIDGET_MAX_WIDTH - SENSOR_WIDGET_MIN_WIDTH);
}

function widthToSensorId(width: number, sensorCount: number): number {
  const safeCount = Math.max(1, Math.floor(sensorCount));
  if (safeCount <= 1) return 1;
  const clampedWidth = Math.max(SENSOR_WIDGET_MIN_WIDTH, Math.min(SENSOR_WIDGET_MAX_WIDTH, width));
  const ratio = (clampedWidth - SENSOR_WIDGET_MIN_WIDTH) / (SENSOR_WIDGET_MAX_WIDTH - SENSOR_WIDGET_MIN_WIDTH);
  return clampSensorId(1 + ratio * (safeCount - 1), safeCount);
}

function easeOutQuart(x: number): number {
  return 1 - Math.pow(1 - x, 4);
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

function angularDistance(a: THREE.Vector3, b: THREE.Vector3) {
  return Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
}

function getRenderPixelRatio(width: number, height: number) {
  const maxPixelRatio = width * height >= 1600 * 900 ? 1 : 1.25;
  return Math.max(1, Math.min(window.devicePixelRatio || 1, maxPixelRatio));
}

/* ─────────────────── Helpers ─────────────────── */

function fibSphere(N: number): THREE.Vector3[] {
  if (N <= 1) return [new THREE.Vector3(0, 0, 1)];
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = PHI * i;
    pts.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return pts;
}

function cartToLonLat(v: THREE.Vector3): [number, number] {
  const norm = v.clone().normalize();
  const lat = Math.asin(Math.max(-1, Math.min(1, norm.y))) * (180 / Math.PI);
  const lon = Math.atan2(norm.z, norm.x) * (180 / Math.PI);
  return [lon, lat];
}

function lonLatTo3D(lon: number, lat: number, r: number): THREE.Vector3 {
  const phi = (lat * Math.PI) / 180;
  const theta = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    r * Math.cos(phi) * Math.cos(theta),
    r * Math.sin(phi),
    r * Math.cos(phi) * Math.sin(theta),
  );
}

function levelToRegionColor(level: number): THREE.Color {
  if (level >= 3.0) return new THREE.Color(0x6b1f1f); // severe
  if (level >= 2.0) return new THREE.Color(0x4a2828); // high
  if (level >= 1.0) return new THREE.Color(0x3d3528); // medium
  return new THREE.Color(0x2a2d35);                  // low
}

function levelToPulseColor(level: number): THREE.Color {
  const t = THREE.MathUtils.clamp(level / 3.0, 0, 1);
  const stops = [
    new THREE.Color(0x4e88b7),
    new THREE.Color(0xc7a546),
    new THREE.Color(0xe37b38),
    new THREE.Color(0xff5a4f),
  ];

  if (t <= 1 / 3) return stops[0].clone().lerp(stops[1], t * 3);
  if (t <= 2 / 3) return stops[1].clone().lerp(stops[2], (t - 1 / 3) * 3);
  return stops[2].clone().lerp(stops[3], (t - 2 / 3) * 3);
}

function levelToNodeColor(level: number): THREE.Color {
  if (level >= 3) return new THREE.Color(0xd13131);
  if (level >= 1) return new THREE.Color(0x9e5c3e);
  return new THREE.Color(0x445566);
}

function withSaturation(color: THREE.Color, saturation: number, target: THREE.Color) {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  target.setHSL(hsl.h, THREE.MathUtils.clamp(saturation, 0, 1), hsl.l);
  return target;
}

function congestionPercentFromNodeLevel(level: number) {
  if (level >= 3) return 100;
  if (level >= 2) return 75;
  if (level >= 1) return 50;
  return 0;
}

function congestionPercentFromSensors(sensorIds: number[], levels: number[], scores?: number[]) {
  if (sensorIds.length === 0) return 0;
  let scoreTotal = 0;
  let scoreCount = 0;
  if (scores?.length) {
    for (const sensorId of sensorIds) {
      const score = scores[sensorId];
      if (!Number.isFinite(score)) continue;
      scoreTotal += Math.max(0, Math.min(1, score));
      scoreCount++;
    }
    if (scoreCount > 0) return Math.round((scoreTotal / scoreCount) * 100);
  }

  let total = 0;
  for (const sensorId of sensorIds) {
    total += congestionPercentFromNodeLevel(levels[sensorId] ?? 0);
  }
  return Math.round(total / sensorIds.length);
}

function normalizeRoadValue(value: unknown, fallback: string) {
  const raw = String(value ?? '').trim();
  return raw.length > 0 && raw.toLowerCase() !== 'nan' ? raw : fallback;
}

function buildFallbackGraphData(sensorCount: number) {
  const routes = ['I-5', 'I-80', 'US-50', 'CA-99', 'SR-51', 'SR-65', 'SR-70', 'I-580', 'I-680', 'CA-160', 'CA-244', 'SR-99'];
  const directions = ['NB', 'SB', 'EB', 'WB'];
  const safeCount = Math.max(1, Math.floor(sensorCount));

  return {
    nodes: Array.from({ length: safeCount }, (_, index) => {
      const routeIndex = index % routes.length;
      const laneIndex = Math.floor(index / routes.length);
      return {
        freeway: routes[routeIndex],
        direction: directions[(routeIndex + laneIndex) % directions.length],
        abs_pm: laneIndex * 1.65 + routeIndex * 0.08,
        station_name: `${routes[routeIndex]} Sensor ${String(index + 1).padStart(3, '0')}`,
      };
    }),
    links: [],
    metadata: { source: 'fallback-network-sphere' },
  };
}

function getRoadSegmentMeta(node: any) {
  const freeway = normalizeRoadValue(node?.freeway, 'UNKNOWN');
  return {
    key: freeway,
    label: freeway,
  };
}

function normalizeRouteKey(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function finiteNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function scoreToStripColor(score: number | undefined, level: number | undefined) {
  const resolvedScore = Number.isFinite(score) ? Math.max(0, Math.min(1, Number(score))) : undefined;
  if (resolvedScore !== undefined) {
    if (resolvedScore >= 0.8) return '#ff3b30';
    if (resolvedScore >= 0.6) return '#ff8a2a';
    if (resolvedScore >= 0.35) return '#ffcc00';
    return '#0a84ff';
  }
  const resolvedLevel = Number(level ?? 0);
  if (resolvedLevel >= 3) return '#ff3b30';
  if (resolvedLevel >= 2) return '#ff8a2a';
  if (resolvedLevel >= 1) return '#ffcc00';
  return '#0a84ff';
}

function getWeatherIcon(condition?: string): LucideIcon {
  switch (condition) {
    case 'PartlyCloudy':
      return CloudSun;
    case 'Overcast':
      return Cloud;
    case 'Foggy':
      return CloudFog;
    case 'Drizzle':
      return CloudDrizzle;
    case 'Rainy':
      return CloudRain;
    case 'Stormy':
      return CloudLightning;
    case 'Windy':
      return Wind;
    default:
      return Sun;
  }
}

function getWeatherAccent(condition?: string) {
  switch (condition) {
    case 'Stormy':
      return '#a78bfa';
    case 'Rainy':
    case 'Drizzle':
      return '#38bdf8';
    case 'Foggy':
      return '#67e8f9';
    case 'Overcast':
    case 'PartlyCloudy':
      return '#94a3b8';
    case 'Windy':
      return '#22d3ee';
    default:
      return '#fbbf24';
  }
}

function buildNetworkStripData(
  graphData: { nodes: any[]; links: any[]; metadata?: any } | null,
  focusSensor: number,
  globalScores: number[],
  globalLevels: number[],
): NetworkStripData | null {
  const nodes = graphData?.nodes;
  if (!nodes?.length || focusSensor < 0 || focusSensor >= nodes.length) return null;

  const focusNode = nodes[focusSensor];
  const freeway = normalizeRouteKey(focusNode?.freeway);
  const direction = normalizeRouteKey(focusNode?.direction);
  if (!freeway || !direction) return null;

  const corridor = nodes
    .map((node, sensorIdx) => ({ node, sensorIdx }))
    .filter(({ node }) => normalizeRouteKey(node?.freeway) === freeway && normalizeRouteKey(node?.direction) === direction)
    .sort((a, b) => {
      const pmDelta = finiteNumber(a.node?.abs_pm, a.sensorIdx) - finiteNumber(b.node?.abs_pm, b.sensorIdx);
      return pmDelta || a.sensorIdx - b.sensorIdx;
    });

  const focusIndex = corridor.findIndex(({ sensorIdx }) => sensorIdx === focusSensor);
  if (focusIndex === -1) return null;

  const visibleCount = Math.min(NETWORK_STRIP_VISIBLE_COUNT, corridor.length);
  const halfWindow = Math.floor(visibleCount / 2);
  const start = Math.max(0, Math.min(focusIndex - halfWindow, corridor.length - visibleCount));
  const end = start + visibleCount;
  const visible = corridor.slice(start, end).map(({ node, sensorIdx }, localIndex) => {
    const absoluteIndex = start + localIndex;
    const score = globalScores[sensorIdx];
    const level = globalLevels[sensorIdx];
    return {
      sensorIdx,
      absoluteIndex,
      label: String(node?.station_name ?? node?.name ?? `Sensor ${sensorIdx + 1}`),
      absPm: finiteNumber(node?.abs_pm, sensorIdx),
      score: Number.isFinite(score) ? Math.max(0, Math.min(1, Number(score))) : undefined,
      level: Number.isFinite(level) ? Number(level) : undefined,
      color: scoreToStripColor(score, level),
      isCurrent: sensorIdx === focusSensor,
      distance: Math.abs(absoluteIndex - focusIndex),
    };
  });

  return {
    freeway,
    direction,
    total: corridor.length,
    position: focusIndex + 1,
    start,
    end,
    focusSensor,
    currentName: String(focusNode?.station_name ?? focusNode?.name ?? `Sensor ${focusSensor + 1}`),
    visible,
  };
}

function buildAbstractSegmentPositions(nations: RegionNation[], nodes: any[], sensorCount: number) {
  const positions = new Array<THREE.Vector3>(sensorCount);
  const basePositions = fibSphere(sensorCount).map((p) => p.normalize());
  const segmentSeeds = fibSphere(Math.max(1, nations.length)).map((p) => p.normalize());
  const ownedPoints = Array.from({ length: nations.length }, () => [] as number[]);
  const allPointIds = Array.from({ length: sensorCount }, (_, i) => i);
  const allNationIds = nations.map((_, ni) => ni);

  const axisValue = (v: THREE.Vector3, axis: number) => axis === 0 ? v.x : axis === 1 ? v.y : v.z;
  const chooseSplitAxis = (pointIds: number[]) => {
    const mean = new THREE.Vector3();
    for (const pi of pointIds) mean.add(basePositions[pi]);
    mean.multiplyScalar(1 / Math.max(1, pointIds.length));

    const variance = [0, 0, 0];
    for (const pi of pointIds) {
      const p = basePositions[pi];
      variance[0] += Math.pow(p.x - mean.x, 2);
      variance[1] += Math.pow(p.y - mean.y, 2);
      variance[2] += Math.pow(p.z - mean.z, 2);
    }
    return variance[0] > variance[1] && variance[0] > variance[2] ? 0 : variance[1] > variance[2] ? 1 : 2;
  };

  const partition = (nationIds: number[], pointIds: number[]) => {
    if (nationIds.length === 0 || pointIds.length === 0) return;
    if (nationIds.length === 1) {
      ownedPoints[nationIds[0]].push(...pointIds);
      return;
    }

    const axis = chooseSplitAxis(pointIds);
    const sortedNations = [...nationIds].sort((a, b) =>
      axisValue(segmentSeeds[a] ?? new THREE.Vector3(0, 0, 1), axis) -
      axisValue(segmentSeeds[b] ?? new THREE.Vector3(0, 0, 1), axis)
    );
    const sortedPoints = [...pointIds].sort((a, b) =>
      axisValue(basePositions[a], axis) - axisValue(basePositions[b], axis)
    );

    const total = sortedNations.reduce((sum, ni) => sum + nations[ni].childSensors.length, 0);
    let bestSplit = 1;
    let bestDelta = Infinity;
    let running = 0;
    for (let i = 1; i < sortedNations.length; i++) {
      running += nations[sortedNations[i - 1]].childSensors.length;
      const delta = Math.abs(total / 2 - running);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestSplit = i;
      }
    }

    const leftNations = sortedNations.slice(0, bestSplit);
    const rightNations = sortedNations.slice(bestSplit);
    const leftCount = leftNations.reduce((sum, ni) => sum + nations[ni].childSensors.length, 0);

    partition(leftNations, sortedPoints.slice(0, leftCount));
    partition(rightNations, sortedPoints.slice(leftCount));
  };

  partition(allNationIds, allPointIds);

  for (let ni = 0; ni < nations.length; ni++) {
    const seed = segmentSeeds[ni] ?? new THREE.Vector3(0, 0, 1);
    const ref = Math.abs(seed.y) > 0.85 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const axisA = new THREE.Vector3().crossVectors(ref, seed).normalize();
    const axisB = new THREE.Vector3().crossVectors(seed, axisA).normalize();
    const pointIds = ownedPoints[ni]
      .sort((a, b) => {
        const pa = basePositions[a];
        const pb = basePositions[b];
        const aa = Math.atan2(pa.dot(axisB), pa.dot(axisA));
        const ab = Math.atan2(pb.dot(axisB), pb.dot(axisA));
        return aa - ab;
      });
    const sensorIds = [...nations[ni].childSensors]
      .sort((a, b) => Number(nodes[a]?.abs_pm ?? a) - Number(nodes[b]?.abs_pm ?? b));

    sensorIds.forEach((sensorId, idx) => {
      const pointId = pointIds[idx] ?? sensorId;
      positions[sensorId] = basePositions[pointId].clone().multiplyScalar(SPHERE_R);
    });
  }

  return positions.map((position, i) => position ?? basePositions[i].clone().multiplyScalar(SPHERE_R));
}

function drawCongestionBadge(
  ctx: CanvasRenderingContext2D,
  size: number,
  pct: number,
  _color: THREE.Color,
) {
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.font = `800 ${Math.round(size * 0.28)}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.fillText(`${pct}%`, 0, 0);
  ctx.restore();
}

function getCameraFocusPose(
  sensorPositions: THREE.Vector3[],
  selectedSensor: number,
  distance: number,
) {
  const fallbackDir = new THREE.Vector3(0, 0, 1);
  const selectedPos = selectedSensor >= 0 && selectedSensor < sensorPositions.length
    ? sensorPositions[selectedSensor]
    : null;
  const viewDir = selectedPos ? selectedPos.clone().normalize() : fallbackDir;
  const position = viewDir.clone().multiplyScalar(distance);
  const worldUp = Math.abs(viewDir.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(worldUp, viewDir).normalize();
  const up = new THREE.Vector3().crossVectors(viewDir, side).normalize();
  return { position, up };
}

function orientCameraToSensor(
  camera: THREE.PerspectiveCamera,
  sensorPositions: THREE.Vector3[],
  selectedSensor: number,
  distance: number,
) {
  const { position, up } = getCameraFocusPose(sensorPositions, selectedSensor, distance);
  camera.position.copy(position);
  camera.up.copy(up);
  camera.lookAt(0, 0, 0);
}

function buildSphericalVoronoi(seedPts: THREE.Vector3[]) {
  const seedLL: [number, number][] = seedPts.map(cartToLonLat);
  return geoVoronoi(seedLL).polygons();
}

function relaxedSeedFromFeature(feature: any): THREE.Vector3 {
  const featureCoords = feature.geometry.coordinates[0];
  const uniqueCoords = featureCoords.slice(0, -1);
  const centroid = new THREE.Vector3();

  for (const pt of uniqueCoords) {
    centroid.add(lonLatTo3D(pt[0], pt[1], 1));
  }

  return centroid.normalize().multiplyScalar(SPHERE_R);
}

/* ─────────────────── Road Segment Topology ─────────────────── */

function buildNations(graphData: any, globalLevels: number[]): {
  nations: RegionNation[], 
  sensorPositions: THREE.Vector3[],
  borderEdges: {va: THREE.Vector3, vb: THREE.Vector3}[],
  cellPolygons: THREE.Vector3[][]
} {
  if (!graphData?.nodes?.length) {
    return { nations: [], sensorPositions: [], borderEdges: [], cellPolygons: [] };
  }

  const nodes = graphData.nodes;
  const sensorCount = nodes.length;

  // Road segment grouping: each freeway corridor owns one abstract Voronoi region.
  const segmentIndex = new Map<string, number>();
  const nations: RegionNation[] = [];

  for (let si = 0; si < sensorCount; si++) {
    const meta = getRoadSegmentMeta(nodes[si]);
    let nIdx = segmentIndex.get(meta.key);
    if (nIdx === undefined) {
      nIdx = nations.length;
      segmentIndex.set(meta.key, nIdx);
      nations.push({
        nationIdx: nIdx,
        key: meta.key,
        label: meta.label,
        childSensors: [],
        polygon3D: [],
        centroid3D: new THREE.Vector3(0, 0, 1),
        level: 0,
      });
    }
    nations[nIdx].childSensors.push(si);
  }

  // Keep the previous abstract sphere/Voronoi look, but cluster sensors by segment so regions are contiguous.
  const sensorPositions = buildAbstractSegmentPositions(nations, nodes, sensorCount);

  // 1. Primitive Cells: Generate Voronoi territories
  let polys: any;
  try {
    polys = buildSphericalVoronoi(sensorPositions);
  } catch (e) {
    console.error("[3D] Voronoi failed:", e);
    return { nations: [], sensorPositions: [], borderEdges: [], cellPolygons: [] };
  }

  const features = polys.features;
  const cellPolygons: THREE.Vector3[][] = [];
  for (let i = 0; i < sensorCount; i++) {
    // GeoVoronoi features might not match sensor index 1:1 if coords are identical
    // But we use the features directly from the Voronoi build
    const feat = features[i];
    if (!feat) {
      cellPolygons.push([]);
      continue;
    }
    const ring3D: THREE.Vector3[] = feat.geometry.coordinates[0].slice(0, -1).map((pt: number[]) => 
      lonLatTo3D(pt[0], pt[1], SPHERE_R)
    );
    cellPolygons.push(ring3D);
  }

  for (const n of nations) {
    if (n.childSensors.length === 0) continue;
    let sumLevel = 0;
    const centerMass = new THREE.Vector3();
    for (const id of n.childSensors) {
       sumLevel += (globalLevels[id] ?? 0);
       centerMass.add(sensorPositions[id]);
    }
    n.level = sumLevel / n.childSensors.length;
    n.centroid3D = centerMass.normalize().multiplyScalar(SPHERE_R);
  }

  // 3. Edge-Stitching Algorithm: Identify zigzag outer boundaries
  const edgeMap = new Map<string, {va: THREE.Vector3, vb: THREE.Vector3, nSet: Set<number>}>();
  const getEdgeKey = (va: THREE.Vector3, vb: THREE.Vector3) => {
    // Increase precision to 4 decimals to avoid merging distinct adjacent nodes or failing to match them
    const ha = va.x.toFixed(4) + '|' + va.y.toFixed(4) + '|' + va.z.toFixed(4);
    const hb = vb.x.toFixed(4) + '|' + vb.y.toFixed(4) + '|' + vb.z.toFixed(4);
    return ha < hb ? ha + '#' + hb : hb + '#' + ha;
  };

  for (let i = 0; i < sensorCount; i++) {
    const nIdx = nations.findIndex(n => n.childSensors.includes(i));
    if (nIdx === -1) continue;
    const ring = cellPolygons[i];
    for (let j = 0; j < ring.length; j++) {
      const va = ring[j];
      const vb = ring[(j+1)%ring.length];
      const key = getEdgeKey(va, vb);
      if (!edgeMap.has(key)) edgeMap.set(key, {va, vb, nSet: new Set()});
      edgeMap.get(key)!.nSet.add(nIdx);
    }
  }

  const borderEdges: {va: THREE.Vector3, vb: THREE.Vector3}[] = [];
  Array.from(edgeMap.values()).forEach(val => {
    // If edge falls exactly between two nations, it elevates to being a sovereign boundary line
    if (val.nSet.size > 1) {
       borderEdges.push({va: val.va, vb: val.vb});
    }
  });

  return { nations, sensorPositions, borderEdges, cellPolygons };
}

/* ─────────────────── Three.js Scene Builder ─────────────────── */

function buildScene(
  canvas: HTMLCanvasElement,
  nations: RegionNation[],
  sensorPositions: THREE.Vector3[],
  borderEdges: {va: THREE.Vector3, vb: THREE.Vector3}[],
  cellPolygons: THREE.Vector3[][],
  latestProps: React.MutableRefObject<{
    selectedSensor: number;
    highlightedSensor: number | null;
    globalLevels: number[];
    globalScores?: number[];
    viewMode: PanoramaMode;
    compactOrb?: boolean;
    focusRequestKey?: number;
    snapshotRequestKey?: number;
    onSnapshot?: (dataUrl: string) => void;
    onFocusSettled?: (focusRequestKey: number) => void;
    onLiveReady?: () => void;
    renderFps?: number;
  }>,
  sceneActiveRef: React.MutableRefObject<boolean>,
  onSelectSensor: (idx: number) => void,
  onZoomChange: (dist: number) => void,
  onFpsUpdate?: (fps: number) => void,
): () => void {
  const sensorCount = sensorPositions.length;
  
  // Ensure canvas has valid dimensions
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    console.error('[buildScene] Canvas has zero dimensions!', {
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      offsetWidth: canvas.offsetWidth,
      offsetHeight: canvas.offsetHeight,
    });
    // Return empty cleanup function
    return () => {};
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: Boolean(latestProps.current.onSnapshot),
  });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(getRenderPixelRatio(canvas.clientWidth, canvas.clientHeight));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 50);
  orientCameraToSensor(
    camera,
    sensorPositions,
    latestProps.current.highlightedSensor ?? latestProps.current.selectedSensor,
    DEFAULT_CAMERA_DISTANCE,
  );
  
  const getNationLevel = (nationIdx: number, levels: number[]) => {
    const sensorIds = nations[nationIdx]?.childSensors ?? [];
    if (sensorIds.length === 0) return 0;
    let sum = 0;
    for (const sensorId of sensorIds) sum += levels[sensorId] ?? 0;
    return sum / sensorIds.length;
  };

  // Use TrackballControls instead of OrbitControls to completely eliminate Gimbal Lock at the poles.
  // Trackball allows full 360-degree unconstrained tumbling of the globe.
  const controls = new TrackballControls(camera, canvas);
  controls.noPan = true;
  controls.rotateSpeed = MAX_ROTATE_SPEED;
  controls.zoomSpeed = GLOBE_ZOOM_SPEED;
  controls.minDistance = MIN_CAMERA_DISTANCE;
  controls.maxDistance = MAX_CAMERA_DISTANCE;
  controls.staticMoving = false; // Set to false to enable damping/inertia
  controls.dynamicDampingFactor = 0.12;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xaabbdd, 0.2));
  const dLight = new THREE.DirectionalLight(0x8899cc, 0.4);
  dLight.position.set(5, 3, 5);
  scene.add(dLight);

  /* ── 0. Backface Occluder Sphere ── */
  // An invisible sphere slightly smaller than the main radius that writes to the Depth Buffer
  // This physically blocks any lines/points on the rear hemisphere from being drawn, 
  // while allowing the CSS background 'through' the planet for holographics.
  const occluderGeo = new THREE.SphereGeometry(SPHERE_R - 0.02, 48, 48);
  const occluderMat = new THREE.MeshBasicMaterial({ 
      colorWrite: false, 
      depthWrite: true, 
      transparent: false 
  });
  const occluderMesh = new THREE.Mesh(occluderGeo, occluderMat);
  occluderMesh.renderOrder = -1; // Ensure occluder is drafted into depth buffer before transparent lines
  scene.add(occluderMesh);

  /* ── 1. Inject 3D Floating Segment Labels ── */
  const regionLabels: {
    congestionMesh: THREE.Mesh,
    segmentMesh: THREE.Mesh,
    basePos: THREE.Vector3,
    segmentPos: THREE.Vector3,
    segmentQuat: THREE.Quaternion,
    upDir: THREE.Vector3,
    nIdx: number,
    congestionTexture: THREE.CanvasTexture,
    congestionMaterial: THREE.MeshBasicMaterial,
    congestionCtx: CanvasRenderingContext2D,
    lastPct: number,
    segmentTexture: THREE.CanvasTexture,
    segmentMaterial: THREE.MeshBasicMaterial,
    segmentCtx: CanvasRenderingContext2D,
    lastLabel: string,
    // 当前透明度（用于平滑过渡）
    currentCongestionOpacity: number,
    currentSegmentOpacity: number,
  }[] = [];
  const maxRegionSensorCount = Math.max(1, ...nations.map((nation) => nation.childSensors.length));
  
  const drawSegmentLabel = (
    ctx: CanvasRenderingContext2D,
    size: number,
    label: string,
  ) => {
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.font = `800 ${Math.round(size * 0.17)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 12;
    ctx.fillText(label, 0, 0, size * 0.82);
    ctx.restore();
  };
  
  for (let i = 0; i < nations.length; i++) {
      const n = nations[i];
      const areaRatio = Math.sqrt(n.childSensors.length / maxRegionSensorCount);
      const congestionLabelScale = THREE.MathUtils.lerp(0.42, 0.78, areaRatio);
      const segmentLabelScale = THREE.MathUtils.lerp(0.46, 0.92, areaRatio);
      
      const geo = new THREE.PlaneGeometry(1, 1);
      
      const upDir = n.centroid3D.clone().normalize();
      const basePos = upDir.clone().multiplyScalar(SPHERE_R + 0.12);
      const segmentPos = upDir.clone().multiplyScalar(SPHERE_R + 0.055);
      const segmentQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), upDir);

      const congestionCanvas = document.createElement('canvas');
      congestionCanvas.width = 512;
      congestionCanvas.height = 512;
      const congestionCtx = congestionCanvas.getContext('2d')!;
      const congestionTexture = new THREE.CanvasTexture(congestionCanvas);
      congestionTexture.minFilter = THREE.LinearFilter;
      const initialNationLevel = getNationLevel(i, latestProps.current.globalLevels);
      const initialPct = congestionPercentFromSensors(n.childSensors, latestProps.current.globalLevels, latestProps.current.globalScores);
      const initialColor = levelToPulseColor(initialNationLevel);
      drawCongestionBadge(congestionCtx, 512, initialPct, initialColor);
      congestionTexture.needsUpdate = true;
      const congestionMaterial = new THREE.MeshBasicMaterial({
        map: congestionTexture,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true,
      });
      const congestionMesh = new THREE.Mesh(geo, congestionMaterial);
      congestionMesh.scale.set(congestionLabelScale, congestionLabelScale, 1.0);
      congestionMesh.position.copy(basePos);
      
      const segmentCanvas = document.createElement('canvas');
      segmentCanvas.width = 512;
      segmentCanvas.height = 512;
      const segmentCtx = segmentCanvas.getContext('2d')!;
      const segmentTexture = new THREE.CanvasTexture(segmentCanvas);
      segmentTexture.minFilter = THREE.LinearFilter;
      drawSegmentLabel(segmentCtx, 512, n.label);
      segmentTexture.needsUpdate = true;
      const segmentMaterial = new THREE.MeshBasicMaterial({
        map: segmentTexture,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const segmentMesh = new THREE.Mesh(geo, segmentMaterial);
      segmentMesh.scale.set(segmentLabelScale, segmentLabelScale, 1.0);
      segmentMesh.position.copy(segmentPos);
      segmentMesh.quaternion.copy(segmentQuat);
      segmentMesh.renderOrder = 8;
      
      scene.add(congestionMesh);
      scene.add(segmentMesh);
      regionLabels.push({
        congestionMesh,
        segmentMesh,
        basePos,
        segmentPos,
        segmentQuat,
        upDir,
        nIdx: i,
        congestionTexture,
        congestionMaterial,
        congestionCtx,
        lastPct: initialPct,
        segmentTexture,
        segmentMaterial,
        segmentCtx,
        lastLabel: n.label,
        currentCongestionOpacity: 0,
        currentSegmentOpacity: 0,
      });
  }

  /* ── 1. Render Invisible Faces & True Geographical Borders ── */
  const faceVerts: number[] = [];
  const faceColors: number[] = [];
  const borderVerts: number[] = [];
  const faceToSensor: number[] = []; // Array that maps triangle index to sensor ID
  const sensorToNation: number[] = new Array(sensorCount).fill(-1);

  for (let ni = 0; ni < nations.length; ni++) {
    for (const si of nations[ni].childSensors) {
      sensorToNation[si] = ni;
    }
  }

  for (let i = 0; i < cellPolygons.length; i++) {
    const ring = cellPolygons[i];
    
    const sensorLevel = latestProps.current.globalLevels[i] ?? 0;
    const col = levelToNodeColor(sensorLevel);

    // Any generic polygon can be drawn by fanning triangles from the 0-th vertex
    for (let j = 1; j < ring.length - 1; j++) {
        faceVerts.push(ring[0].x, ring[0].y, ring[0].z, ring[j].x, ring[j].y, ring[j].z, ring[j+1].x, ring[j+1].y, ring[j+1].z);
        faceColors.push(col.r, col.g, col.b, 0, col.r, col.g, col.b, 0, col.r, col.g, col.b, 0);
        faceToSensor.push(i); // Map this triangle to the i-th sensor node
    }
  }

  // Safely interpolate exactly on edge
  for (const edge of borderEdges) {
    const SEGMENTS = 8;
    let prevPt = edge.va.clone();
    for (let step = 1; step <= SEGMENTS; step++) {
        const t = step / SEGMENTS;
        const nextPt = edge.va.clone().lerp(edge.vb, t).normalize().multiplyScalar(SPHERE_R);
        borderVerts.push(prevPt.x, prevPt.y, prevPt.z, nextPt.x, nextPt.y, nextPt.z);
        prevPt = nextPt;
    }
  }

  // Face Geometry (Invisible intentionally)
  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(faceVerts, 3));
  const faceColorAttr = new THREE.Float32BufferAttribute(faceColors, 4);
  faceGeo.setAttribute('color', faceColorAttr);
  faceGeo.computeVertexNormals();
  const faceMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mapMesh = new THREE.Mesh(faceGeo, faceMat);
  scene.add(mapMesh);

  // Border Lines (12 Country Borders)
  const borderGeo = new THREE.BufferGeometry();
  borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(borderVerts, 3));
  const borderMat = new THREE.LineBasicMaterial({ color: 0x556677, transparent: true, opacity: 0.5 });
  const mapLines = new THREE.LineSegments(borderGeo, borderMat);
  scene.add(mapLines);

  /* ── 2. Sensor Nodes (Surface Rings) ── */
  const nodeGeo = new THREE.RingGeometry(0.58, 1.0, 24);
  const nodeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, sensorCount);
  nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(nodeMesh);

  // Dedicated green accent ring that hugs the highlighted node's outer edge
  const focusRingGeo = new THREE.RingGeometry(1.05, 1.22, 32);
  const focusRingMat = new THREE.MeshBasicMaterial({
    color: 0x4ade80,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });
  const focusRingMesh = new THREE.Mesh(focusRingGeo, focusRingMat);
  focusRingMesh.visible = false;
  scene.add(focusRingMesh);

  // Distribute specific location matrices
  const dummy = new THREE.Object3D();
  const nodeCurrentColors = Array.from({ length: sensorCount }, () => new THREE.Color(0x000000));
  const nodeTargetColors = Array.from({ length: sensorCount }, () => new THREE.Color(0x000000));
  const nodeCurrentScales = new Float32Array(sensorCount);
  const nodeTargetScales = new Float32Array(sensorCount);
  const sensorFaceColors = Array.from({ length: sensorCount }, () => new THREE.Color());
  const sensorFaceAlphas = new Float32Array(sensorCount);
  const nodeNormal = new THREE.Vector3();
  const nodeBaseQuat = new THREE.Quaternion();
  const pulseColor = new THREE.Color();
  const sensorPulseAngles = new Float32Array(sensorCount);
  const sensorOverlayMix = new Float32Array(sensorCount).fill(latestProps.current.viewMode === 'congestion' ? 1 : 0);
  const sensorOverlayStartMix = new Float32Array(sensorCount).fill(latestProps.current.viewMode === 'congestion' ? 1 : 0);
  let hoveredNation = -1;
  let hoveredSensor = -1;
  let activeSelectedSensor = latestProps.current.selectedSensor;
  let activeHighlightedSensor = latestProps.current.highlightedSensor ?? -1;
  let activeFocusSensor = latestProps.current.highlightedSensor ?? latestProps.current.selectedSensor;
  let activeViewMode = latestProps.current.viewMode;
  let activeGlobalLevels = latestProps.current.globalLevels;
  let activeFocusRequestKey = latestProps.current.focusRequestKey ?? 0;
  let activeSnapshotRequestKey = latestProps.current.snapshotRequestKey ?? 0;
  let pendingFocusSettledKey: number | null = null;
  let liveReadyReported = false;
  let pulseOriginSensor = activeFocusSensor;
  let pulseElapsed = 0;
  // 加快脉冲速度
  let pulseTravelDuration = 1.2;
  let pulseRiseDuration = 0.08;
  let pulseHoldDuration = 0.3;
  let pulseFadeDuration = 0.6;
  let pulseMaxAngle = Math.PI;
  let pulseAngularSpeed = Math.PI / pulseTravelDuration;
  let congestionTransitionElapsed = 0;
  let congestionTransitionTarget = latestProps.current.viewMode === 'congestion' ? 1 : 0;
  let congestionTransitionActive = false;
  let congestionTileTransitionDuration = 0.9;
  
  // 国界线亮度过渡（时空模式专用）
  let borderBrightness = 0.5; // 0.5 = 正常，1.0 = 高亮（白色）
  let borderBrightnessTarget = latestProps.current.viewMode === 'segment' ? 1.0 : 0.5;
  let borderBrightnessTransitionDuration = 0.6;
  let faceColorsNeedUpdate = true;
  let pointerInside = false;
  let hoverNeedsUpdate = false;
  
  // 智能过渡系统：记录上一次切换的时间，避免快速连续切换导致的跳跃
  let lastModeSwitchTime = 0;
  let minSwitchInterval = 0.3; // 最小切换间隔（秒）
  const cameraTargetDir = camera.position.clone().normalize();
  const cameraTargetUp = camera.up.clone();
  let cameraTargetDistance = camera.position.length();
  const cameraFocusStartDir = cameraTargetDir.clone();
  const cameraFocusStartUp = cameraTargetUp.clone();
  const cameraFocusRotation = new THREE.Quaternion();
  const cameraFocusStepRotation = new THREE.Quaternion();
  let cameraFocusStartDistance = cameraTargetDistance;
  let cameraFocusElapsed = 0;
  let cameraFocusDuration = CAMERA_FOCUS_MIN_DURATION;
  let cameraFocusTransitionActive = false;

  const settleCameraFocus = () => {
    camera.position.copy(cameraTargetDir).multiplyScalar(cameraTargetDistance);
    camera.up.copy(cameraTargetUp);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    cameraFocusTransitionActive = false;
    if (pendingFocusSettledKey !== null) {
      latestProps.current.onFocusSettled?.(pendingFocusSettledKey);
      pendingFocusSettledKey = null;
    }
  };

  const startCameraFocusTransition = (
    targetDir: THREE.Vector3,
    targetUp: THREE.Vector3,
    targetDistance: number,
    settleKey: number | null,
  ) => {
    cameraTargetDir.copy(targetDir).normalize();
    cameraTargetUp.copy(targetUp).normalize();
    cameraTargetDistance = targetDistance;
    pendingFocusSettledKey = settleKey;

    const currentDir = camera.position.clone().normalize();
    const currentUp = camera.up.clone().normalize();
    const currentDistance = camera.position.length();
    const angleDelta = angularDistance(currentDir, cameraTargetDir);
    const upDelta = currentUp.distanceTo(cameraTargetUp);
    const distanceDelta = Math.abs(currentDistance - cameraTargetDistance);

    if (
      angleDelta < CAMERA_FOCUS_SNAP_ANGLE &&
      upDelta < CAMERA_FOCUS_SNAP_UP_DISTANCE &&
      distanceDelta < CAMERA_DISTANCE_DONE_EPS
    ) {
      settleCameraFocus();
      return;
    }

    cameraFocusStartDir.copy(currentDir);
    cameraFocusStartUp.copy(currentUp);
    cameraFocusRotation.setFromUnitVectors(cameraFocusStartDir, cameraTargetDir);
    cameraFocusStartDistance = currentDistance;
    cameraFocusElapsed = 0;
    cameraFocusDuration = THREE.MathUtils.clamp(
      Math.max(
        angleDelta / CAMERA_FOCUS_ANGULAR_SPEED,
        distanceDelta / CAMERA_FOCUS_DISTANCE_SPEED,
        upDelta / CAMERA_FOCUS_UP_SPEED,
      ),
      CAMERA_FOCUS_MIN_DURATION,
      CAMERA_FOCUS_MAX_DURATION,
    );
    cameraFocusTransitionActive = true;
  };

  const setPulseOrigin = (originSensor: number) => {
    pulseOriginSensor = originSensor >= 0 && originSensor < sensorCount ? originSensor : 0;
    pulseMaxAngle = 0.001;

    const originPos = sensorPositions[pulseOriginSensor]?.clone().normalize() ?? new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < sensorCount; i++) {
      const targetPos = sensorPositions[i]?.clone().normalize() ?? originPos;
      const dot = THREE.MathUtils.clamp(originPos.dot(targetPos), -1, 1);
      const angle = Math.acos(dot);
      sensorPulseAngles[i] = angle;
      if (angle > pulseMaxAngle) pulseMaxAngle = angle;
    }
    pulseAngularSpeed = pulseMaxAngle / Math.max(pulseTravelDuration, 0.001);
  };

  const resetPulse = (originSensor: number) => {
    // 如果脉冲正在进行中，不要完全重置，而是从当前状态继续
    // 这样可以避免快速切换时的跳跃感
    if (pulseElapsed > 0 && pulseElapsed < pulseRiseDuration + pulseHoldDuration + pulseFadeDuration) {
      // 脉冲正在进行，只更新原点，不重置时间
      setPulseOrigin(originSensor);
    } else {
      // 脉冲已结束或未开始，正常重置
      pulseElapsed = 0;
      setPulseOrigin(originSensor);
    }
  };

  const startCongestionTransition = (originSensor: number, nextViewMode: PanoramaMode) => {
    const newTarget = nextViewMode === 'congestion' ? 1 : 0;
    
    // 更新国界线亮度目标
    borderBrightnessTarget = nextViewMode === 'segment' ? 1.0 : 0.5;
    
    // 如果正在过渡中且目标方向相反，智能反转而不是重置
    if (congestionTransitionActive && congestionTransitionTarget !== newTarget) {
      // 计算当前进度（0-1）
      const currentProgress = congestionTransitionElapsed / congestionTileTransitionDuration;
      
      // 反转目标
      congestionTransitionTarget = newTarget;
      
      // 从当前状态继续，而不是重置
      // 使用当前的实际混合值作为新的起点
      for (let i = 0; i < sensorCount; i++) {
        sensorOverlayStartMix[i] = sensorOverlayMix[i];
      }
      
      // 根据当前进度调整剩余时间，让反转更平滑
      congestionTransitionElapsed = 0;
      
      // 更新脉冲原点
      setPulseOrigin(originSensor);
    } else if (!congestionTransitionActive || congestionTransitionTarget !== newTarget) {
      // 新的过渡或相同方向的过渡
      setPulseOrigin(originSensor);
      congestionTransitionElapsed = 0;
      congestionTransitionTarget = newTarget;
      congestionTransitionActive = true;
      for (let i = 0; i < sensorCount; i++) {
        sensorOverlayStartMix[i] = sensorOverlayMix[i];
      }
    }
  };

  const updateNodes = () => {
    const { selectedSensor, highlightedSensor, globalLevels } = latestProps.current;

    for (let i = 0; i < sensorCount; i++) {
        const nationId = sensorToNation[i];
        const isInHoveredNation = nationId !== -1 && nationId === hoveredNation;
        const isHoveredNode = i === hoveredSensor;
        const isTargeted = i === selectedSensor;
        const isHighlighted = highlightedSensor === i;

        // Node specific congestion color
        const level = globalLevels[i] ?? 0;
        if (isHighlighted && !isTargeted) {
            nodeTargetScales[i] = 0.05;
            nodeTargetColors[i].copy(levelToNodeColor(level));
        } else if (isTargeted) {
            nodeTargetScales[i] = 0.07;
            nodeTargetColors[i].set(0x00ffff);
        } else if (isHoveredNode) {
            nodeTargetScales[i] = 0.05;
            nodeTargetColors[i].set(0xffffff);
        } else if (isInHoveredNation) {
            nodeTargetScales[i] = 0.028;
            nodeTargetColors[i].copy(levelToNodeColor(level));
        } else {
            nodeTargetScales[i] = 0.0001;
            nodeTargetColors[i].set(0x000000);
        }
    }
  };
  updateNodes(); // initial
  setPulseOrigin(activeFocusSensor);
  pulseElapsed = 0; // 从0开始，让脉冲可见

  /* ── Raycaster Click Logic ── */
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const mousedownPos = { x: 0, y: 0 };
  const markHoverDirty = () => {
    if (!pointerInside) return;
    hoverNeedsUpdate = true;
  };

  const handlePointer = (e: MouseEvent | { clientX: number, clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
  };

  const onMouseDown = (e: MouseEvent) => {
    mousedownPos.x = e.clientX;
    mousedownPos.y = e.clientY;
  };
  canvas.addEventListener('mousedown', onMouseDown);

  const onClick = (e: MouseEvent) => {
    // DRAG vs CLICK: Calculate pixel distance moved
    const dx = e.clientX - mousedownPos.x;
    const dy = e.clientY - mousedownPos.y;
    const moveDist = Math.sqrt(dx * dx + dy * dy);

    // If moved more than 5 pixels, assume it's a drag rotation, not a selection click
    if (moveDist > 5) return;

    handlePointer(e);
    // Raycast against the mapMesh surface to find the node index reliably
    const hits = raycaster.intersectObject(mapMesh);
    if (hits.length > 0 && hits[0].faceIndex !== undefined) {
      const sensorIdx = faceToSensor[hits[0].faceIndex];
      if (sensorIdx !== undefined) {
          // PRECISION FIX: Check if the click point is actually near the node centroid
          const distToNode = hits[0].point.distanceTo(sensorPositions[sensorIdx]);
          if (distToNode < 0.15) {
              onSelectSensor(sensorIdx);
          }
      }
    }
  };
  canvas.addEventListener('click', onClick);

  const onMouseMove = (e: MouseEvent) => {
    pointerInside = true;
    hoverNeedsUpdate = true;
    handlePointer(e);
  };
  canvas.addEventListener('mousemove', onMouseMove);
  controls.addEventListener('change', markHoverDirty);

  const onMouseLeave = () => {
    pointerInside = false;
    hoverNeedsUpdate = false;
    hoveredNation = -1;
    hoveredSensor = -1;
    updateNodes();
  };
  canvas.addEventListener('mouseleave', onMouseLeave);

  /* ── Resize handler ── */
  let renderWidth = 0;
  let renderHeight = 0;
  const onResize = () => {
    const w = Math.max(1, Math.floor(canvas.clientWidth));
    const h = Math.max(1, Math.floor(canvas.clientHeight));
    if (w === renderWidth && h === renderHeight) return;
    renderWidth = w;
    renderHeight = h;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(getRenderPixelRatio(w, h));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    controls.handleResize();
    markHoverDirty();
  };
  window.addEventListener('resize', onResize);
  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(onResize)
    : null;
  resizeObserver?.observe(canvas);
  if (canvas.parentElement) resizeObserver?.observe(canvas.parentElement);
  onResize();

  /* ── Atmospheric Global Shell (Average of all 12 as a base) ── */
  // Removed: atmospheric shell with scanning rings - now using clean transparent globe
  const atmGeo = new THREE.SphereGeometry(SPHERE_R + 0.005, 48, 48);
  const atmMat = new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    opacity: 0,
  });
  const atmMesh = new THREE.Mesh(atmGeo, atmMat);
  scene.add(atmMesh);

  /* ── Planetary Edge Glow (Space Halo) ── */
  const haloGeo = new THREE.SphereGeometry(SPHERE_R + 0.12, 64, 64);
  const haloMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMode: { value: latestProps.current.viewMode === 'congestion' ? 1.0 : 0.0 }
    },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      uniform float uMode;
      void main() {
        // High intensity right on the grazing edge, dropping quickly towards center
        float intensity = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.5);
        vec3 blueGlow = vec3(0.08, 0.35, 0.65);
        vec3 neutralGlow = vec3(0.3, 0.32, 0.35);
        vec3 finalGlow = mix(neutralGlow, blueGlow, uMode);
        gl_FragColor = vec4(finalGlow, intensity);
      }
    `,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  scene.add(haloMesh);

  /* ── Render & LOD Loop ── */
  let animId = 0;
  let elapsed = 0;
  let lastFrame = performance.now();
  let lastRenderAt = 0;
  let fpsLastSampleAt = lastFrame;
  let fpsFrames = 0;
  let lastDist = camera.position.length(); // 使用实际相机距离初始化
  let initialZoomReported = false; // 标记是否已报告初始缩放

  const animate = () => {
    animId = requestAnimationFrame(animate);
    const now = performance.now();
    if (!sceneActiveRef.current) {
      if (fpsFrames !== 0) {
        fpsFrames = 0;
        fpsLastSampleAt = now;
        onFpsUpdate?.(0);
      }
      lastFrame = now;
      return;
    }

    const targetFps = Number(latestProps.current.renderFps ?? 0);
    const minFrameMs = Number.isFinite(targetFps) && targetFps > 0 ? 1000 / targetFps : 0;
    if (minFrameMs > 0 && lastRenderAt > 0 && now - lastRenderAt < minFrameMs) return;
    lastRenderAt = now;

    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    elapsed += dt;

    fpsFrames += 1;
    if (onFpsUpdate && now - fpsLastSampleAt >= 250) {
      const sampledFps = (fpsFrames * 1000) / Math.max(now - fpsLastSampleAt, 1);
      onFpsUpdate(Math.round(sampledFps));
      fpsFrames = 0;
      fpsLastSampleAt = now;
    }
    
    // Zoomed-in views need finer rotation control to avoid overshooting small regions.
    const controlDist = camera.position.length();
    const zoomFactor = THREE.MathUtils.clamp(
      (controlDist - MIN_CAMERA_DISTANCE) / (MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE),
      0,
      1,
    );
    controls.rotateSpeed = THREE.MathUtils.lerp(MIN_ROTATE_SPEED, MAX_ROTATE_SPEED, zoomFactor);
    controls.update();
    const dist = camera.position.length();
    
    // 第一帧立即报告初始缩放级别，避免UI突变
    if (!initialZoomReported) {
      onZoomChange(dist);
      initialZoomReported = true;
      lastDist = dist;
    } else if (Math.abs(dist - lastDist) > 0.05) {
      // 后续帧：只有距离变化超过阈值才更新
      lastDist = dist;
      onZoomChange(dist);
    }
    
    let newHoverNation = -1;
    let newHoveredSensor = -1;
    if (hoverNeedsUpdate && pointerInside) {
      const hits = raycaster.intersectObject(mapMesh);
      if (hits.length > 0 && hits[0].faceIndex !== undefined) {
          const sIdx = faceToSensor[hits[0].faceIndex];
          if (sIdx !== undefined) {
              // BROAD HOVER: Any territory hit triggers the nation-wide scan
              newHoverNation = sensorToNation[sIdx];
              if (hits[0].point.distanceTo(sensorPositions[sIdx]) < 0.15) {
                newHoveredSensor = sIdx;
              }
          }
      }
      hoverNeedsUpdate = false;
    } else {
      newHoverNation = hoveredNation;
      newHoveredSensor = hoveredSensor;
    }
    
    const { selectedSensor, highlightedSensor, viewMode } = latestProps.current;
    const normalizedHighlighted = highlightedSensor ?? -1;
    const focusSensor = highlightedSensor ?? selectedSensor;
    const focusRequestKey = latestProps.current.focusRequestKey ?? 0;
    const sensorChanged = selectedSensor !== activeSelectedSensor;
    const highlightedChanged = normalizedHighlighted !== activeHighlightedSensor;
    const focusChanged = focusSensor !== activeFocusSensor;
    const focusRequested = focusRequestKey !== activeFocusRequestKey;
    const modeChanged = viewMode !== activeViewMode;
    const levelsChanged = latestProps.current.globalLevels !== activeGlobalLevels;
    if (
      newHoverNation !== hoveredNation ||
      newHoveredSensor !== hoveredSensor ||
      sensorChanged ||
      highlightedChanged ||
      focusChanged ||
      focusRequested ||
      modeChanged ||
      levelsChanged
    ) {
        hoveredNation = newHoverNation;
        hoveredSensor = newHoveredSensor;
        updateNodes();
        if (viewMode === 'segment') {
          faceColorsNeedUpdate = true;
        }
        if (levelsChanged) {
          activeGlobalLevels = latestProps.current.globalLevels;
          faceColorsNeedUpdate = true;
        }
        if (modeChanged) {
          // 智能过渡：检查距离上次切换的时间
          const timeSinceLastSwitch = elapsed - lastModeSwitchTime;
          
          if (timeSinceLastSwitch < minSwitchInterval && congestionTransitionActive) {
            // 快速连续切换：使用智能反转
            startCongestionTransition(focusSensor, viewMode);
          } else {
            // 正常切换
            startCongestionTransition(focusSensor, viewMode);
            resetPulse(focusSensor);
          }
          
          lastModeSwitchTime = elapsed;
          faceColorsNeedUpdate = true;
        } else if ((sensorChanged || highlightedChanged || focusChanged) && activeViewMode === 'segment' && !congestionTransitionActive && congestionTransitionTarget === 0) {
          faceColorsNeedUpdate = true;
        }
        if (focusChanged || focusRequested) {
          const targetDistance = focusRequested ? DEFAULT_CAMERA_DISTANCE : camera.position.length();
          const nextPose = getCameraFocusPose(sensorPositions, focusSensor, targetDistance);
          startCameraFocusTransition(
            nextPose.position,
            nextPose.up,
            targetDistance,
            focusRequested ? focusRequestKey : null,
          );
        }
        activeSelectedSensor = selectedSensor;
        activeHighlightedSensor = normalizedHighlighted;
        activeFocusSensor = focusSensor;
        activeFocusRequestKey = focusRequestKey;
        activeViewMode = viewMode;
    }

    // ── Polygon Face State ──
    pulseElapsed += dt;
    const pulseTotalDuration = pulseTravelDuration + pulseRiseDuration + pulseHoldDuration + pulseFadeDuration;
    const pulseActive = pulseElapsed <= pulseTotalDuration;
    if (congestionTransitionActive) {
      congestionTransitionElapsed += dt;
      let transitionDone = true;
      for (let i = 0; i < sensorCount; i++) {
        const arrivalTime = sensorPulseAngles[i] / Math.max(pulseAngularSpeed, 0.001);
        const localTransitionElapsed = congestionTransitionElapsed - arrivalTime;
        let nextMix = sensorOverlayStartMix[i];
        if (localTransitionElapsed > 0) {
          // 使用平滑的缓动函数（ease-in-out）
          const rawProgress = THREE.MathUtils.clamp(localTransitionElapsed / congestionTileTransitionDuration, 0, 1);
          // Smoothstep 缓动：3t² - 2t³
          const smoothProgress = rawProgress * rawProgress * (3 - 2 * rawProgress);
          nextMix = THREE.MathUtils.lerp(sensorOverlayStartMix[i], congestionTransitionTarget, smoothProgress);
        }
        sensorOverlayMix[i] = nextMix;
        if (Math.abs(nextMix - congestionTransitionTarget) > 0.001) transitionDone = false;
      }
      if (transitionDone) {
        congestionTransitionActive = false;
        for (let i = 0; i < sensorCount; i++) {
          sensorOverlayMix[i] = congestionTransitionTarget;
        }
      }
    } else {
      if (faceColorsNeedUpdate) {
        for (let i = 0; i < sensorCount; i++) {
          sensorOverlayMix[i] = congestionTransitionTarget;
        }
      }
    }
    
    // Smoothly update shader mode uniform
    const curUMode = 0;
    const targetUMode = (congestionTransitionTarget > 0.5 || congestionTransitionActive) ? 1.0 : 0.0;
    haloMat.uniforms.uMode.value = THREE.MathUtils.lerp(curUMode, targetUMode, 0.1);

    if (congestionTransitionActive) {
      faceColorsNeedUpdate = true;
    }
    if (faceColorsNeedUpdate || pulseActive) {
      for (let sensorIdx = 0; sensorIdx < sensorCount; sensorIdx++) {
        const sensorLevel = latestProps.current.globalLevels[sensorIdx] ?? 0;
        let alpha = 0;
        const nationId = sensorToNation[sensorIdx];
        const angle = sensorPulseAngles[sensorIdx] ?? pulseMaxAngle;
        const arrivalTime = angle / Math.max(pulseAngularSpeed, 0.001);
        const localPulseElapsed = pulseElapsed - arrivalTime;
        const congestionMix = THREE.MathUtils.clamp(sensorLevel / 3.0, 0, 1);
        const overlayMix = THREE.MathUtils.clamp(sensorOverlayMix[sensorIdx], 0, 1);
        const segmentMix = 1 - overlayMix;

        // 计算脉冲混合度
        let pulseMix = 0;
        let saturation = 1.0;

        if (localPulseElapsed > 0) {
          if (localPulseElapsed < pulseRiseDuration) {
            pulseMix = localPulseElapsed / pulseRiseDuration;
          } else if (localPulseElapsed < pulseRiseDuration + pulseHoldDuration) {
            pulseMix = 1.0;
          } else if (localPulseElapsed < pulseRiseDuration + pulseHoldDuration + pulseFadeDuration) {
            const fadeProgress = (localPulseElapsed - pulseRiseDuration - pulseHoldDuration) / pulseFadeDuration;
            pulseMix = 1.0 - fadeProgress;
            saturation = THREE.MathUtils.lerp(1.0, 0.12, fadeProgress);
          }
        }

        // 脉冲颜色：根据拥堵级别选择
        const basePulseCol = sensorFaceColors[sensorIdx];
        if (sensorLevel >= 3) {
          // 严重拥堵：红色
          basePulseCol.set(0xff5a4f);
        } else if (sensorLevel >= 2) {
          // 高拥堵：橙色
          basePulseCol.set(0xe37b38);
        } else if (sensorLevel >= 1) {
          // 中等拥堵：黄色
          basePulseCol.set(0xc7a546);
        } else {
          // 正常：明亮的蓝色，使用传感器索引生成不同的蓝色调
          const hue = 0.52 + ((sensorIdx * 73) % 100) * 0.0018; // 蓝色范围 0.52-0.70
          const sat = 0.75 + ((sensorIdx * 37) % 100) * 0.002; // 饱和度 0.75-0.95
          const light = 0.55 + ((sensorIdx * 59) % 100) * 0.0015; // 亮度 0.55-0.70
          basePulseCol.setHSL(hue, sat, light);
        }

        withSaturation(basePulseCol, saturation, pulseColor);
        basePulseCol.copy(pulseColor);

        const segmentHue = ((Math.max(0, nationId) * 0.61803398875) % 1 + 1) % 1;
        pulseColor.setHSL(segmentHue, 0.42, 0.34);
        basePulseCol.lerp(pulseColor, segmentMix);

        const congestionAlpha = overlayMix * (0.08 + congestionMix * 0.3 + pulseMix * 0.25);
        const segmentAlpha = nationId === hoveredNation ? 0.32 : 0.2;
        alpha = THREE.MathUtils.lerp(congestionAlpha, segmentAlpha, segmentMix);

        sensorFaceAlphas[sensorIdx] = alpha;
      }

      for (let triIdx = 0; triIdx < faceToSensor.length; triIdx++) {
        const sensorIdx = faceToSensor[triIdx];
        const sensorColor = sensorFaceColors[sensorIdx];
        const alpha = sensorFaceAlphas[sensorIdx];
        for (let v = 0; v < 3; v++) {
          const base = triIdx * 12 + v * 4;
          faceColorAttr.array[base] = sensorColor.r;
          faceColorAttr.array[base + 1] = sensorColor.g;
          faceColorAttr.array[base + 2] = sensorColor.b;
          faceColorAttr.array[base + 3] = alpha;
        }
      }
      faceColorsNeedUpdate = congestionTransitionActive || pulseActive;
      faceColorAttr.needsUpdate = true;
    }

    if (cameraFocusTransitionActive) {
      cameraFocusElapsed += dt;
      const progress = THREE.MathUtils.clamp(cameraFocusElapsed / Math.max(cameraFocusDuration, 0.001), 0, 1);
      const eased = easeOutCubic(progress);
      cameraFocusStepRotation.identity().slerp(cameraFocusRotation, eased);
      const nextDir = cameraFocusStartDir.clone().applyQuaternion(cameraFocusStepRotation);
      const nextDistance = THREE.MathUtils.lerp(cameraFocusStartDistance, cameraTargetDistance, eased);
      if (nextDir.lengthSq() > 0.000001) {
        camera.position.copy(nextDir.normalize().multiplyScalar(nextDistance));
      }
      camera.up.copy(cameraFocusStartUp).lerp(cameraTargetUp, eased).normalize();
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
      if (
        progress >= 1 ||
        (
          camera.position.clone().normalize().distanceToSquared(cameraTargetDir) < CAMERA_FOCUS_DONE_EPS_SQ &&
          camera.up.distanceToSquared(cameraTargetUp) < CAMERA_FOCUS_DONE_EPS_SQ &&
          Math.abs(camera.position.length() - cameraTargetDistance) < CAMERA_DISTANCE_DONE_EPS
        )
      ) {
        settleCameraFocus();
      }
    }

    // ── Animate 2D Surface Rings ──
    for (let i = 0; i < sensorCount; i++) {
       const p = sensorPositions[i];
       nodeNormal.copy(p).normalize();
       nodeCurrentScales[i] = THREE.MathUtils.lerp(nodeCurrentScales[i], nodeTargetScales[i], 0.16);
       nodeCurrentColors[i].lerp(nodeTargetColors[i], 0.16);

       const isHighlighted = i === (latestProps.current.highlightedSensor ?? -1);
       const isTargeted = i === latestProps.current.selectedSensor;
       const isHoveredNode = i === hoveredSensor;
       const pulse = isHighlighted
         ? 1.0 + Math.sin(elapsed * 5.2) * 0.12
         : isTargeted
          ? 1.0 + Math.sin(elapsed * 4.5) * 0.08
          : isHoveredNode
            ? 1.0 + Math.sin(elapsed * 7.0) * 0.06
           : 1.0;

       dummy.position.copy(p).addScaledVector(nodeNormal, 0.006);
       dummy.scale.setScalar(nodeCurrentScales[i] * pulse);
       nodeBaseQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nodeNormal);
       dummy.quaternion.copy(nodeBaseQuat);
       dummy.updateMatrix();
       nodeMesh.setMatrixAt(i, dummy.matrix);
       nodeMesh.setColorAt(i, nodeCurrentColors[i]);
    }
    nodeMesh.instanceMatrix.needsUpdate = true;
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;

    // ── Update Dedicated Highlight Ring Mesh ──
    const activeHighlightIdx = latestProps.current.highlightedSensor ?? -1;
    if (activeHighlightIdx !== -1 && activeHighlightIdx < sensorPositions.length) {
      const p = sensorPositions[activeHighlightIdx];
      const norm = p.clone().normalize();
      focusRingMesh.position.copy(p).addScaledVector(norm, 0.008);
      focusRingMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), norm);
      const focusPulse = 1.0 + Math.sin(elapsed * 5.2) * 0.12;
      const focusScale = Math.max(nodeCurrentScales[activeHighlightIdx], 0.05) * focusPulse;
      focusRingMesh.scale.setScalar(focusScale);
      focusRingMesh.visible = true;
    } else {
      focusRingMesh.visible = false;
    }

    // ── Update 3D Floating Road Segment Labels ──
    for (const wi of regionLabels) {
       const nationLevel = getNationLevel(wi.nIdx, latestProps.current.globalLevels);
        const pct = congestionPercentFromSensors(nations[wi.nIdx]?.childSensors ?? [], latestProps.current.globalLevels, latestProps.current.globalScores);
       if (pct !== wi.lastPct) {
         drawCongestionBadge(wi.congestionCtx, 512, pct, levelToNodeColor(nationLevel));
         wi.congestionTexture.needsUpdate = true;
         wi.lastPct = pct;
       }
       const currentLabel = nations[wi.nIdx]?.label ?? '未知路段';
       if (currentLabel !== wi.lastLabel) {
         drawSegmentLabel(wi.segmentCtx, 512, currentLabel);
         wi.segmentTexture.needsUpdate = true;
         wi.lastLabel = currentLabel;
       }
       
        // 2. Congestion stays billboarded; segment labels are fixed to the globe surface.
        wi.congestionMesh.position.copy(wi.basePos);
        wi.segmentMesh.position.copy(wi.segmentPos);
        wi.congestionMesh.quaternion.copy(camera.quaternion);
        wi.segmentMesh.quaternion.copy(wi.segmentQuat);
       
       // 3. Direct crossfade between congestion and segment ownership overlays
       const iconOp = Math.max(0, Math.min(1, (dist - 4.5) / 2.0)) * 0.9;
       const currentMode = latestProps.current.viewMode;
       const compactOrb = latestProps.current.compactOrb ?? false;
       
       // 计算目标透明度
       let targetCongestionOpacity = 0;
       let targetSegmentOpacity = 0;
       
       if (compactOrb) {
         targetCongestionOpacity = 0;
         targetSegmentOpacity = 0;
       } else if (currentMode === 'congestion') {
         // 拥堵模式：显示拥堵百分比
         targetCongestionOpacity = iconOp;
       } else {
         // 路段归属模式：显示路段名
         targetSegmentOpacity = iconOp;
       }
       
       if (compactOrb) {
         // Snapshot mode must be clean immediately; otherwise a fast focus reset can
         // capture partially faded percentage labels.
         wi.currentCongestionOpacity = 0;
         wi.currentSegmentOpacity = 0;
       } else {
         // 平滑过渡（使用 lerp 插值）
         const transitionSpeed = 0.12; // 过渡速度
         wi.currentCongestionOpacity = THREE.MathUtils.lerp(wi.currentCongestionOpacity, targetCongestionOpacity, transitionSpeed);
         wi.currentSegmentOpacity = THREE.MathUtils.lerp(wi.currentSegmentOpacity, targetSegmentOpacity, transitionSpeed);
       }
       
       // 应用透明度
       wi.congestionMaterial.opacity = wi.currentCongestionOpacity;
       wi.segmentMaterial.opacity = wi.currentSegmentOpacity;
       
       wi.congestionMesh.visible = wi.currentCongestionOpacity > 0.001;
       wi.segmentMesh.visible = wi.currentSegmentOpacity > 0.001;
     }

    // 国界线亮度平滑过渡
    borderBrightness = THREE.MathUtils.lerp(borderBrightness, borderBrightnessTarget, 0.08);
    
    // 根据距离和国界线亮度计算最终透明度
    const baseBorderOp = 0.2 + Math.max(0, Math.min(1, (dist - 4.0) / 3.0)) * 0.5;
    const brightnessMultiplier = 0.5 + (borderBrightness - 0.5) * 1.5; // 0.5 -> 0.5, 1.0 -> 1.25
    borderMat.opacity = baseBorderOp * brightnessMultiplier;
    
    // 国界线颜色：从灰蓝色渐变到白色
    const borderColor = new THREE.Color();
    borderColor.setHSL(0.6, 0.3 - (borderBrightness - 0.5) * 0.6, borderBrightness);
    borderMat.color = borderColor;

    if (Math.abs(dist - lastDist) > 0.05) {
      lastDist = dist;
    }

    renderer.render(scene, camera);

    if (!liveReadyReported) {
      liveReadyReported = true;
      latestProps.current.onLiveReady?.();
    }

    const snapshotRequestKey = latestProps.current.snapshotRequestKey ?? 0;
    if (snapshotRequestKey !== activeSnapshotRequestKey) {
      activeSnapshotRequestKey = snapshotRequestKey;
      try {
        latestProps.current.onSnapshot?.(canvas.toDataURL('image/png'));
      } catch (error) {
        console.warn('[NetworkSphere] Failed to capture snapshot:', error);
      }
    }
  };
  animate();

  return () => {
    cancelAnimationFrame(animId);
    onFpsUpdate?.(0);
    window.removeEventListener('resize', onResize);
    resizeObserver?.disconnect();
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseleave', onMouseLeave);
    controls.removeEventListener('change', markHoverDirty);
    controls.dispose();

    faceGeo.dispose();
    faceMat.dispose();
    borderGeo.dispose();
    borderMat.dispose();
    nodeGeo.dispose();
    nodeMat.dispose();
    focusRingGeo.dispose();
    focusRingMat.dispose();
    for (const wi of regionLabels) {
      wi.congestionMaterial.dispose();
      wi.congestionTexture.dispose();
      wi.segmentMaterial.dispose();
      wi.segmentTexture.dispose();
    }
    atmGeo.dispose();
    atmMat.dispose();
    haloGeo.dispose();
    haloMat.dispose();
    renderer.dispose();
  };
}

/* ══════════════════════════════════════════════════════════════
   Modal Component
   ══════════════════════════════════════════════════════════════ */

export const NetworkSphereModal: React.FC<NetworkSphereModalProps> = ({
  isOpen,
  onClose,
  onSelectSensor,
  onSelectNation,
  onToggleViewMode,
  graphData,
  globalLevels,
  globalScores = [],
  selectedSensor,
  highlightedSensor = null,
  viewMode = 'congestion',
  sensorCount = 743,
  currentTimeIndex = 0,
  currentSimTime = null,
  maxTimeIndex = 105119,
  previewSensor = null,
  previewTimeIndex = null,
  onPreviewChange,
  selectedMonth,
  selectedDay,
  onDateChange,
  weatherCondition,
  weatherLabel,
  weatherTempC,
  weatherPrecipitationPct,
  compactOrb = false,
  focusRequestKey = 0,
  snapshotRequestKey = 0,
  onSnapshot,
  onFocusSettled,
  onLiveReady,
  renderFps,
  entryTransition,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sceneActiveRef = useRef(isOpen);
  const modalExitTimerRef = useRef<number | null>(null);
  const maxTimeIndexRef = useRef(maxTimeIndex);
  const [shouldRenderModal, setShouldRenderModal] = useState(isOpen);
  const [isModalTransitioning, setIsModalTransitioning] = useState(false);
  const modalTransitionMs = compactOrb ? 0 : 720;
  const effectiveRenderFps = renderFps ?? (isModalTransitioning && !compactOrb ? 30 : undefined);

  // Pass dynamic values through a mutable Ref to completely prevent expensive recreating of Three geometries & resetting OrbitCamera!
  const latestProps = useRef({
    selectedSensor,
    highlightedSensor,
    globalLevels,
    globalScores,
    viewMode,
    compactOrb,
    focusRequestKey,
    snapshotRequestKey,
    onSnapshot,
    onFocusSettled,
    onLiveReady,
    renderFps: effectiveRenderFps,
  });

  const [zoomLevel, setZoomLevel] = useState(0); // 0 (far) to 1 (near)
  const safeSensorCount = Math.max(1, Math.floor(sensorCount));
  const effectivePreviewSensor = previewSensor ?? highlightedSensor ?? selectedSensor;
  const effectivePreviewTime = previewTimeIndex ?? currentTimeIndex;
  const effectivePreviewDate = selectedMonth !== undefined && selectedDay !== undefined
    ? { month: clampMonth(selectedMonth), day: clampDay(selectedMonth, selectedDay) }
    : tObsToMonthDay(effectivePreviewTime);
  const initialWidgetSensorId = clampSensorId(effectivePreviewSensor + 1, safeSensorCount);
  const [timeExpanded, setTimeExpanded] = useState(false);
  const [timeTargetExpanded, setTimeTargetExpanded] = useState(false);
  const [timeAnimating, setTimeAnimating] = useState(false);
  const [dotProgress, setDotProgress] = useState<number[]>(() => Array(12).fill(0));
  const [widgetSensorId, setWidgetSensorId] = useState(() => initialWidgetSensorId);
  const [isSensorInputOpen, setIsSensorInputOpen] = useState(false);
  const [sensorInputValue, setSensorInputValue] = useState(() =>
    String(initialWidgetSensorId),
  );
  const [sensorSliderWidth, setSensorSliderWidth] = useState(() =>
    sensorIdToWidth(initialWidgetSensorId, safeSensorCount),
  );
  const [widgetMonth, setWidgetMonth] = useState(() => effectivePreviewDate.month);
  const [widgetDay, setWidgetDay] = useState(() => effectivePreviewDate.day);
  const sensorInputRef = useRef<HTMLInputElement>(null);
  const sensorSliderRef = useRef<HTMLDivElement>(null);
  const sensorFillRef = useRef<HTMLDivElement>(null);
  const dateScrollRef = useRef<HTMLDivElement>(null);
  const lastCommittedPreviewRef = useRef<{ sensor: number; tObs: number } | null>(null);
  const previewCommitTimerRef = useRef<number | null>(null);
  const effectivePreviewTimeRef = useRef(effectivePreviewTime);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const wheelCooldownUntilRef = useRef(0);
  const wheelCommitTimerRef = useRef<number | null>(null);
  const timeAnimationFrameRef = useRef<number | null>(null);
  const timeAnimationRunRef = useRef(0);
  const suppressPreviewCommitRef = useRef(false);
  const sensorDragActiveRef = useRef(false);
  const sensorDragStartXRef = useRef(0);
  const sensorDragStartWidthRef = useRef(sensorIdToWidth(initialWidgetSensorId, safeSensorCount));
  const sensorSliderWidthRef = useRef(sensorIdToWidth(initialWidgetSensorId, safeSensorCount));
  const widgetSensorIdRef = useRef(initialWidgetSensorId);
  const sensorAnimationFrameRef = useRef<number | null>(null);
  const sensorAnimationActiveRef = useRef(false);
  const latestOnSelectSensorRef = useRef(onSelectSensor);
  const widgetSelectionRef = useRef({
    month: effectivePreviewDate.month,
    day: effectivePreviewDate.day,
  });

  useEffect(() => {
    latestOnSelectSensorRef.current = onSelectSensor;
  }, [onSelectSensor]);

  useEffect(() => {
    effectivePreviewTimeRef.current = effectivePreviewTime;
  }, [effectivePreviewTime]);

  useEffect(() => {
    return () => {
      stopTimeAnimation();
      clearProgrammaticScrollLock();
      clearWheelCommitTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearProgrammaticScrollLock = () => {
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = null;
    }
    isProgrammaticScrollRef.current = false;
  };

  const lockProgrammaticScroll = () => {
    isProgrammaticScrollRef.current = true;
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      programmaticScrollTimerRef.current = null;
    }, DAY_WIDGET_PROGRAMMATIC_LOCK_MS);
  };

  const scrollDateWidgetToDay = (
    day: number,
    behavior: ScrollBehavior = 'auto',
    markProgrammatic = true,
  ) => {
    const sc = dateScrollRef.current;
    if (!sc) return;
    const targetDay = clampDay(widgetSelectionRef.current.month, day);
    if (markProgrammatic) lockProgrammaticScroll();
    sc.scrollTo({
      top: (targetDay - 1) * DAY_WIDGET_ITEM_HEIGHT,
      behavior,
    });
  };

  const clearWheelCommitTimer = () => {
    if (wheelCommitTimerRef.current !== null) {
      window.clearTimeout(wheelCommitTimerRef.current);
      wheelCommitTimerRef.current = null;
    }
  };

  const stopTimeAnimation = () => {
    timeAnimationRunRef.current += 1;
    if (timeAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(timeAnimationFrameRef.current);
      timeAnimationFrameRef.current = null;
    }
  };

  useEffect(() => {
    if (modalExitTimerRef.current !== null) {
      window.clearTimeout(modalExitTimerRef.current);
      modalExitTimerRef.current = null;
    }

    if (isOpen) {
      setShouldRenderModal(true);
      setIsModalTransitioning(!compactOrb);
      sceneActiveRef.current = true;
      if (modalTransitionMs > 0) {
        modalExitTimerRef.current = window.setTimeout(() => {
          setIsModalTransitioning(false);
          modalExitTimerRef.current = null;
        }, modalTransitionMs);
      }
      return;
    }

    if (modalTransitionMs <= 0) {
      sceneActiveRef.current = false;
      setIsModalTransitioning(false);
      setShouldRenderModal(false);
      return;
    }

    // Keep WebGL alive while the close transform is still moving.
    sceneActiveRef.current = true;
    setIsModalTransitioning(true);
    modalExitTimerRef.current = window.setTimeout(() => {
      sceneActiveRef.current = false;
      setIsModalTransitioning(false);
      setShouldRenderModal(false);
      modalExitTimerRef.current = null;
    }, modalTransitionMs);

    return () => {
      if (modalExitTimerRef.current !== null) {
        window.clearTimeout(modalExitTimerRef.current);
        modalExitTimerRef.current = null;
      }
    };
  }, [isOpen, compactOrb, modalTransitionMs]);

  useEffect(() => {
    maxTimeIndexRef.current = maxTimeIndex;
  }, [maxTimeIndex]);

  const commitPreviewSelection = (sensorId = widgetSensorIdRef.current) => {
    if (!isOpen || !onPreviewChange) return;
    const nextSensorId = clampSensorId(sensorId, safeSensorCount);
    const tObs = monthDayToPreviewTObs(
      widgetSelectionRef.current.month,
      widgetSelectionRef.current.day,
      effectivePreviewTime,
      maxTimeIndex,
    );
    const previewSensorIdx = nextSensorId - 1;
    const prev = lastCommittedPreviewRef.current;
    if (prev && prev.sensor === previewSensorIdx && prev.tObs === tObs) return;
    lastCommittedPreviewRef.current = { sensor: previewSensorIdx, tObs };
    onPreviewChange(previewSensorIdx, tObs);
  };

  const setWidgetMonthImmediate = (month: number | ((prev: number) => number)) => {
    const nextMonth = clampMonth(
      typeof month === 'function' ? month(widgetSelectionRef.current.month) : month,
    );
    const nextDay = clampDay(nextMonth, widgetSelectionRef.current.day);
    const current = widgetSelectionRef.current;
    if (current.month === nextMonth && current.day === nextDay) return;
    widgetSelectionRef.current = {
      month: nextMonth,
      day: nextDay,
    };
    setWidgetMonth((prev) => (prev === nextMonth ? prev : nextMonth));
    setWidgetDay((prev) => (prev === nextDay ? prev : nextDay));
    onDateChange?.(nextMonth, nextDay);
  };

  const setWidgetDayImmediate = (day: number | ((prev: number) => number)) => {
    const nextDay = clampDay(
      widgetSelectionRef.current.month,
      typeof day === 'function' ? day(widgetSelectionRef.current.day) : day,
    );
    if (widgetSelectionRef.current.day === nextDay) return;
    widgetSelectionRef.current = {
      month: widgetSelectionRef.current.month,
      day: nextDay,
    };
    setWidgetDay((prev) => (prev === nextDay ? prev : nextDay));
    onDateChange?.(widgetSelectionRef.current.month, nextDay);
  };

  const applySliderWidthOnly = (newWidth: number) => {
    const clampedWidth = Math.max(SENSOR_WIDGET_MIN_WIDTH, Math.min(SENSOR_WIDGET_MAX_WIDTH, newWidth));
    sensorSliderWidthRef.current = clampedWidth;
    setSensorSliderWidth((prev) => (Math.abs(prev - clampedWidth) < 0.1 ? prev : clampedWidth));
  };

  const applySensorWidth = (newWidth: number) => {
    applySliderWidthOnly(newWidth);
    const nextSensorId = widthToSensorId(sensorSliderWidthRef.current, safeSensorCount);
    widgetSensorIdRef.current = nextSensorId;
    setWidgetSensorId((prev) => (prev === nextSensorId ? prev : nextSensorId));
  };

  const stopSensorAnimation = () => {
    if (sensorAnimationFrameRef.current !== null) {
      cancelAnimationFrame(sensorAnimationFrameRef.current);
      sensorAnimationFrameRef.current = null;
    }
    sensorAnimationActiveRef.current = false;
  };

  const beginSensorDrag = (clientX: number, startWidth: number) => {
    stopSensorAnimation();
    sensorDragActiveRef.current = true;
    sensorDragStartXRef.current = clientX;
    sensorDragStartWidthRef.current = startWidth;
  };

  const animateSensorWidth = (
    targetWidth: number,
    duration = SENSOR_WIDGET_ANIMATION_MS,
    lockedSensorId?: number,
    onComplete?: (sensorId: number) => void,
  ) => {
    const clampedTarget = Math.max(SENSOR_WIDGET_MIN_WIDTH, Math.min(SENSOR_WIDGET_MAX_WIDTH, targetWidth));
    stopSensorAnimation();
    sensorAnimationActiveRef.current = true;

    const startWidth = sensorSliderWidthRef.current;
    const distance = clampedTarget - startWidth;
    let startTime: number | null = null;

    const step = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / Math.max(1, duration), 1);
      const nextWidth = startWidth + distance * easeOutQuart(progress);
      applySensorWidth(nextWidth);

      if (progress < 1) {
        sensorAnimationFrameRef.current = requestAnimationFrame(step);
      } else {
        sensorAnimationFrameRef.current = null;
        applySensorWidth(clampedTarget);
        const finalSensorId = lockedSensorId ?? widthToSensorId(clampedTarget, safeSensorCount);
        widgetSensorIdRef.current = finalSensorId;
        setWidgetSensorId((prev) => (prev === finalSensorId ? prev : finalSensorId));
        if (!isSensorInputOpen) {
          setSensorInputValue(String(finalSensorId));
        }
        sensorAnimationActiveRef.current = false;
        onComplete?.(finalSensorId);
      }
    };

    sensorAnimationFrameRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    if (!isOpen) return;
    const nextSensorId = clampSensorId(effectivePreviewSensor + 1, safeSensorCount);
    const nextWidth = sensorIdToWidth(nextSensorId, safeSensorCount);
    if (sensorDragActiveRef.current || sensorAnimationActiveRef.current) return;
    widgetSensorIdRef.current = nextSensorId;
    setWidgetSensorId((prev) => (prev === nextSensorId ? prev : nextSensorId));
    sensorSliderWidthRef.current = nextWidth;
    setSensorSliderWidth((prev) => (Math.abs(prev - nextWidth) < 0.1 ? prev : nextWidth));
    if (!isSensorInputOpen) {
      setSensorInputValue(String(nextSensorId));
    }
  }, [isOpen, effectivePreviewSensor, safeSensorCount, isSensorInputOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const md = effectivePreviewDate;
    const current = widgetSelectionRef.current;
    if (current.month === md.month && current.day === md.day) return;
    suppressPreviewCommitRef.current = true;
    widgetSelectionRef.current = {
      month: md.month,
      day: md.day,
    };
    setWidgetMonth((prev) => (prev === md.month ? prev : md.month));
    setWidgetDay((prev) => (prev === md.day ? prev : md.day));
    scrollDateWidgetToDay(md.day, 'auto', true);
  }, [isOpen, effectivePreviewDate.month, effectivePreviewDate.day]);

  useEffect(() => {
    if (!isOpen || !suppressPreviewCommitRef.current) return;
    const md = effectivePreviewDate;
    const expectedSensorId = clampSensorId(effectivePreviewSensor + 1, safeSensorCount);
    if (widgetMonth !== md.month || widgetDay !== md.day || widgetSensorId !== expectedSensorId) return;
    lastCommittedPreviewRef.current = {
      sensor: expectedSensorId - 1,
      tObs: monthDayToPreviewTObs(md.month, md.day, effectivePreviewTime, maxTimeIndex),
    };
    suppressPreviewCommitRef.current = false;
  }, [
    isOpen,
    effectivePreviewSensor,
    effectivePreviewDate.month,
    effectivePreviewDate.day,
    safeSensorCount,
    widgetMonth,
    widgetDay,
    widgetSensorId,
    maxTimeIndex,
  ]);

  useEffect(() => {
    widgetSelectionRef.current = {
      month: clampMonth(widgetMonth),
      day: clampDay(widgetMonth, widgetDay),
    };
  }, [widgetMonth, widgetDay]);

  useEffect(() => {
    if (isOpen && !compactOrb) return;
    stopTimeAnimation();
    clearWheelCommitTimer();
    lastCommittedPreviewRef.current = null;
    setTimeTargetExpanded(false);
    setTimeExpanded(false);
    setTimeAnimating(false);
    setDotProgress(Array(12).fill(0));
    setIsSensorInputOpen(false);
    wheelCooldownUntilRef.current = 0;
    sensorDragActiveRef.current = false;
    clearProgrammaticScrollLock();
    suppressPreviewCommitRef.current = false;
    stopSensorAnimation();
    if (previewCommitTimerRef.current !== null) {
      window.clearTimeout(previewCommitTimerRef.current);
      previewCommitTimerRef.current = null;
    }
  }, [isOpen, compactOrb]);

  useEffect(() => {
    if (!isSensorInputOpen || !sensorInputRef.current) return;
    sensorInputRef.current.focus();
    sensorInputRef.current.select();
  }, [isSensorInputOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !dateScrollRef.current) return;
    const day = clampDay(widgetMonth, widgetDay);
    scrollDateWidgetToDay(day, 'auto', true);
  }, [isOpen, compactOrb, widgetMonth, selectedMonth, selectedDay, effectivePreviewTime]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!sensorDragActiveRef.current) return;
      event.preventDefault();
      const deltaX = event.clientX - sensorDragStartXRef.current;
      applySensorWidth(sensorDragStartWidthRef.current + deltaX);
    };

    const onMouseUp = () => {
      if (!sensorDragActiveRef.current) return;
      const nextSensorId = widthToSensorId(sensorSliderWidthRef.current, safeSensorCount);
      widgetSensorIdRef.current = nextSensorId;
      setWidgetSensorId((prev) => (prev === nextSensorId ? prev : nextSensorId));
      if (!isSensorInputOpen) {
        setSensorInputValue(String(nextSensorId));
      }
      sensorDragActiveRef.current = false;
      commitPreviewSelection(nextSensorId);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [safeSensorCount, isSensorInputOpen, isOpen, onPreviewChange, maxTimeIndex]);

  useLayoutEffect(() => {
    if (!isOpen || !dateScrollRef.current) return;
    const sc = dateScrollRef.current;

    const onWheel = (event: WheelEvent) => {
      if (timeExpanded || timeAnimating) return;

      event.preventDefault();
      const deltaY = Number(event.deltaY);
      if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 0.01) return;

      const now = Date.now();
      if (now < wheelCooldownUntilRef.current) return;
      wheelCooldownUntilRef.current = now + DAY_WIDGET_WHEEL_COOLDOWN_MS;

      let currentIndex = Math.round(sc.scrollTop / DAY_WIDGET_ITEM_HEIGHT);
      if (deltaY > 0) {
        currentIndex++;
      } else if (deltaY < 0) {
        currentIndex--;
      }
      currentIndex = Math.max(0, Math.min(currentIndex, getDaysInMonth(widgetMonth) - 1));
      const nextDay = currentIndex + 1;

      scrollDateWidgetToDay(nextDay, 'smooth', true);
      clearWheelCommitTimer();
      wheelCommitTimerRef.current = window.setTimeout(() => {
        wheelCommitTimerRef.current = null;
        clearProgrammaticScrollLock();
        setWidgetDayImmediate(nextDay);
      }, DAY_WIDGET_SCROLL_ANIMATION_MS);
    };

    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      sc.removeEventListener('wheel', onWheel);
    };
  }, [isOpen, compactOrb, timeExpanded, timeAnimating, widgetMonth]);

  useLayoutEffect(() => {
    if (!isOpen || !dateScrollRef.current) return;
    const sc = dateScrollRef.current;
    const update = (skipStateCommit = false) => {
      const items = sc.querySelectorAll<HTMLElement>('[data-day-item="1"]');
      if (!items.length) return;
      const containerCenter = sc.scrollTop + sc.clientHeight / 2;
      let nearestDay = 1;
      let nearestDist = Number.POSITIVE_INFINITY;
      items.forEach((item) => {
        const day = Number(item.dataset.dayValue ?? 0);
        const itemCenter = item.offsetTop + item.offsetHeight / 2;
        const dist = Math.abs(containerCenter - itemCenter);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestDay = day;
        }
        const maxDist = 45;
        const ratio = Math.max(0, 1 - dist / maxDist);
        const scale = 0.5 + 0.5 * ratio;
        let xOffset = 0;
        if (dist < TIME_WIDGET_RADIUS) {
          xOffset = TIME_WIDGET_RADIUS - Math.sqrt(TIME_WIDGET_RADIUS * TIME_WIDGET_RADIUS - dist * dist);
        } else {
          xOffset = TIME_WIDGET_RADIUS;
        }
        item.style.opacity = String(ratio);
        item.style.transform = `translateX(-${xOffset}px) scale(${scale})`;
      });
      if (skipStateCommit) return;
      const clamped = clampDay(widgetMonth, nearestDay);
      setWidgetDayImmediate((prev) => (prev === clamped ? prev : clamped));
    };

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => update(isProgrammaticScrollRef.current));
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    update(isProgrammaticScrollRef.current);
    return () => {
      cancelAnimationFrame(raf);
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = null;
      }
      sc.removeEventListener('scroll', onScroll);
    };
  }, [isOpen, compactOrb, widgetMonth]);

  useEffect(() => {
    if (!isOpen || !onPreviewChange) return;
    if (sensorDragActiveRef.current) return;
    if (sensorAnimationActiveRef.current) return;
    if (suppressPreviewCommitRef.current) return;
    widgetSensorIdRef.current = clampSensorId(widgetSensorId, safeSensorCount);
    commitPreviewSelection(widgetSensorIdRef.current);
  }, [isOpen, onPreviewChange, widgetSensorId, widgetMonth, widgetDay, maxTimeIndex, safeSensorCount]);

  const toggleTimeAnimation = (toExpand: boolean, selectedMonth?: number) => {
    if (timeAnimating) return;
    if (toExpand === timeExpanded) return;
    if (selectedMonth !== undefined && selectedMonth !== null) {
      const m = clampMonth(selectedMonth);
      setWidgetMonthImmediate(m);
      setWidgetDayImmediate((prev) => clampDay(m, prev));
      scrollDateWidgetToDay(widgetSelectionRef.current.day, 'auto', true);
    }
    stopTimeAnimation();
    setTimeTargetExpanded(toExpand);
    setTimeAnimating(true);
    const duration = 1200;
    const stagger = 150;
    const startTimes = new Array(12).fill(0);
    if (toExpand) {
      for (let i = 0; i < 6; i++) {
        startTimes[i] = i * stagger;
        startTimes[11 - i] = i * stagger;
      }
    } else {
      for (let i = 0; i < 6; i++) {
        startTimes[i] = (5 - i) * stagger;
        startTimes[11 - i] = (5 - i) * stagger;
      }
    }

    let start: number | null = null;
    const runId = timeAnimationRunRef.current;
    const step = (ts: number) => {
      if (runId !== timeAnimationRunRef.current) return;
      if (start === null) start = ts;
      const elapsed = ts - start;
      let allDone = true;
      const next = new Array(12).fill(0).map((_, i) => {
        const dotElapsed = elapsed - startTimes[i];
        let progress = 0;
        if (dotElapsed > 0) progress = Math.min(dotElapsed / duration, 1);
        if (progress < 1) allDone = false;
        const eased = 1 - Math.pow(1 - progress, 5);
        return toExpand ? eased : 1 - eased;
      });
      setDotProgress(next);
      if (!allDone) {
        timeAnimationFrameRef.current = requestAnimationFrame(step);
      } else {
        timeAnimationFrameRef.current = null;
        setTimeAnimating(false);
        setTimeExpanded(toExpand);
        setTimeTargetExpanded(toExpand);
        setDotProgress(Array(12).fill(toExpand ? 1 : 0));
      }
    };
    timeAnimationFrameRef.current = requestAnimationFrame(step);
  };

  const shouldHideDateWidget = timeExpanded || (timeAnimating && timeTargetExpanded);
  const commitSensorInput = (rawValue?: string) => {
    const parsed = Number.parseInt(String(rawValue ?? sensorInputValue).trim(), 10);
    const nextSensorId = clampSensorId(Number.isFinite(parsed) ? parsed : widgetSensorId, safeSensorCount);
    widgetSensorIdRef.current = nextSensorId;
    setWidgetSensorId(nextSensorId);
    setSensorInputValue(String(nextSensorId));
    animateSensorWidth(
      sensorIdToWidth(nextSensorId, safeSensorCount),
      SENSOR_WIDGET_ANIMATION_MS,
      nextSensorId,
      commitPreviewSelection,
    );
    setIsSensorInputOpen(false);
  };

  const cancelSensorInput = () => {
    setSensorInputValue(String(widgetSensorId));
    setIsSensorInputOpen(false);
  };

  const handleSensorHandleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    beginSensorDrag(event.clientX, sensorSliderWidthRef.current);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleSensorContainerMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = sensorSliderRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextSensorId = widthToSensorId(event.clientX - rect.left, safeSensorCount);
    const nextWidth = sensorIdToWidth(nextSensorId, safeSensorCount);
    animateSensorWidth(nextWidth, SENSOR_WIDGET_ANIMATION_MS, nextSensorId, commitPreviewSelection);
    event.preventDefault();
  };

  const handleSensorFieldMouseDown = (event: React.MouseEvent<HTMLButtonElement | HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  /* Build exactly 12 Nations mapping using bottom up Edge Stitching */
  const { nations, sensorPositions, borderEdges, cellPolygons } = useMemo(() => {
    const sourceGraphData = graphData?.nodes?.length
      ? graphData
      : buildFallbackGraphData(safeSensorCount);
    return buildNations(sourceGraphData, globalLevels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, safeSensorCount]);

  useEffect(() => {
    latestProps.current = {
      selectedSensor,
      highlightedSensor,
      globalLevels,
      globalScores,
      viewMode,
      compactOrb,
      focusRequestKey,
      snapshotRequestKey,
      onSnapshot,
      onFocusSettled,
      onLiveReady,
      renderFps: effectiveRenderFps,
    };
  }, [
    selectedSensor,
    highlightedSensor,
    globalLevels,
    globalScores,
    viewMode,
    compactOrb,
    focusRequestKey,
    snapshotRequestKey,
    onSnapshot,
    onFocusSettled,
    onLiveReady,
    effectiveRenderFps,
  ]);

  /* Build scene */
  useEffect(() => {
    if (!shouldRenderModal || !canvasRef.current || nations.length === 0) {
      if (isOpen && nations.length === 0) {
        console.warn('[NetworkSphere] Modal is open but nations are empty. graphData state:', !!graphData);
      }
      return;
    }
    if (cleanupRef.current) return;
    const timer = setTimeout(() => {
      if (!canvasRef.current) return;
      
      // Wait for canvas to have dimensions
      const checkDimensions = () => {
        if (!canvasRef.current) return;
        
        const width = canvasRef.current.clientWidth;
        const height = canvasRef.current.clientHeight;
        
        if (width === 0 || height === 0) {
          console.warn('[NetworkSphere] Canvas has zero dimensions, retrying...');
          setTimeout(checkDimensions, 100);
          return;
        }
        
        cleanupRef.current = buildScene(
          canvasRef.current,
          nations,
          sensorPositions,
          borderEdges,
          cellPolygons,
          latestProps,
          sceneActiveRef,
          (sensorIdx) => {
            const { month, day } = widgetSelectionRef.current;
            latestOnSelectSensorRef.current(
              sensorIdx,
              monthDayToPreviewTObs(month, day, effectivePreviewTimeRef.current, maxTimeIndexRef.current),
            );
          },
          (dist: number) => {
            const z = THREE.MathUtils.clamp(
              (MAX_CAMERA_DISTANCE - dist) / (MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE),
              0,
              1
            );
            // Throttle state update slightly if needed, but for now direct is fine
            setZoomLevel(z);
          },
          undefined,
        );
      };
      
      checkDimensions();
    }, 50);

    return () => {
      clearTimeout(timer);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldRenderModal, nations]);

  // Which nation does the selected sensor belong to?
  const selectedNation = useMemo(() => {
     if (selectedSensor < 0) return -1;
     return nations.findIndex(n => n.childSensors.includes(selectedSensor));
  }, [selectedSensor, nations]);

  const networkStripData = useMemo(() => {
    return buildNetworkStripData(graphData, effectivePreviewSensor, globalScores, globalLevels);
  }, [graphData, effectivePreviewSensor, globalScores, globalLevels]);

  const handleNetworkStripSensorClick = (sensorIdx: number) => {
    const nextSensorId = clampSensorId(sensorIdx + 1, safeSensorCount);
    const nextWidth = sensorIdToWidth(nextSensorId, safeSensorCount);
    widgetSensorIdRef.current = nextSensorId;
    setWidgetSensorId((prev) => (prev === nextSensorId ? prev : nextSensorId));
    sensorSliderWidthRef.current = nextWidth;
    setSensorSliderWidth((prev) => (Math.abs(prev - nextWidth) < 0.1 ? prev : nextWidth));
    if (!isSensorInputOpen) {
      setSensorInputValue(String(nextSensorId));
    }
    commitPreviewSelection(nextSensorId);
  };

  const segmentLeaderboard = useMemo(() => {
    return nations
      .map((nation) => ({
        nationIdx: nation.nationIdx,
        label: nation.label,
        percent: congestionPercentFromSensors(nation.childSensors, globalLevels, globalScores),
        sensorCount: nation.childSensors.length,
      }))
      .sort((a, b) => b.percent - a.percent || b.sensorCount - a.sensorCount || a.label.localeCompare(b.label));
  }, [nations, globalLevels, globalScores]);
  const visibleDayCount = getDaysInMonth(widgetMonth);
  const overlayViewport = useOverlayViewport(isOpen && !compactOrb);
  const overlayInset = clampNumber(Math.round(Math.min(28, Math.max(12, Math.min(overlayViewport.width, overlayViewport.height) * 0.03))), 12, 28);
  const selectorScale = clampNumber(
    Math.min(
      (overlayViewport.width - overlayInset * 2) / SELECTOR_BASE_WIDTH,
      (overlayViewport.height - overlayInset * 2) / 520,
      1,
    ),
    0.48,
    1,
  );
  const selectorGap = clampNumber(Math.round(overlayViewport.width * 0.024), 10, 32);
  const weatherScale = clampNumber(Math.min(overlayViewport.width / 720, overlayViewport.height / 560), 0.68, 1);
  const weatherBottom = overlayViewport.width < 760
    ? overlayInset + SELECTOR_BASE_HEIGHT * selectorScale + 12
    : overlayInset;
  const weatherSize = WEATHER_ICON_BASE_SIZE * weatherScale;
  const selectorTop = overlayViewport.height - overlayInset - SELECTOR_BASE_HEIGHT * selectorScale;
  const topOverlayAvailableHeight = Math.max(
    150,
    Math.min(
      overlayViewport.height - overlayInset - weatherBottom - weatherSize - 18,
      selectorTop - overlayInset - 12,
    ),
  );

  // Notify parent which nation the selected sensor belongs to
  useEffect(() => {
    if (onSelectNation) onSelectNation(selectedNation);
  }, [selectedNation, onSelectNation]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleViewMode?.();
  };

  const swallowContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const modalInitial = compactOrb
    ? { opacity: 1, x: 0, y: 0, scale: 1 }
    : entryTransition
      ? {
          opacity: 0,
          x: entryTransition.x,
          y: entryTransition.y,
          scale: entryTransition.scale,
        }
      : { opacity: 0, x: 0, y: 0, scale: 1.04 };
  const modalAnimate = compactOrb
    ? { opacity: 1, x: 0, y: 0, scale: 1 }
    : { opacity: 1, x: 0, y: 0, scale: 1 };
  const modalExit = compactOrb
    ? { opacity: 0, x: 0, y: 0, scale: 0.98 }
    : entryTransition
      ? {
          opacity: 0,
          x: entryTransition.x,
          y: entryTransition.y,
          scale: entryTransition.scale,
        }
      : { opacity: 0, x: 0, y: 0, scale: 0.98 };

  return (
    <AnimatePresence>
      {shouldRenderModal && (
        <motion.div
          initial={modalInitial}
          animate={isOpen ? modalAnimate : modalExit}
          exit={modalExit}
          transition={{ duration: compactOrb ? 0 : 0.72, ease: [0.16, 1, 0.3, 1] }}
          className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden ${compactOrb ? 'bg-transparent' : 'bg-[#050505]'}`}
          style={{
            pointerEvents: compactOrb ? 'none' : isOpen ? 'auto' : 'none',
            transformOrigin: 'center center',
            willChange: compactOrb ? undefined : 'transform, opacity',
          }}
          aria-hidden={!isOpen}
          onContextMenu={swallowContextMenu}
        >
          {/* Vignette */}
          {!compactOrb && (
            <div className="absolute inset-0 pointer-events-none opacity-50 bg-[radial-gradient(circle_at_center,_transparent_0%,_#000_100%)] z-10" />
          )}

          {/* Canvas */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full cursor-crosshair z-[5]"
            onContextMenu={handleContextMenu}
          />

          <AnimatePresence>
            {!compactOrb && (
              <motion.div
                key="network-sphere-context-overlays"
                className="pointer-events-none absolute inset-0 z-[29]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              >
                <SegmentLeaderboardOverlay
                  items={segmentLeaderboard}
                  zoom={zoomLevel}
                  visible={viewMode === 'segment'}
                  viewport={overlayViewport}
                  inset={overlayInset}
                  maxHeight={topOverlayAvailableHeight}
                />

                <NetworkRelationStripOverlay
                  data={networkStripData}
                  zoom={zoomLevel}
                  visible={viewMode === 'congestion'}
                  onSensorClick={handleNetworkStripSensorClick}
                  viewport={overlayViewport}
                  inset={overlayInset}
                  maxHeight={topOverlayAvailableHeight}
                />

                <WeatherStatusOverlay
                  condition={weatherCondition}
                  inset={overlayInset}
                  bottom={weatherBottom}
                  scale={weatherScale}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {!compactOrb && (
              <motion.div
                key="network-sphere-controls"
                className="pointer-events-none absolute inset-0 z-[28]"
                initial={{ opacity: 0, y: 10, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.985 }}
                transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              >
          <div
            data-star-overlay="selector"
            className="absolute z-[28] pointer-events-auto flex items-center"
            style={{
              right: overlayInset,
              bottom: overlayInset,
              gap: selectorGap,
              transform: `scale(${selectorScale})`,
              transformOrigin: 'bottom right',
            }}
          >
            <div
              ref={sensorSliderRef}
              onMouseDown={handleSensorContainerMouseDown}
              className="relative h-10 w-[320px] cursor-pointer select-none"
              style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
            >
              {isSensorInputOpen ? (
                <div
                  onMouseDown={handleSensorFieldMouseDown}
                  className="absolute left-[-104px] top-1/2 z-[3] flex h-11 w-[92px] -translate-y-1/2 flex-col justify-center rounded-[8px] border border-white/15 bg-white/5 px-3 backdrop-blur-sm"
                >
                  <div className="mb-0.5 text-[9px] font-bold tracking-[0.18em] text-white/45">
                    SENSOR
                  </div>
                  <input
                    ref={sensorInputRef}
                    value={sensorInputValue}
                    inputMode="numeric"
                    onChange={(event) => {
                      const nextValue = event.target.value.replace(/[^\d]/g, '');
                      setSensorInputValue(nextValue);
                    }}
                    onBlur={() => commitSensorInput()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commitSensorInput();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelSensorInput();
                      }
                    }}
                    className="w-full border-none bg-transparent p-0 text-[15px] font-bold text-white outline-none"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                    aria-label="Sensor ID"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onMouseDown={handleSensorFieldMouseDown}
                  onClick={() => setIsSensorInputOpen(true)}
                  className="absolute left-[-104px] top-1/2 z-[3] flex h-11 w-[92px] -translate-y-1/2 flex-col items-start justify-center rounded-[8px] border border-white/10 bg-white/[0.03] px-3 text-left transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.06]"
                >
                  <span className="text-[9px] font-bold tracking-[0.18em] text-white/45">
                    SENSOR
                  </span>
                  <span
                    className="text-[14px] font-bold text-white/85"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {widgetSensorId}
                  </span>
                </button>
              )}
              <div className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 rounded-[2px] bg-white/15" />
              <div
                ref={sensorFillRef}
                className="absolute left-0 top-1/2 z-[2] flex h-8 -translate-y-1/2 cursor-pointer items-center justify-end rounded-[4px] bg-white pr-[38px] box-border transition-shadow duration-200 hover:shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                style={{ width: `${sensorSliderWidth}px` }}
              >
                <span
                  className="pointer-events-none text-[15px] font-bold text-black"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {widgetSensorId}
                </span>
                <div
                  onMouseDown={handleSensorHandleMouseDown}
                  className="absolute right-0 top-0 flex h-full w-7 cursor-ew-resize items-center justify-center"
                  aria-label="Drag sensor selector"
                >
                  <div className="h-4 w-[2px] rounded-full bg-black/45" />
                </div>
              </div>
            </div>

            <div className="relative w-[200px] h-[200px] flex items-center justify-center">
              <svg className="absolute top-0 left-0 z-[1] pointer-events-none" width="200" height="200">
                <defs>
                  <filter id="goo-time-widget" colorInterpolationFilters="sRGB">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
                    <feColorMatrix
                      in="blur"
                      mode="matrix"
                      values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9"
                      result="goo"
                    />
                  </filter>
                </defs>
                <g filter="url(#goo-time-widget)" fill="#ffffff">
                  {MONTH_MAPPING.map((m, i) => {
                    const p = dotProgress[i] ?? 0;
                    const angleDeg = COLLAPSED_ANGLES[i] + (FINAL_ANGLES[i] - COLLAPSED_ANGLES[i]) * p;
                    const rad = angleDeg * Math.PI / 180;
                    const cx = 100 + TIME_WIDGET_RADIUS * Math.cos(rad);
                    const cy = 100 + TIME_WIDGET_RADIUS * Math.sin(rad);
                    return <circle key={`tw-dot-${m}`} cx={cx} cy={cy} r={12} />;
                  })}
                </g>
              </svg>

              <div className="absolute top-0 left-0 w-[200px] h-[200px] z-[5] pointer-events-none">
                {MONTH_MAPPING.map((m, i) => {
                  const p = dotProgress[i] ?? 0;
                  const angleDeg = COLLAPSED_ANGLES[i] + (FINAL_ANGLES[i] - COLLAPSED_ANGLES[i]) * p;
                  const rad = angleDeg * Math.PI / 180;
                  const x = 100 + TIME_WIDGET_RADIUS * Math.cos(rad);
                  const y = 100 + TIME_WIDGET_RADIUS * Math.sin(rad);
                  const op = Math.max(0, Math.min(1, (p - 0.7) / 0.3));
                  return (
                    <button
                      key={`tw-label-${m}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (timeExpanded && !timeAnimating) toggleTimeAnimation(false, m);
                      }}
                      className="absolute w-[30px] h-[30px] flex items-center justify-center text-[13px] font-bold text-black transition-transform transition-colors duration-200 hover:scale-125 hover:text-blue-500"
                      style={{
                        left: `${x}px`,
                        top: `${y}px`,
                        transform: 'translate(-50%, -50%)',
                        opacity: op,
                        pointerEvents: timeExpanded && !timeAnimating ? 'auto' : 'none',
                      }}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>

              <button
                className="relative z-[4] w-[60px] h-[60px] rounded-full bg-white text-black text-2xl font-bold select-none active:scale-90 transition-transform duration-200"
                onClick={() => toggleTimeAnimation(!timeExpanded)}
              >
                {widgetMonth}
              </button>

              <div
                ref={dateScrollRef}
                className="date-widget-scrollbar absolute z-[3] h-[120px] w-[40px] overflow-y-scroll cursor-grab"
                style={{
                  left: '160px',
                  top: '100px',
                  transform: 'translate(-50%, -50%)',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  scrollSnapType: 'y mandatory',
                  scrollBehavior: 'smooth',
                  WebkitOverflowScrolling: 'touch',
                  opacity: shouldHideDateWidget ? 0 : 1,
                  pointerEvents: shouldHideDateWidget || timeAnimating ? 'none' : 'auto',
                  transition: 'opacity 0.4s ease',
                }}
              >
                <div style={{ height: DAY_WIDGET_CENTER_PADDING, flexShrink: 0 }} />
                {Array.from({ length: visibleDayCount }, (_, idx) => idx + 1).map((d) => (
                  <div
                    key={`tw-day-${d}`}
                    data-day-item="1"
                    data-day-value={d}
                    className="flex items-center justify-center text-[18px] font-bold text-black"
                    style={{
                      height: DAY_WIDGET_ITEM_HEIGHT,
                      scrollSnapAlign: 'center',
                      scrollSnapStop: 'always',
                      transformOrigin: 'center center',
                    }}
                  >
                    {d}
                  </div>
                ))}
                <div style={{ height: DAY_WIDGET_CENTER_PADDING, flexShrink: 0 }} />
              </div>
            </div>
          </div>

          <ModeSwitchOverlay mode={viewMode} zoom={zoomLevel} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

type SegmentLeaderboardItem = {
  nationIdx: number;
  label: string;
  percent: number;
  sensorCount: number;
};

type NetworkStripItem = {
  sensorIdx: number;
  absoluteIndex: number;
  label: string;
  absPm: number;
  score?: number;
  level?: number;
  color: string;
  isCurrent: boolean;
  distance: number;
};

type NetworkStripData = {
  freeway: string;
  direction: string;
  total: number;
  position: number;
  start: number;
  end: number;
  focusSensor: number;
  currentName: string;
  visible: NetworkStripItem[];
};

const WeatherStatusOverlay: React.FC<{
  condition?: string;
  inset: number;
  bottom: number;
  scale: number;
}> = ({ condition, inset, bottom, scale }) => {
  const Icon = getWeatherIcon(condition);
  const accent = getWeatherAccent(condition);

  return (
    <div
      data-star-overlay="weather"
      className="pointer-events-none absolute z-[29] text-white"
      style={{
        left: inset,
        bottom,
        transform: `scale(${scale})`,
        transformOrigin: 'bottom left',
      }}
    >
      <div
        className="flex h-[76px] w-[76px] items-center justify-center rounded-full border border-white/12 bg-black/34 backdrop-blur-xl"
        style={{ boxShadow: `0 0 44px ${accent}33, inset 0 0 22px rgba(255,255,255,0.06)` }}
      >
        <Icon size={42} strokeWidth={1.75} style={{ color: accent, filter: `drop-shadow(0 0 12px ${accent}55)` }} />
      </div>
    </div>
  );
};

function stripWeight(distance: number) {
  if (distance <= 0) return 7.2;
  if (distance <= 1) return 3.2;
  if (distance <= 2) return 1.85;
  if (distance <= 3) return 1.12;
  return 0.44;
}

const NetworkRelationStripOverlay: React.FC<{
  data: NetworkStripData | null;
  zoom: number;
  visible: boolean;
  onSensorClick?: (sensorIdx: number) => void;
  viewport: OverlayViewport;
  inset: number;
  maxHeight: number;
}> = ({ data, zoom, visible, onSensorClick, viewport, inset, maxHeight }) => {
  const cameraDistance = MAX_CAMERA_DISTANCE - zoom * (MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE);
  const zoomOpacity = Math.max(0, Math.min(1, (cameraDistance - 4.5) / 2.0)) * 0.9;
  const opacity = visible && data ? zoomOpacity : 0;
  const interactive = opacity > 0.08;
  const hiddenBefore = data ? data.start : 0;
  const hiddenAfter = data ? Math.max(0, data.total - data.end) : 0;
  const currentScore = data?.visible.find((item) => item.isCurrent)?.score;
  const currentPercent = Number.isFinite(currentScore) ? Math.round(Number(currentScore) * 100) : null;
  const compact = viewport.width < 720;
  const gap = compact ? 12 : 20;
  const barWidth = compact ? 32 : 38;
  const detailWidth = compact
    ? clampNumber(viewport.width - inset * 2 - barWidth - gap, 132, 220)
    : 230;
  const barHeight = clampNumber(Math.min(maxHeight, viewport.height * 0.6, 560), 150, 560);
  const routeFontSize = compact
    ? `clamp(28px, ${Math.max(6, Math.min(9, viewport.width / 58)).toFixed(2)}vw, 44px)`
    : 'clamp(38px, 5vw, 70px)';
  const metaFontSize = compact ? 11 : 13;

  return (
    <motion.aside
      data-star-overlay="network-strip"
      className="absolute z-[29] text-white"
      initial={false}
      animate={{ opacity, y: visible ? 0 : -10 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      style={{
        left: inset,
        top: inset,
        maxWidth: viewport.width - inset * 2,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      onWheel={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      aria-hidden={opacity <= 0.01}
    >
      <div className="flex items-start" style={{ gap }}>
        <div
          className="flex flex-col rounded-[2px] bg-white/[0.03] p-[3px] shadow-[0_24px_80px_rgba(0,0,0,0.42)] ring-1 ring-white/10 backdrop-blur-md"
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            width: barWidth,
            height: barHeight,
          }}
        >
          {hiddenBefore > 0 && (
            <div className="mb-1 flex h-5 shrink-0 items-center justify-center text-[9px] font-black tabular-nums text-white/38">
              +{hiddenBefore}
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
            {data?.visible.map((item) => {
              const weight = stripWeight(item.distance);
              const scoreOpacity = item.score === undefined ? 0.78 : 0.42 + item.score * 0.58;
              return (
                <button
                  key={item.sensorIdx}
                  type="button"
                  className="relative w-full transition-[flex,opacity,margin] duration-300 ease-out"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSensorClick?.(item.sensorIdx);
                  }}
                  aria-label={`${item.absoluteIndex + 1} / ${data.total}, sensor ${item.sensorIdx + 1}`}
                  style={{
                    flex: weight,
                    marginBottom: item.absoluteIndex === data.end - 1 ? 0 : Math.min(7, 1.5 + weight * 0.75),
                    padding: 0,
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    className="h-full w-full transition-[box-shadow,filter,transform] duration-200 hover:brightness-125 active:scale-x-90"
                    style={{
                      backgroundColor: item.color,
                      opacity: item.isCurrent ? 1 : scoreOpacity,
                      boxShadow: item.isCurrent ? `0 0 18px ${item.color}` : 'none',
                      outline: item.isCurrent ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.06)',
                      outlineOffset: item.isCurrent ? 1 : 0,
                    }}
                  />
                </button>
              );
            })}
          </div>
          {hiddenAfter > 0 && (
            <div className="mt-1 flex h-5 shrink-0 items-center justify-center text-[9px] font-black tabular-nums text-white/38">
              +{hiddenAfter}
            </div>
          )}
        </div>

        <div
          className="mt-[-2px] select-none pointer-events-none"
          style={{ width: detailWidth }}
        >
          {data && (
            <>
              <div
                className="font-black leading-[0.86] tracking-[-0.075em] text-white drop-shadow-[0_14px_38px_rgba(255,255,255,0.18)]"
                style={{ fontSize: routeFontSize }}
              >
                {data.freeway} {data.direction}
              </div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono tabular-nums">
                <div className={`${compact ? 'text-[22px]' : 'text-[28px]'} font-black leading-none text-white/88`}>
                  {data.position}<span className="text-white/32">/{data.total}</span>
                </div>
                {currentPercent !== null && (
                  <div className={`${compact ? 'text-[26px]' : 'text-[34px]'} font-black leading-none text-white`}>
                    {currentPercent}%
                  </div>
                )}
              </div>
              <div
                className="mt-4 truncate font-black uppercase tracking-[0.14em] text-white/45"
                style={{ maxWidth: detailWidth, fontSize: metaFontSize }}
              >
                #{data.focusSensor + 1} · {data.currentName}
              </div>
            </>
          )}
        </div>
      </div>
    </motion.aside>
  );
};

const SegmentLeaderboardOverlay: React.FC<{
  items: SegmentLeaderboardItem[];
  zoom: number;
  visible: boolean;
  viewport: OverlayViewport;
  inset: number;
  maxHeight: number;
}> = ({ items, zoom, visible, viewport, inset, maxHeight }) => {
  const compact = viewport.width < 720;
  const rowHeight = compact ? 46 : 58;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const cameraDistance = MAX_CAMERA_DISTANCE - zoom * (MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE);
  const zoomOpacity = Math.max(0, Math.min(1, (cameraDistance - 4.5) / 2.0)) * 0.9;
  const opacity = visible ? zoomOpacity : 0;
  const interactive = opacity > 0.08;
  const headIndex = Math.min(items.length - 1, Math.max(0, Math.round(scrollTop / rowHeight)));
  const panelWidth = compact
    ? clampNumber(viewport.width - inset * 2, 260, 520)
    : clampNumber(Math.min(520, viewport.width * 0.42), 320, 520);
  const listMaxHeight = clampNumber(Math.min(maxHeight, viewport.height * 0.58, 560), 150, 560);
  const titleGap = compact ? 12 : 16;
  const titleMarginBottom = compact ? 12 : 20;

  const handleLeaderboardScroll = (event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  return (
    <motion.aside
      data-star-overlay="leaderboard"
      className="absolute z-[29] text-white"
      initial={false}
      animate={{ opacity, y: visible ? 0 : -10 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      style={{
        left: inset,
        top: inset,
        width: panelWidth,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      aria-hidden={!interactive}
    >
      <div className="flex items-end" style={{ gap: titleGap, marginBottom: titleMarginBottom }}>
        <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-black uppercase tracking-[0.32em] text-white/35`}>Segment Load</div>
        <div className="h-px flex-1 bg-gradient-to-r from-white/25 to-transparent" />
      </div>

      <div
        ref={scrollRef}
        className="overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none]"
        onScroll={handleLeaderboardScroll}
        onWheel={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        style={{
          WebkitOverflowScrolling: 'touch',
          scrollSnapType: 'y mandatory',
          maxHeight: listMaxHeight,
          paddingRight: compact ? 8 : 20,
        }}
      >
        <div className="flex flex-col pb-6 [&::-webkit-scrollbar]:hidden">
          {items.map((item, index) => {
            const visualIndex = index - headIndex;
            const isTop = visualIndex === 0;
            const isAboveHead = visualIndex < 0;
            const scale = isAboveHead ? 0.7 : Math.max(0.68, 1 - visualIndex * 0.06);
            const rowOpacity = isAboveHead ? 0 : Math.max(0.26, 1 - visualIndex * 0.1);

            return (
              <button
                key={item.nationIdx}
                type="button"
                className="group grid w-full items-baseline text-left outline-none transition-[opacity,transform] duration-200 ease-out"
                style={{
                  height: rowHeight,
                  gridTemplateColumns: compact
                    ? '26px minmax(0, 1fr) 58px'
                    : '34px minmax(0, 1fr) 74px',
                  gap: compact ? 10 : 16,
                  transform: `scale(${scale})`,
                  transformOrigin: 'left center',
                  opacity: rowOpacity,
                  pointerEvents: isAboveHead ? 'none' : 'auto',
                  visibility: isAboveHead ? 'hidden' : 'visible',
                  scrollSnapAlign: 'start',
                  scrollSnapStop: 'always',
                }}
              >
                <span
                  className={`${compact ? 'text-[15px]' : 'text-[18px]'} font-black tabular-nums ${isTop ? 'text-white' : 'text-white/35'}`}
                >
                  {index + 1}
                </span>
                <span
                  className={`truncate ${compact ? 'text-[clamp(20px,7vw,30px)]' : 'text-[clamp(24px,3vw,42px)]'} font-black leading-[1.04] tracking-[-0.04em] transition-colors duration-200 group-hover:text-white ${isTop ? 'text-white drop-shadow-[0_8px_28px_rgba(255,255,255,0.18)]' : 'text-white/40'}`}
                >
                  {item.label}
                </span>
                <span
                  className={`text-right ${compact ? 'text-[18px]' : 'text-[22px]'} font-black tabular-nums ${isTop ? 'text-white' : 'text-white/40'}`}
                >
                  {item.percent}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </motion.aside>
  );
};

/* ══════════════════════════════════════════════════════════════
   2D Mode Switch Overlay (Peripheral Arcs)
   ══════════════════════════════════════════════════════════════ */

const ModeSwitchOverlay: React.FC<{ mode: PanoramaMode; zoom: number }> = ({ mode, zoom }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [displayMode, setDisplayMode] = useState<PanoramaMode>(mode);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    // 如果模式改变，先淡出再改变文字
    if (mode !== displayMode) {
      setIsTransitioning(true);
      
      // 等待淡出完成后再改变文字
      const transitionTimer = setTimeout(() => {
        setDisplayMode(mode);
        setIsTransitioning(false);
        setIsVisible(true);
      }, 300); // 300ms 淡出时间
      
      // 5.5秒后完全隐藏
      const hideTimer = setTimeout(() => setIsVisible(false), 5500);
      
      return () => {
        clearTimeout(transitionTimer);
        clearTimeout(hideTimer);
      };
    } else {
      // 首次进入或相同模式，正常显示
      setIsVisible(true);
      setIsTransitioning(false);
      const timer = setTimeout(() => setIsVisible(false), 5500);
      return () => clearTimeout(timer);
    }
  }, [mode, displayMode]);

  const labelText = displayMode === 'congestion' ? '交通流量监控' : '路段归属扫描';
  const displayString = labelText;

  // Adaptive Curvature Logic:
  // Baseline curves: 
  // left: M 600 1200 Q 100 500 600 -200
  // right: M 1400 -200 Q 1900 500 1400 1200
  // We make the control point X move based on zoom.
  // When zoom=0 (far), CPX should be closer to 600/1400 (flatter).
  // When zoom=1 (near), CPX should be closer to 100/1900 (curved).
  const leftCPX = 600 - (150 + 450 * zoom);
  const rightCPX = 1400 + (150 + 450 * zoom);

  const leftPath = `M 600 1200 Q ${leftCPX} 500 600 -200`;
  const rightPath = `M 1400 -200 Q ${rightCPX} 500 1400 1200`;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key={displayMode}
          initial={{ opacity: 0 }}
          animate={{ opacity: isTransitioning ? 0 : 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="absolute inset-0 pointer-events-none z-50 flex items-center justify-center overflow-hidden"
        >
          <style>
            {`
              /* Flicker entry for arcs */
              .arc-line-user {
                fill: none;
                stroke: rgba(0, 242, 255, 0.35); /* Using theme cyan */
                stroke-width: 2;
                opacity: 0;
                animation: flickerUser 5s forwards;
              }

              .ui-wrapper-user {
                width: 100%;
                height: 100%;
                animation: fadeOutUser 5s forwards;
              }

              @keyframes flickerUser {
                0% { opacity: 0; }
                2% { opacity: 0.8; }
                4% { opacity: 0; }
                6% { opacity: 1; }
                8% { opacity: 0.2; }
                12%, 100% { opacity: 1; }
              }

              @keyframes fadeOutUser {
                0%, 60% { opacity: 1; }
                75%, 100% { opacity: 0; }
              }
            `}
          </style>

          <div className="ui-wrapper-user">
            <svg viewBox="0 0 2000 1000" preserveAspectRatio="xMidYMid slice" className="w-full h-full">
            <defs>
              <path id="left-path-user" d={leftPath} />
              <path id="right-path-user" d={rightPath} />
            </defs>

            {/* Arcs with flicker */}
            <use href="#left-path-user" className="arc-line-user" />
            <use href="#right-path-user" className="arc-line-user" />

            {/* Left Text */}
            <text fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif" fontSize="64" fontWeight="300" fill="#ffffff" letterSpacing="24" dy="-20">
              <textPath href="#left-path-user" textAnchor="middle" dominantBaseline="auto">
                {displayString}
                <animate 
                  attributeName="startOffset" 
                  values="-100%; -100%; 50%; 50%" 
                  dur="5s" 
                  repeatCount="1" 
                  calcMode="spline" 
                  keyTimes="0; 0.05; 0.6; 1" 
                  keySplines="0 0 1 1; 0.05 0.9 0.1 1; 0 0 1 1" 
                />
              </textPath>
            </text>

            {/* Right Text */}
            <text fontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif" fontSize="64" fontWeight="300" fill="#ffffff" letterSpacing="24" dy="-20">
              <textPath href="#right-path-user" textAnchor="middle" dominantBaseline="auto">
                {displayString}
                <animate 
                  attributeName="startOffset" 
                  values="-100%; -100%; 50%; 50%" 
                  dur="5s" 
                  repeatCount="1" 
                  calcMode="spline" 
                  keyTimes="0; 0.05; 0.6; 1" 
                  keySplines="0 0 1 1; 0.05 0.9 0.1 1; 0 0 1 1" 
                />
              </textPath>
            </text>
          </svg>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
