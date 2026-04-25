import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { IncidentContext, IncidentEvent } from './IncidentStatusPanel';

interface ForecastChartPoint {
  time: string;
  observed: number | null;
  predicted: number | null;
}

interface DayData {
  day: string;
  date: string;
  data: number[];
  isToday: boolean;
}

interface ForecastChartProps {
  data: ForecastChartPoint[];
  predictionStartIdx: number;
  metricLabel: string;
  unit: string;
  referenceValue?: number;
  referenceLabel?: string;
  multiDayData?: DayData[];
  weeklyTimes?: string[];
  // 同步相关
  syncX?: number | null;
  onSyncX?: (x: number | null) => void;
  compact?: boolean;
  simTime?: string;
  forcedMax?: number;
  branchPredicted?: number[];
  branchLabel?: string;
  accidents?: IncidentContext | null;
}

type ViewMode = 'timeline' | 'weekly';

type IncidentTheme = {
  iconClass: string;
  label: string;
  rgb: string;
};

type ChartIncidentZone = {
  id: string;
  left: number;
  width: number;
  height: number;
  cols: number;
  rows: number;
  sqSize: number;
  theme: IncidentTheme;
  title: string;
  location: string;
  phase: string;
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  blocks: Array<{ dur: string; del: string; maxOp: string }>;
};

const incidentThemeMap: Record<string, IncidentTheme> = {
  collision: { iconClass: 'fa-car-burst', label: '碰撞事故', rgb: '231, 76, 60' },
  obstruction_hazard: { iconClass: 'fa-triangle-exclamation', label: '道路障碍', rgb: '243, 156, 18' },
  fire_hazmat: { iconClass: 'fa-fire', label: '火灾/危化', rgb: '230, 126, 34' },
  control_closure: { iconClass: 'fa-road-barrier', label: '管制/封闭', rgb: '192, 57, 43' },
  maintenance_construction: { iconClass: 'fa-person-digging', label: '施工维护', rgb: '52, 152, 219' },
  weather_environment: { iconClass: 'fa-cloud-sun-rain', label: '天气环境', rgb: '41, 128, 185' },
  emergency_special: { iconClass: 'fa-life-ring', label: '紧急事件', rgb: '155, 89, 182' },
  other: { iconClass: 'fa-circle-question', label: '其他事件', rgb: '189, 195, 199' },
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const toFiniteNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const parseTimeMs = (value: string) => {
  if (!value) return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  const normalized = Date.parse(value.replace(' ', 'T'));
  return Number.isNaN(normalized) ? null : normalized;
};

const inferStepMinutes = (times: string[]) => {
  const diffs: number[] = [];

  for (let i = 1; i < times.length; i++) {
    const prev = parseTimeMs(times[i - 1]);
    const next = parseTimeMs(times[i]);
    if (prev === null || next === null) continue;
    const diff = Math.round((next - prev) / 60000);
    if (diff > 0 && diff <= 180) diffs.push(diff);
  }

  if (!diffs.length) return 5;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 5;
};

const getInterpolatedIndexForTimestamp = (timelineMs: Array<number | null>, targetMs: number) => {
  const points = timelineMs
    .map((ms, idx) => (ms === null ? null : { ms, idx }))
    .filter((point): point is { ms: number; idx: number } => point !== null);

  if (!points.length) return null;
  if (targetMs <= points[0].ms) return points[0].idx;
  if (targetMs >= points[points.length - 1].ms) return points[points.length - 1].idx;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    if (targetMs > next.ms) continue;
    const span = next.ms - prev.ms;
    if (span <= 0) return next.idx;
    const ratio = (targetMs - prev.ms) / span;
    return prev.idx + (next.idx - prev.idx) * ratio;
  }

  return points[points.length - 1].idx;
};

const formatIncidentTime = (value: string) => {
  const parsed = parseTimeMs(value);
  if (parsed !== null) {
    return new Date(parsed).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  const parts = value.split(' ');
  if (parts.length > 1) {
    const date = parts[0]?.slice(5, 10);
    const time = parts[1]?.slice(0, 5);
    return date ? `${date} ${time}` : time;
  }
  return value.length >= 5 ? value.slice(0, 5) : value;
};

const getIncidentTheme = (event: IncidentEvent): IncidentTheme => {
  const category = String(event.category ?? 'other');
  return incidentThemeMap[category] ?? incidentThemeMap.other;
};

const niceNumber = (range: number, round: boolean) => {
  if (!Number.isFinite(range) || range <= 0) return 1;

  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;

  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }

  return niceFraction * Math.pow(10, exponent);
};

const buildNiceScale = (min: number, max: number, targetTicks = 6) => {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : safeMin + 1;
  const range = safeMax === safeMin ? Math.max(Math.abs(safeMax) * 0.1, 1) : safeMax - safeMin;
  const step = niceNumber(range / Math.max(targetTicks - 1, 1), true);
  const niceMin = Math.floor((safeMin - range * 0.03) / step) * step;
  const niceMax = Math.ceil((safeMax + range * 0.03) / step) * step;
  const ticks: number[] = [];

  for (let tick = niceMin; tick <= niceMax + step * 0.5; tick += step) {
    ticks.push(Number(tick.toFixed(10)));
  }

  return { min: niceMin, max: niceMax, step, ticks };
};

const pickTicks = (ticks: number[], maxTicks: number) => {
  if (ticks.length <= maxTicks) return ticks;
  if (maxTicks <= 2) return [ticks[0], ticks[ticks.length - 1]];

  const out: number[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const idx = Math.round((i / (maxTicks - 1)) * (ticks.length - 1));
    out.push(ticks[idx]);
  }

  // De-dupe in case rounding collides
  return Array.from(new Set(out));
};

const formatTick = (value: number, step: number) => {
  const normalized = Math.abs(value) < Math.abs(step) / 1000 ? 0 : value;
  const decimals = step >= 10 ? 0 : step >= 1 ? (Number.isInteger(step) ? 0 : 1) : Math.min(3, Math.ceil(-Math.log10(step)) + 1);
  return normalized.toFixed(decimals);
};

const getTickIndexes = (total: number, plotWidth: number) => {
  if (total <= 0) return [];
  if (total === 1) return [0];

  const targetTicks = clamp(Math.floor(plotWidth / 145) + 1, 3, 8);
  const tickCount = Math.min(total, targetTicks);
  const indexes = new Set<number>();

  for (let i = 0; i < tickCount; i++) {
    indexes.add(Math.round((i / Math.max(tickCount - 1, 1)) * (total - 1)));
  }

  indexes.add(0);
  indexes.add(total - 1);
  return Array.from(indexes).sort((a, b) => a - b);
};

const formatXAxisLabel = (value: string, prevValue?: string) => {
  const parts = value.split(' ');
  const datePart = parts.length > 1 ? parts[0] : '';
  const timePart = parts.length > 1 ? parts[1] : value;
  const time = timePart.slice(0, 5);

  if (!prevValue) return time;
  const prevParts = prevValue.split(' ');
  const prevDate = prevParts.length > 1 ? prevParts[0] : '';
  if (datePart && prevDate && datePart !== prevDate) {
    const mmdd = datePart.length >= 10 ? datePart.slice(5, 10) : datePart;
    return `${mmdd} ${time}`;
  }

  return time;
};

/**
 * 生成平滑的 SVG 路径 (Simple Bezier approximation)
 */
const getSmoothPath = (points: { x: number; y: number }[]) => {
  if (points.length < 2) return '';
  const d: string[] = [];
  d.push(`M ${points[0].x},${points[0].y}`);

  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const cpX = (curr.x + next.x) / 2;
    d.push(`C ${cpX},${curr.y} ${cpX},${next.y} ${next.x},${next.y}`);
  }
  return d.join(' ');
};

const ForecastChart: React.FC<ForecastChartProps> = ({
  data,
  predictionStartIdx,
  unit,
  referenceValue,
  referenceLabel,
  multiDayData,
  weeklyTimes,
  syncX,
  onSyncX,
  compact = false,
  simTime,
  forcedMax,
  branchPredicted,
  accidents,
}) => {
  const svgHostRef = React.useRef<HTMLDivElement | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [svgHostWidth, setSvgHostWidth] = useState<number | null>(null);
  const uid = React.useId().replace(/:/g, '');
  const readoutClipId = `fc-readout-clip-${uid}`;
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [internalHoveredPoint, setInternalHoveredPoint] = useState<any>(null);
  const [hoveredIncidentId, setHoveredIncidentId] = useState<string | null>(null);
  const isPercentScale = unit.includes('%');
  const normalizeMetricValue = (value: number) => (isPercentScale ? clamp(value, 0, 100) : value);

  React.useEffect(() => {
    const el = svgHostRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const next = Math.max(1, Math.round(rect.width));
      setSvgHostWidth(next);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 如果有外部同步 X，则优先使用外部状态构建悬停点信息
  const hoveredPoint = useMemo(() => {
    const activeX = syncX !== undefined ? syncX : (internalHoveredPoint?.x ?? null);
    if (activeX === null) return null;
    
    // 复用 internalHoveredPoint 的逻辑进行实时插值
    // 注意：这里为了简化逻辑，如果 syncX 存在，我们需要重新根据 activeX 计算 y 和 displayValue
    // 这里我们可以根据 activeX 逆向推导出数据索引并重新计算
    return internalHoveredPoint; 
  }, [syncX, internalHoveredPoint]);

  // 为了让 4 个表联动，我们需要一个更严谨的实时计算逻辑
  // 改造 setHoveredPoint 为一个处理函数
  const getSvgHoverX = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(ctm.inverse()).x;
  };

  const handleHover = (mouseX: number | null) => {
    if (onSyncX) {
      onSyncX(mouseX);
    }
    
    if (mouseX === null) {
      setInternalHoveredPoint(null);
      return;
    }

    const total = viewMode === 'timeline' ? data.length : weeklySeries[0]?.data.length || 1;
    const chartWidth = width - padding.left - padding.right;
    const rawIdx = ((mouseX - padding.left) / chartWidth) * (total - 1);
    const idx = Math.max(0, Math.min(total - 1, Math.round(rawIdx)));

    if (idx >= 0 && idx < total) {
      if (viewMode === 'timeline') {
        const floorIdx = Math.floor(Math.max(0, Math.min(total - 2, rawIdx)));
        const ceilIdx = floorIdx + 1;
        const ratio = rawIdx - floorIdx;
        const pBefore = data[floorIdx];
        const pAfter = data[ceilIdx] || pBefore;
        const valBefore = normalizeMetricValue(pBefore.observed ?? pBefore.predicted ?? 0);
        const valAfter = normalizeMetricValue(pAfter.observed ?? pAfter.predicted ?? 0);
        const interpolatedVal = normalizeMetricValue(valBefore + (valAfter - valBefore) * ratio);
        const isPredictedSegment = rawIdx > predictionStartIdx;

        setInternalHoveredPoint({
          ...data[idx],
          x: mouseX,
          y: getY(interpolatedVal),
          displayValue: interpolatedVal.toFixed(1),
          seriesColor: isPredictedSegment ? '#10b981' : '#00e5ff',
          seriesLabel: isPredictedSegment ? '预测曲线' : '观测曲线',
        });
      } else {
        const seriesData = weeklySeries.map(day => ({
          label: day.isToday ? '今天' : day.day, // 后续会计算 'X天前'
          date: day.date,
          value: normalizeMetricValue(day.data[idx]),
          isToday: day.isToday
        }));

        setInternalHoveredPoint({ 
          time: weeklyTimes?.[idx] || `Step ${idx}`, 
          x: mouseX, 
          isWeekly: true,
          series: seriesData
        });
      }
    }
  };

  // 如果监听到外部 syncX 变化且不是当前组件触发的，则更新内部点
  React.useEffect(() => {
    if (syncX !== undefined && syncX !== internalHoveredPoint?.x) {
      handleHover(syncX);
    }
  }, [syncX]);

  // --- 数据处理 ---
  const chartData = useMemo(() => {
    if (!data?.length) return { observed: [], predicted: [] };
    const pivot = predictionStartIdx >= 0 ? predictionStartIdx : data.length - 1;
    
    const observed = data.slice(0, pivot + 1).map((p, i) => ({
      x: i,
      y: normalizeMetricValue(p.observed ?? p.predicted ?? 0),
      time: p.time,
    }));

    const predicted = data.slice(pivot).map((p, i) => ({
      x: pivot + i,
      y: normalizeMetricValue(p.predicted ?? p.observed ?? 0),
      time: p.time,
    }));

    return { observed, predicted };
  }, [data, predictionStartIdx, isPercentScale]);

  const branchSeries = useMemo(() => {
    if (!branchPredicted || branchPredicted.length === 0 || chartData.predicted.length === 0) return [];
    const anchor = normalizeMetricValue(chartData.observed[chartData.observed.length - 1]?.y ?? chartData.predicted[0]?.y ?? 0);
    return chartData.predicted.map((p, i) => ({
      x: p.x,
      y: i === 0 ? anchor : normalizeMetricValue(branchPredicted[i - 1] ?? p.y),
      time: p.time,
    }));
  }, [branchPredicted, chartData, isPercentScale]);

  const weeklySeries = useMemo(() => (multiDayData ?? []).filter(d => d.data.length > 0), [multiDayData]);

  // --- 缩放与布局逻辑 ---
  const { minVal, range, width, height, padding, yTicks, yTickStep } = useMemo(() => {
    const allY = viewMode === 'timeline'
      ? [...chartData.observed, ...chartData.predicted, ...branchSeries].map(p => p.y)
      : weeklySeries.flatMap(d => d.data.map(normalizeMetricValue));

    const referenceAxisValue = typeof referenceValue === 'number' && Number.isFinite(referenceValue) ? normalizeMetricValue(referenceValue) : null;
    const axisValues = [...allY.filter(Number.isFinite), ...(referenceAxisValue === null ? [] : [referenceAxisValue])];
    const rawMin = axisValues.length ? Math.min(...axisValues) : 0;
    const rawMax = axisValues.length ? Math.max(...axisValues) : 1;
    const pad = Math.max((rawMax - rawMin) * 0.16, Math.abs(rawMax) * 0.03, 1);
    const paddedMin = isPercentScale ? clamp(rawMin - pad, 0, 100) : rawMin >= 0 ? Math.max(0, rawMin - pad) : rawMin - pad;
    const paddedMax = isPercentScale
      ? clamp(forcedMax !== undefined ? Math.max(forcedMax, rawMax + pad) : rawMax + pad, 0, 100)
      : rawMax + pad;
    const targetTicks = compact ? 5 : 4;
    const scale = buildNiceScale(paddedMin, isPercentScale ? paddedMax : forcedMax !== undefined ? Math.max(forcedMax, paddedMax) : paddedMax, targetTicks);

    let finalMin = isPercentScale ? clamp(scale.min, 0, 100) : rawMin >= 0 ? Math.max(0, scale.min) : scale.min;
    let finalMax = isPercentScale ? clamp(Math.max(scale.max, finalMin + Math.max(scale.step, 1)), 0, 100) : Math.max(scale.max, finalMin + scale.step);

    if (isPercentScale && finalMax <= finalMin) {
      finalMin = Math.max(0, Math.min(finalMin, 99));
      finalMax = Math.min(100, finalMin + 1);
    }

    const baseHeight = compact ? 360 : 520;
    const fallbackWidth = compact ? 1000 : 1160;
    const measuredWidth = svgHostWidth ?? fallbackWidth;

    return {
      minVal: finalMin,
      range: (finalMax - finalMin) || 1,
      width: measuredWidth,
      height: baseHeight,
      padding: compact
        ? { top: 48, bottom: 56, left: 76, right: 52 }
        : { top: 64, bottom: 78, left: 100, right: 56 },
      yTicks: pickTicks(
        scale.ticks.filter(tick => tick >= finalMin - scale.step * 0.1 && tick <= finalMax + scale.step * 0.1),
        compact ? 5 : 4,
      ),
      yTickStep: scale.step,
    };
  }, [chartData, weeklySeries, viewMode, referenceValue, forcedMax, branchSeries, compact, svgHostWidth, isPercentScale]);

  const getY = (val: number) => {
    const safeVal = normalizeMetricValue(val);
    return height - padding.bottom - ((safeVal - minVal) / range) * (height - padding.top - padding.bottom);
  };
  const getX = (idx: number, total: number) => padding.left + (idx / Math.max(total - 1, 1)) * (width - padding.left - padding.right);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const observedPathPoints = chartData.observed.map(p => ({ x: getX(p.x, data.length), y: getY(p.y) }));
  const predictedPathPoints = chartData.predicted.map(p => ({ x: getX(p.x, data.length), y: getY(p.y) }));
  const branchPathPoints = branchSeries.map(p => ({ x: getX(p.x, data.length), y: getY(p.y) }));

  const timelineVisible = viewMode === 'timeline';
  const xTickIndexes = useMemo(() => {
    const total = timelineVisible ? data.length : (weeklyTimes?.length ?? 0);
    return getTickIndexes(total, plotWidth);
  }, [data.length, weeklyTimes?.length, timelineVisible, plotWidth]);

  const hoverReadout = useMemo(() => {
    if (!hoveredPoint) return null;

    if (hoveredPoint.isWeekly) {
      const activeSeries = hoveredPoint.series?.find((s: any) => s.isToday) ?? hoveredPoint.series?.[0];
      const value = typeof activeSeries?.value === 'number' ? activeSeries.value.toFixed(1) : '--';
      return {
        value,
        caption: activeSeries?.label ? `${hoveredPoint.time} / ${activeSeries.label}` : hoveredPoint.time,
        color: activeSeries?.isToday ? '#00e5ff' : '#cbd5e1',
      };
    }

    return {
      value: hoveredPoint.displayValue ?? '--',
      caption: `${hoveredPoint.time} / ${hoveredPoint.seriesLabel ?? '曲线'}`,
      color: hoveredPoint.seriesColor ?? '#00e5ff',
    };
  }, [hoveredPoint]);

  const incidentZones = useMemo(() => {
    if (!timelineVisible || !accidents?.current_events?.length || data.length < 2) return [] as ChartIncidentZone[];

    const stepMinutes = Math.max(1, inferStepMinutes(data.map((point) => point.time)));
    const baseSimTime = parseTimeMs(simTime ?? '');
    const timelineMs = data.map((point) => parseTimeMs(point.time));

    return accidents.current_events.flatMap((event, index) => {
      const theme = getIncidentTheme(event);
      const severity = toFiniteNumber(event.severity) ?? 0.9;
      const futureStartMinutes = Math.max(0, toFiniteNumber(event.debug_start_in_minutes) ?? 0);
      const absoluteStartMs = parseTimeMs(event.debug_start_time ?? '');
      const absoluteEndMs = parseTimeMs(event.debug_end_time ?? '');
      const hasAbsoluteWindow = absoluteStartMs !== null && absoluteEndMs !== null && absoluteEndMs > absoluteStartMs;
      const hasSimAnchoredWindow = hasAbsoluteWindow && baseSimTime !== null;
      const durationGuess = Math.max(
        toFiniteNumber(event.duration_minutes) ?? Math.round(stepMinutes * (4 + severity * 2.5)),
        stepMinutes * 2,
      );
      const elapsedMinutes = clamp(
        toFiniteNumber(event.minutes_since_start) ?? Math.min(durationGuess * 0.55, durationGuess - stepMinutes),
        0,
        Math.max(durationGuess - stepMinutes, stepMinutes),
      );
      const remainingMinutes = Math.max(
        toFiniteNumber(event.minutes_until_clear) ?? durationGuess - elapsedMinutes,
        stepMinutes,
      );
      const startPos = hasSimAnchoredWindow
        ? clamp(predictionStartIdx + ((absoluteStartMs - baseSimTime) / 60000) / stepMinutes, 0, data.length - 1)
        : hasAbsoluteWindow
          ? clamp(getInterpolatedIndexForTimestamp(timelineMs, absoluteStartMs) ?? 0, 0, data.length - 1)
        : futureStartMinutes > 0
          ? clamp(predictionStartIdx + futureStartMinutes / stepMinutes, 0, data.length - 1)
          : clamp(predictionStartIdx - elapsedMinutes / stepMinutes, 0, data.length - 1);
      const endPos = hasSimAnchoredWindow
        ? clamp(predictionStartIdx + ((absoluteEndMs - baseSimTime) / 60000) / stepMinutes, startPos + 0.35, data.length - 1)
        : hasAbsoluteWindow
          ? clamp(getInterpolatedIndexForTimestamp(timelineMs, absoluteEndMs) ?? startPos + 0.35, startPos + 0.35, data.length - 1)
        : futureStartMinutes > 0
          ? clamp(startPos + durationGuess / stepMinutes, startPos + 0.35, data.length - 1)
          : clamp(predictionStartIdx + remainingMinutes / stepMinutes, startPos + 0.35, data.length - 1);
      const rawLeft = getX(startPos, data.length);
      const rawRight = getX(endPos, data.length);
      const zoneWidth = Math.max(24, rawRight - rawLeft);
      const zoneLeft = clamp(rawLeft, padding.left, width - padding.right - zoneWidth);
      const sqSize = compact ? 12 : 14;
      const cellSize = sqSize + 1;
      const cols = Math.max(1, Math.ceil(zoneWidth / cellSize));
      const rows = Math.max(1, Math.ceil(plotHeight / cellSize));
      const blockCount = cols * rows;
      const title = event.event_type ?? theme.label;
      const startIdx = Math.max(0, Math.floor(startPos));
      const endIdx = Math.min(data.length - 1, Math.ceil(endPos));
      const startLabel = hasAbsoluteWindow ? formatIncidentTime(event.debug_start_time ?? '') : formatIncidentTime(data[startIdx]?.time ?? '');
      const endLabel = hasAbsoluteWindow ? formatIncidentTime(event.debug_end_time ?? '') : formatIncidentTime(data[endIdx]?.time ?? '');
      const derivedStart = baseSimTime === null
        ? null
        : new Date(baseSimTime + (futureStartMinutes > 0 ? futureStartMinutes : -elapsedMinutes) * 60000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      const derivedEnd = baseSimTime === null
        ? null
        : new Date(baseSimTime + (futureStartMinutes > 0 ? futureStartMinutes + durationGuess : remainingMinutes) * 60000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      const minutesUntilStart = hasAbsoluteWindow && baseSimTime !== null && absoluteStartMs !== null
        ? Math.round((absoluteStartMs - baseSimTime) / 60000)
        : futureStartMinutes > 0
          ? Math.round(futureStartMinutes)
          : null;
      const durationMinutes = hasAbsoluteWindow && absoluteStartMs !== null && absoluteEndMs !== null
        ? Math.max(1, Math.round((absoluteEndMs - absoluteStartMs) / 60000))
        : Math.max(1, Math.round(durationGuess));

      return [{
        id: `${event.incident_id ?? index}-${index}`,
        left: zoneLeft,
        width: zoneWidth,
        height: plotHeight,
        cols,
        rows,
        sqSize,
        theme,
        title,
        location: [event.freeway, event.direction, event.location_text].filter(Boolean).join(' ') || '位置未知',
        phase: minutesUntilStart !== null && minutesUntilStart > 0 ? `未来 ${minutesUntilStart} 分钟` : event.phase === 'recovery' ? '恢复尾迹' : '活跃窗口',
        startLabel: startLabel || derivedStart || '--:--',
        endLabel: endLabel || derivedEnd || '--:--',
        durationLabel: `${durationMinutes} 分钟`,
        blocks: Array.from({ length: blockCount }, (_, blockIdx) => ({
          dur: `${(0.28 + ((blockIdx * 17) % 9) * 0.09).toFixed(2)}s`,
          del: `${(-((blockIdx * 13) % 19) * 0.11).toFixed(2)}s`,
          maxOp: (0.06 + ((blockIdx * 7) % 11) * 0.018).toFixed(2),
        })),
      }];
    });
  }, [timelineVisible, accidents, data, predictionStartIdx, simTime, compact, plotHeight, padding.left, padding.right, width]);

  const hoveredIncident = useMemo(
    () => incidentZones.find((zone) => zone.id === hoveredIncidentId) ?? null,
    [incidentZones, hoveredIncidentId],
  );

  React.useEffect(() => {
    if (!timelineVisible || !incidentZones.some((zone) => zone.id === hoveredIncidentId)) {
      setHoveredIncidentId(null);
    }
  }, [timelineVisible, incidentZones, hoveredIncidentId]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full overflow-visible group/chart"
    >
      <style>{`
        @keyframes forecast-chart-digital-blink {
          0%, 49% { opacity: 0; }
          50%, 100% { opacity: var(--fc-block-max-op); }
        }

        .fc-incident-zone {
          position: absolute;
          pointer-events: auto;
          cursor: pointer;
          box-sizing: border-box;
        }

        .fc-incident-glitch {
          position: absolute;
          inset: 0;
          display: grid;
          grid-template-columns: repeat(var(--fc-cols), var(--fc-sq-size));
          grid-template-rows: repeat(var(--fc-rows), var(--fc-sq-size));
          gap: 1px;
          overflow: hidden;
          justify-content: center;
          align-content: center;
          transition: opacity 0.35s ease;
          -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.06) 38%, rgba(0,0,0,1) 100%);
          mask-image: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.06) 38%, rgba(0,0,0,1) 100%);
        }

        .fc-incident-block {
          width: 100%;
          height: 100%;
          opacity: 0;
          animation: forecast-chart-digital-blink var(--fc-block-dur) steps(1) infinite var(--fc-block-del);
        }

        .fc-incident-hover {
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity 0.35s ease, box-shadow 0.35s ease, transform 0.35s ease;
          border: 1px dashed var(--fc-hover-border);
          background: var(--fc-hover-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(2px);
        }

        .fc-incident-zone:hover .fc-incident-glitch,
        .fc-incident-zone[data-active='true'] .fc-incident-glitch {
          opacity: 0;
        }

        .fc-incident-zone:hover .fc-incident-hover,
        .fc-incident-zone[data-active='true'] .fc-incident-hover {
          opacity: 1;
          box-shadow: 0 0 18px var(--fc-hover-shadow);
          transform: translateZ(0);
        }

        .fc-incident-icon {
          transform: scale(0.55);
          transition: transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.35s ease;
          opacity: 0.82;
        }

        .fc-incident-zone:hover .fc-incident-icon,
        .fc-incident-zone[data-active='true'] .fc-incident-icon {
          transform: scale(1);
          opacity: 1;
        }
      `}</style>

      <div className="flex justify-end p-7 pb-2">
        <div className="relative z-50 pointer-events-auto flex items-center gap-1 bg-zinc-900/50 p-1 rounded-xl border border-white/5 self-start md:self-center">
          {(['timeline', 'weekly'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all duration-300 cursor-pointer active:scale-95 ${
                viewMode === mode ? 'bg-white text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {mode === 'timeline' ? '实时轨迹' : '周期对比'}
            </button>
          ))}
        </div>
      </div>

      <div ref={svgHostRef} className={`${compact ? 'h-[360px]' : 'h-[520px]'} relative w-full overflow-hidden`}>
        {timelineVisible && hoveredIncident && (
          <div
            className="pointer-events-none absolute z-20"
            style={{
              left: padding.left + 18,
              top: padding.top + 8,
              width: Math.min(plotWidth * 0.34, 420),
            }}
          >
            <div
              className="truncate font-mono text-[44px] font-black leading-[0.9] tracking-[-0.06em]"
              style={{ color: `rgba(${hoveredIncident.theme.rgb}, 0.92)` }}
            >
              {hoveredIncident.theme.label}
            </div>

            <div className="mt-3 flex items-center gap-4">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl border shadow-[0_0_30px_rgba(0,0,0,0.22)]"
                style={{
                  borderColor: `rgba(${hoveredIncident.theme.rgb}, 0.42)`,
                  backgroundColor: `rgba(${hoveredIncident.theme.rgb}, 0.12)`,
                  color: `rgba(${hoveredIncident.theme.rgb}, 0.88)`,
                }}
              >
                <i className={`fa-solid ${hoveredIncident.theme.iconClass}`} style={{ fontSize: 22 }} />
              </div>
              <div className="min-w-0 flex items-baseline gap-3">
                <div
                  className="font-mono text-[18px] font-black uppercase tracking-[0.24em]"
                  style={{ color: `rgba(${hoveredIncident.theme.rgb}, 0.72)` }}
                >
                  {hoveredIncident.durationLabel}
                </div>
              </div>
            </div>
          </div>
        )}

        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMin meet" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="glowGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
            </linearGradient>
            <clipPath id={readoutClipId}>
              <rect
                x={padding.left + (width - padding.left - padding.right) * 0.42}
                y={padding.top}
                width={(width - padding.left - padding.right) * 0.58}
                height={height - padding.top - padding.bottom}
              />
            </clipPath>
          </defs>

          {yTicks.map((val, i) => {
            const y = getY(val);
            const label = formatTick(val, yTickStep);
            const isMajor = i === 0 || i === yTicks.length - 1;
            const isMid = !isMajor && i === Math.floor(yTicks.length / 2);
            return (
              <g key={i} className="transition-opacity duration-1000">
                <line
                  x1={padding.left} y1={y} x2={width - padding.right} y2={y}
                  stroke="currentColor"
                  className={isMajor ? 'text-zinc-600/70' : 'text-zinc-700/60'}
                  strokeWidth={isMajor ? 1.6 : 1}
                  strokeDasharray={isMajor ? undefined : '4 8'}
                />
                <text
                  x={padding.left - (isMajor ? 28 : isMid ? 24 : 20)}
                  y={y}
                  fill="currentColor"
                  className={isMajor
                    ? 'text-zinc-50 font-mono text-[22px] font-black'
                    : isMid
                      ? 'text-zinc-200 font-mono text-[15px] font-black'
                    : 'text-zinc-300 font-mono text-[13px] font-bold'
                  }
                  textAnchor="end" dominantBaseline="middle"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* 横坐标标签 */}
          {timelineVisible ? (
            data.length > 0 && xTickIndexes.map((idx) => {
              const x = getX(idx, data.length);
              const isMajor = idx === 0 || idx === data.length - 1 || idx === Math.floor(data.length / 2);
              const prevValue = (() => {
                const listIdx = xTickIndexes.indexOf(idx);
                const prevIdx = listIdx > 0 ? xTickIndexes[listIdx - 1] : undefined;
                return prevIdx === undefined ? undefined : data[prevIdx]?.time;
              })();
              const label = formatXAxisLabel(data[idx].time, prevValue);
              return (
                <g key={idx}>
                  {isMajor && (
                    <line
                      x1={x}
                      y1={padding.top}
                      x2={x}
                      y2={height - padding.bottom}
                      stroke="currentColor"
                      className="text-zinc-800/45"
                      strokeWidth="1"
                      strokeDasharray="2 14"
                    />
                  )}
                  <line x1={x} y1={height - padding.bottom} x2={x} y2={height - padding.bottom + (isMajor ? 10 : 6)} stroke="currentColor" className={isMajor ? 'text-zinc-500/85' : 'text-zinc-700/80'} strokeWidth={isMajor ? 1.6 : 1} />
                  <text
                    x={x} y={height - padding.bottom + 34}
                    fill="currentColor"
                    className={isMajor
                      ? 'text-zinc-200 font-mono text-[14px] font-black uppercase tracking-wider'
                      : 'text-zinc-400 font-mono text-[12px] font-bold uppercase tracking-wider'
                    }
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                </g>
              );
            })
          ) : (
            weeklyTimes && weeklyTimes.length > 0 && xTickIndexes.map((idx) => {
              const x = getX(idx, weeklyTimes.length);
              const isMajor = idx === 0 || idx === weeklyTimes.length - 1 || idx === Math.floor(weeklyTimes.length / 2);
              return (
                <g key={idx}>
                  {isMajor && (
                    <line
                      x1={x}
                      y1={padding.top}
                      x2={x}
                      y2={height - padding.bottom}
                      stroke="currentColor"
                      className="text-zinc-800/45"
                      strokeWidth="1"
                      strokeDasharray="2 14"
                    />
                  )}
                  <line x1={x} y1={height - padding.bottom} x2={x} y2={height - padding.bottom + (isMajor ? 10 : 6)} stroke="currentColor" className={isMajor ? 'text-zinc-500/85' : 'text-zinc-700/80'} strokeWidth={isMajor ? 1.6 : 1} />
                  <text
                    x={x} y={height - padding.bottom + 34}
                    fill="currentColor"
                    className={isMajor
                      ? 'text-zinc-200 font-mono text-[14px] font-black uppercase tracking-widest'
                      : 'text-zinc-400 font-mono text-[12px] font-bold uppercase tracking-widest'
                    }
                    textAnchor="middle"
                  >
                    {weeklyTimes[idx]}
                  </text>
                </g>
              );
            })
          )}

          {/* 增加坐标轴基准线 */}
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#52525b" strokeWidth="1.5" />
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#52525b" strokeWidth="1.5" />

          {referenceValue !== undefined && timelineVisible && (
            <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <line 
                x1={padding.left} y1={getY(referenceValue)} 
                x2={width - padding.right} y2={getY(referenceValue)} 
                stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 6" opacity="0.4"
              />
              <rect x={width - padding.right - 80} y={getY(referenceValue) - 20} width="80" height="16" fill="#f59e0b" opacity="0.1" rx="4" />
              <text x={width - padding.right - 8} y={getY(referenceValue) - 8} fill="#f59e0b" fontSize="9" fontWeight="900" textAnchor="end" className="uppercase tracking-[0.1em]">{referenceLabel}</text>
            </motion.g>
          )}

          <AnimatePresence>
            {hoverReadout && (
              <motion.g
                key="chart-readout"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="pointer-events-none"
                clipPath={`url(#${readoutClipId})`}
                style={{ mixBlendMode: 'screen' }}
              >
                <text
                  x={width - padding.right - 24}
                  y={padding.top + 18}
                  fill={hoverReadout.color}
                  opacity="0.32"
                  className="font-mono text-[14px] font-black uppercase tracking-[0.24em]"
                  textAnchor="end"
                  dominantBaseline="hanging"
                >
                  {hoverReadout.caption}
                </text>

                <text
                  x={width - padding.right - 24}
                  y={padding.top + 44}
                  fill={hoverReadout.color}
                  opacity="0.16"
                  className="font-mono text-[128px] font-black tracking-[-0.10em]"
                  textAnchor="end"
                  dominantBaseline="hanging"
                >
                  {hoverReadout.value}
                </text>

                <text
                  x={width - padding.right - 26}
                  y={padding.top + 190}
                  fill={hoverReadout.color}
                  opacity="0.22"
                  className="font-mono text-[22px] font-black uppercase tracking-[0.30em]"
                  textAnchor="end"
                  dominantBaseline="hanging"
                >
                  {unit}
                </text>
              </motion.g>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {timelineVisible ? (
              <motion.g key="timeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
                <motion.path 
                  initial={{ d: `${getSmoothPath(observedPathPoints)} L ${observedPathPoints[observedPathPoints.length - 1]?.x},${height - padding.bottom} L ${padding.left},${height - padding.bottom} Z` }}
                  animate={{ d: `${getSmoothPath(observedPathPoints)} L ${observedPathPoints[observedPathPoints.length - 1]?.x},${height - padding.bottom} L ${padding.left},${height - padding.bottom} Z` }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  fill="url(#glowGradient)" 
                  className="pointer-events-none" 
                />
                {/* 观测线 - 变形动画 */}
                <motion.path 
                  initial={{ d: getSmoothPath(observedPathPoints) }}
                  animate={{ d: getSmoothPath(observedPathPoints) }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  fill="none" stroke="#00e5ff" strokeWidth="3.5" strokeLinecap="round" 
                  className="drop-shadow-[0_0_8px_rgba(0,229,255,0.4)]" 
                />

                {/* 预测线 - 变形动画 */}
                <motion.path 
                  initial={{ d: getSmoothPath(predictedPathPoints) }}
                  animate={{ d: getSmoothPath(predictedPathPoints) }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  fill="none" stroke="#10b981" strokeWidth="2.5" strokeDasharray="8 6" strokeLinecap="round" opacity="0.8" 
                />
                {branchPathPoints.length > 1 && (
                  <motion.path
                    initial={{ d: getSmoothPath(branchPathPoints) }}
                    animate={{ d: getSmoothPath(branchPathPoints) }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth="2.5"
                    strokeDasharray="3 5"
                    strokeLinecap="round"
                    opacity="0.95"
                  />
                )}

                {/* 每一个数据点的“非线性”运动动画 */}
                {observedPathPoints.map((p, i) => (
                  <motion.circle
                    key={`dot-${i}`}
                    animate={{ cx: p.x, cy: p.y }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    r={i === observedPathPoints.length - 1 ? 5 : 2}
                    fill={i === observedPathPoints.length - 1 ? "#fff" : "rgba(0, 229, 255, 0.5)"}
                    className={i === observedPathPoints.length - 1 ? "drop-shadow-[0_0_12px_rgba(255,255,255,0.8)]" : ""}
                  />
                ))}
              </motion.g>
            ) : (
              <motion.g key="weekly" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
                {weeklySeries.map((day, idx) => {
                  const points = day.data.map((v, i) => ({ x: getX(i, day.data.length), y: getY(v) }));
                  return <motion.path key={day.day} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: day.isToday ? 1 : 0.15 }} transition={{ duration: 1.5, delay: idx * 0.08, ease: [0.16, 1, 0.3, 1] }} d={getSmoothPath(points)} fill="none" stroke={day.isToday ? "#00e5ff" : "#cbd5e1"} strokeWidth={day.isToday ? "4" : "1.5"} strokeLinecap="round" />;
                })}
              </motion.g>
            )}
          </AnimatePresence>

          <rect
            x={padding.left} y={padding.top} width={width - padding.left - padding.right} height={height - padding.top - padding.bottom} fill="transparent"
            onMouseMove={(e) => handleHover(getSvgHoverX(e.clientX, e.clientY))}
            onMouseLeave={() => handleHover(null)}
          />

          {hoveredPoint && (
            <motion.line initial={{ opacity: 0 }} animate={{ opacity: 1 }} x1={hoveredPoint.x} y1={padding.top} x2={hoveredPoint.x} y2={height - padding.bottom} stroke="rgba(255,255,255,0.1)" strokeWidth="1" className="pointer-events-none" />
          )}
        </svg>

        {timelineVisible && incidentZones.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-10">
            {incidentZones.map((zone) => {
              const zoneStyle = {
                left: `${zone.left}px`,
                top: `${padding.top}px`,
                width: `${zone.width}px`,
                height: `${zone.height}px`,
                ['--fc-sq-size' as const]: `${zone.sqSize}px`,
                ['--fc-cols' as const]: zone.cols,
                ['--fc-rows' as const]: zone.rows,
                ['--fc-hover-bg' as const]: `rgba(${zone.theme.rgb}, 0.18)`,
                ['--fc-hover-border' as const]: `rgba(${zone.theme.rgb}, 0.82)`,
                ['--fc-hover-shadow' as const]: `rgba(${zone.theme.rgb}, 0.22)`,
              } as React.CSSProperties;

              return (
                <div
                  key={zone.id}
                  className="fc-incident-zone"
                  data-active={hoveredIncidentId === zone.id}
                  style={zoneStyle}
                  onMouseEnter={(event) => {
                    setHoveredIncidentId(zone.id);
                    handleHover(getSvgHoverX(event.clientX, event.clientY));
                  }}
                  onMouseMove={(event) => {
                    setHoveredIncidentId(zone.id);
                    handleHover(getSvgHoverX(event.clientX, event.clientY));
                  }}
                  onMouseLeave={() => setHoveredIncidentId((current) => (current === zone.id ? null : current))}
                >
                  <div className="fc-incident-glitch">
                    {zone.blocks.map((block, blockIdx) => (
                      <div
                        key={`${zone.id}-${blockIdx}`}
                        className="fc-incident-block"
                        style={{
                          backgroundColor: `rgba(${zone.theme.rgb}, 1)`,
                          ['--fc-block-dur' as const]: block.dur,
                          ['--fc-block-del' as const]: block.del,
                          ['--fc-block-max-op' as const]: block.maxOp,
                        } as React.CSSProperties}
                      />
                    ))}
                  </div>

                  <div className="fc-incident-hover">
                    <div className="flex flex-col items-center gap-2 px-3 text-center text-white">
                      <i className={`fc-incident-icon fa-solid ${zone.theme.iconClass}`} style={{ fontSize: zone.width > 84 ? 22 : 18 }} />
                      {zone.width > 96 && (
                        <div className="max-w-full truncate text-[10px] font-black uppercase tracking-[0.18em] text-white/75">{zone.theme.label}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </motion.div>
  );
};

export default ForecastChart;
