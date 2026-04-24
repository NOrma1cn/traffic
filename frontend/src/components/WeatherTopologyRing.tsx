import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

export interface WeatherRingMetric {
  id: string;
  color: string;
  icon: LucideIcon;
  value: string;
  title: string;
  progress: number;
}

export interface WeatherRingCenter {
  color?: string;
  icon: LucideIcon;
  value: string;
  title: string;
}

interface WeatherTopologyRingProps {
  metrics: WeatherRingMetric[];
  defaultCenter: WeatherRingCenter;
  modes?: Array<{ id: string; label: string; color?: string }>;
  activeModeId?: string | null;
  className?: string;
  onCenterClick?: () => void;
  onCenterWheel?: (direction: 1 | -1) => void;
  onModeSelect?: (modeId: string) => void;
}

const CX = 130;
const CY = 130;
const MAIN_RADIUS = 75;
const BLOCK_INNER_R = 75;
const BLOCK_OUTER_R = 105;
const START_ANGLE = 210;
const TOTAL_SPAN = 160;
const GAP_ANGLE = 1;
const HIT_GAP_ANGLE = 1.4;
const EXPAND_ADD = 14;
const SQUEEZE_SUB = 7;
const EASE = 0.2;
const MODE_DOT_RADIUS = 116;
const MODE_DOT_START = 42;
const MODE_DOT_SPAN = 96;
const LOAD_EASE = [0.16, 1, 0.3, 1] as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function describeArc(
  x: number,
  y: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polarToCartesian(x, y, outerRadius, endAngle);
  const end = polarToCartesian(x, y, outerRadius, startAngle);
  const startInner = polarToCartesian(x, y, innerRadius, endAngle);
  const endInner = polarToCartesian(x, y, innerRadius, startAngle);

  return [
    'M', start.x, start.y,
    'A', outerRadius, outerRadius, 0, 0, 0, end.x, end.y,
    'L', endInner.x, endInner.y,
    'A', innerRadius, innerRadius, 0, 0, 1, startInner.x, startInner.y,
    'Z',
  ].join(' ');
}

export default function WeatherTopologyRing({
  metrics,
  defaultCenter,
  modes = [],
  activeModeId = null,
  className = '',
  onCenterClick,
  onCenterWheel,
  onModeSelect,
}: WeatherTopologyRingProps) {
  const blockCount = metrics.length;
  const normalAngle = useMemo(
    () => (TOTAL_SPAN - GAP_ANGLE * Math.max(0, blockCount - 1)) / Math.max(1, blockCount),
    [blockCount],
  );

  const [lockedIndex, setLockedIndex] = useState(-1);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const activeIndex = hoveredIndex !== -1 ? hoveredIndex : lockedIndex;

  const [{ currentStart, currentSpans }, setRenderState] = useState(() => ({
    currentStart: START_ANGLE,
    currentSpans: Array.from({ length: blockCount }, () => normalAngle),
  }));

  const targetStartRef = useRef(START_ANGLE);
  const targetSpansRef = useRef(Array.from({ length: blockCount }, () => normalAngle));
  const currentStartRef = useRef(START_ANGLE);
  const currentSpansRef = useRef(Array.from({ length: blockCount }, () => normalAngle));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const nextSpans = Array.from({ length: blockCount }, (_, i) => {
      if (activeIndex === -1) return normalAngle;
      if (i === activeIndex) return normalAngle + EXPAND_ADD;
      if (i === activeIndex - 1 || i === activeIndex + 1) return normalAngle - SQUEEZE_SUB;
      return normalAngle;
    });

    targetStartRef.current = activeIndex === 0 ? START_ANGLE - SQUEEZE_SUB : START_ANGLE;
    targetSpansRef.current = nextSpans;

    const animate = () => {
      let needsUpdate = false;
      const nextStart = currentStartRef.current + (targetStartRef.current - currentStartRef.current) * EASE;
      if (Math.abs(targetStartRef.current - nextStart) > 0.01) needsUpdate = true;

      const nextSpans = currentSpansRef.current.map((span, i) => {
        const next = span + (targetSpansRef.current[i] - span) * EASE;
        if (Math.abs(targetSpansRef.current[i] - next) > 0.01) needsUpdate = true;
        return next;
      });

      currentStartRef.current = nextStart;
      currentSpansRef.current = nextSpans;
      setRenderState({ currentStart: nextStart, currentSpans: nextSpans });

      if (needsUpdate) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        currentStartRef.current = targetStartRef.current;
        currentSpansRef.current = [...targetSpansRef.current];
        setRenderState({
          currentStart: targetStartRef.current,
          currentSpans: [...targetSpansRef.current],
        });
        rafRef.current = null;
      }
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(animate);
  }, [activeIndex, blockCount, normalAngle]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const centerData = activeIndex === -1
    ? defaultCenter
    : {
        color: metrics[activeIndex].color,
        icon: metrics[activeIndex].icon,
        value: metrics[activeIndex].value,
        title: metrics[activeIndex].title,
      };

  const segments = useMemo(() => {
    let drawStart = currentStart;
    return currentSpans.map((span) => {
      const startAngle = drawStart;
      const endAngle = drawStart + span;
      const d = describeArc(CX, CY, BLOCK_INNER_R, BLOCK_OUTER_R, startAngle, endAngle);
      drawStart += span + GAP_ANGLE;
      return {
        d,
        endAngle,
        midAngle: startAngle + span / 2,
        startAngle,
      };
    });
  }, [currentSpans, currentStart]);

  const modeDots = useMemo(() => {
    if (!modes.length) return [];
    const step = modes.length === 1 ? 0 : MODE_DOT_SPAN / (modes.length - 1);
    return modes.map((mode, index) => ({
      ...mode,
      ...polarToCartesian(CX, CY, MODE_DOT_RADIUS, MODE_DOT_START + step * index),
    }));
  }, [modes]);

  const updateHoveredIndexFromPointer = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 260;
    const y = ((event.clientY - rect.top) / rect.height) * 260;
    const dx = x - CX;
    const dy = y - CY;
    const radius = Math.hypot(dx, dy);

    if (radius < BLOCK_INNER_R - 4 || radius > BLOCK_OUTER_R + 4) {
      setHoveredIndex(-1);
      return;
    }

    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    const nextIndex = segments.findIndex((segment) => {
      const start = segment.startAngle - HIT_GAP_ANGLE / 2;
      const end = segment.endAngle + HIT_GAP_ANGLE / 2;
      const unwrappedAngle = angle < start ? angle + 360 : angle;
      return unwrappedAngle >= start && unwrappedAngle <= end;
    });

    setHoveredIndex(nextIndex);
  };

  const CenterIcon = centerData.icon;

  return (
    <div className={`relative h-[260px] w-[260px] select-none ${className}`} onMouseLeave={() => setHoveredIndex(-1)}>
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 260 260"
        aria-hidden="true"
        onMouseMove={updateHoveredIndexFromPointer}
      >
        <defs>
          <filter id="weather-ring-soften" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
        </defs>
        <circle
          cx={CX}
          cy={CY}
          r={MAIN_RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth="1"
        />

        <motion.circle
          cx={CX}
          cy={CY}
          r={MAIN_RADIUS + 1}
          fill="none"
          stroke="rgba(255,255,255,0.65)"
          strokeWidth="1.2"
          strokeDasharray="18 456"
          initial={{ opacity: 0, rotate: -90 }}
          animate={{ opacity: [0, 0.75, 0], rotate: 250 }}
          transition={{ duration: 1.35, ease: LOAD_EASE }}
          style={{ transformOrigin: `${CX}px ${CY}px` }}
        />

        {metrics.map((metric, index) => {
          const isActive = activeIndex === index;
          const isDimmed = activeIndex !== -1 && !isActive;
          const progress = clamp01(metric.progress);
          const segment = segments[index];
          const fillOuterRadius = BLOCK_INNER_R + (BLOCK_OUTER_R - BLOCK_INNER_R) * progress;
          const fillPath = progress > 0.001
            ? describeArc(CX, CY, BLOCK_INNER_R, fillOuterRadius, segment.startAngle, segment.endAngle)
            : '';
          const hitPath = describeArc(
            CX,
            CY,
            BLOCK_INNER_R - 4,
            BLOCK_OUTER_R + 4,
            segment.startAngle - HIT_GAP_ANGLE / 2,
            segment.endAngle + HIT_GAP_ANGLE / 2,
          );
          const iconPoint = polarToCartesian(CX, CY, (BLOCK_INNER_R + BLOCK_OUTER_R) / 2, segment.midAngle);
          const MetricIcon = metric.icon;
          return (
            <g key={metric.id}>
              <motion.path
                d={segment.d}
                fill={metric.color}
                filter="url(#weather-ring-soften)"
                opacity={isDimmed ? 0.06 : 0.16 + progress * 0.1}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: isDimmed ? 0.06 : 0.16 + progress * 0.1, scale: 1 }}
                transition={{ duration: 0.55, delay: index * 0.055, ease: LOAD_EASE }}
                style={{ transformOrigin: `${CX}px ${CY}px` }}
              />
              {fillPath && (
                <motion.path
                  d={fillPath}
                  fill={metric.color}
                  initial={{ opacity: 0, scale: 0.72 }}
                  animate={{ opacity: isDimmed ? 0.32 : 0.82, scale: 1 }}
                  transition={{ duration: 0.9, delay: 0.16 + index * 0.065, ease: LOAD_EASE }}
                  style={{
                    filter: isActive ? `drop-shadow(0 0 12px ${metric.color}C0)` : `drop-shadow(0 0 5px ${metric.color}70)`,
                    transformOrigin: `${CX}px ${CY}px`,
                    transition: 'filter 0.25s ease',
                  }}
                />
              )}
              <motion.g
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: isDimmed ? 0.36 : 0.95, scale: 1 }}
                transition={{ duration: 0.45, delay: 0.32 + index * 0.055, ease: LOAD_EASE }}
                style={{ pointerEvents: 'none', transformOrigin: `${iconPoint.x}px ${iconPoint.y}px` }}
              >
                <MetricIcon
                  x={iconPoint.x - 8}
                  y={iconPoint.y - 8}
                  width={16}
                  height={16}
                  color="rgba(255,255,255,0.92)"
                  strokeWidth={1.9}
                />
              </motion.g>
              <path
                d={hitPath}
                fill="transparent"
                onClick={() => {
                  setLockedIndex((prev) => (prev === index ? -1 : index));
                  setHoveredIndex(index);
                }}
                style={{
                  cursor: 'pointer',
                  pointerEvents: 'all',
                }}
              />
            </g>
          );
        })}

        {modeDots.map((mode) => {
          const isActive = activeModeId === mode.id;
          return (
            <g key={mode.id}>
              <motion.circle
                cx={mode.x}
                cy={mode.y}
                r={isActive ? 5.2 : 3.4}
                fill={mode.color ?? 'rgba(255,255,255,0.72)'}
                opacity={isActive ? 1 : 0.32}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: isActive ? 1 : 0.32, scale: 1 }}
                transition={{ duration: 0.38, delay: 0.62 + modes.findIndex((item) => item.id === mode.id) * 0.035, ease: LOAD_EASE }}
                style={{
                  cursor: 'pointer',
                  filter: isActive ? `drop-shadow(0 0 10px ${mode.color ?? 'rgba(255,255,255,0.9)'})` : 'none',
                  transformOrigin: `${mode.x}px ${mode.y}px`,
                  transition: 'r 0.2s ease, filter 0.2s ease',
                }}
                onClick={() => onModeSelect?.(mode.id)}
              />
              <circle
                cx={mode.x}
                cy={mode.y}
                r={10}
                fill="transparent"
                style={{ cursor: 'pointer', pointerEvents: 'all' }}
                onClick={() => onModeSelect?.(mode.id)}
              />
            </g>
          );
        })}
      </svg>

      <button
        type="button"
        className="absolute left-1/2 top-1/2 z-10 flex h-[130px] w-[130px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full outline-none transition-transform duration-200 hover:scale-105 active:scale-95"
        onMouseEnter={() => setHoveredIndex(-1)}
        onClick={() => {
          if (lockedIndex !== -1) {
            setLockedIndex(-1);
            setHoveredIndex(-1);
            return;
          }
          onCenterClick?.();
        }}
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const delta = Math.sign(event.deltaY);
          if (delta === 0) return;
          onCenterWheel?.(delta > 0 ? 1 : -1);
        }}
        aria-label="Weather overview"
      >
        <motion.div
          className="pointer-events-none flex flex-col items-center"
          initial={{ opacity: 0, scale: 0.82 }}
          animate={{ opacity: 1, scale: 1, y: [0, -4, 0] }}
          transition={{ opacity: { duration: 0.5, delay: 0.45 }, scale: { duration: 0.7, delay: 0.45, ease: LOAD_EASE }, y: { duration: 6, ease: 'easeInOut', repeat: Infinity } }}
        >
          <div className="mb-1 transition-colors duration-300" style={{ color: centerData.color ?? 'rgba(255,255,255,0.9)' }}>
            <CenterIcon size={38} strokeWidth={1.5} />
          </div>
          <div className="mt-1 text-2xl font-black leading-none tracking-tight text-white transition-all duration-300">
            {centerData.value}
          </div>
          <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-500 transition-all duration-300">
            {centerData.title}
          </div>
        </motion.div>
      </button>

    </div>
  );
}
