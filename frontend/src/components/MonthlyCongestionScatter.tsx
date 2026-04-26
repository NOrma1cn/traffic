import React, { useMemo, useState } from 'react';

type CongestionLevel = 'low' | 'medium' | 'high' | 'severe' | 'none';
type MonthlyLevel = 'low' | 'medium' | 'high';

type DailyCongestion = {
  times: string[];
  risk_score: Array<number | null>;
  risk_level: CongestionLevel[];
  current_hour: number;
  hour_count: number;
};

type MonthlyCell = {
  key: string;
  day: number;
  startHour: number;
  endHour: number;
  level: MonthlyLevel;
  score: number | null;
};

interface MonthlyCongestionScatterProps {
  dailyCongestion?: DailyCongestion;
  compact?: boolean;
  axisInset?: {
    left: number;
    right: number;
  };
}

const MONTH_DAYS = 30;
const INTERVAL_HOURS = 3;
const INTERVAL_COUNT = 24 / INTERVAL_HOURS;

const statusMeta: Record<MonthlyLevel, { label: string; color: string }> = {
  low: { label: '畅通', color: '#2563eb' },
  medium: { label: '缓行', color: '#a855f7' },
  high: { label: '拥堵', color: '#f59e0b' },
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

const getLevel = (score: number | null, interval: number): MonthlyLevel => {
  if (score !== null) {
    if (score >= 0.66) return 'high';
    if (score >= 0.36) return 'medium';
    return 'low';
  }

  const depthRatio = interval / Math.max(INTERVAL_COUNT - 1, 1);
  if (depthRatio < 0.4) return 'low';
  if (depthRatio < 0.75) return 'medium';
  return 'high';
};

const buildGrid = (dailyCongestion?: DailyCongestion): MonthlyCell[][] => {
  const hourlyScores = dailyCongestion?.risk_score ?? [];

  return Array.from({ length: MONTH_DAYS }, (_, dayIndex) => {
    const day = dayIndex + 1;

    return Array.from({ length: INTERVAL_COUNT }, (_, interval) => {
      const startHour = interval * INTERVAL_HOURS;
      const endHour = (interval + 1) * INTERVAL_HOURS;
      const sourceScores = hourlyScores
        .slice(startHour, endHour)
        .map((score) => (Number.isFinite(score) ? Number(score) : null))
        .filter((score): score is number => score !== null);
      const intervalScore = sourceScores.length
        ? sourceScores.reduce((sum, score) => sum + score, 0) / sourceScores.length
        : null;
      const dayWave = Math.sin(day * 0.77 + interval * 1.31) * 0.1 + Math.sin(day * 0.19) * 0.06;
      const rushHourBias = interval === 2 || interval === 5 ? 0.1 : interval === 3 || interval === 4 ? 0.04 : 0;
      const simulatedScore = intervalScore === null
        ? null
        : clamp(intervalScore + dayWave + rushHourBias, 0, 1);
      const fallbackShift = Math.sin(day * 1.7 + interval * 2.3);
      const baseLevel = getLevel(simulatedScore, interval);
      const level = simulatedScore === null && fallbackShift > 0.78
        ? (baseLevel === 'low' ? 'medium' : baseLevel === 'medium' ? 'high' : 'medium')
        : baseLevel;

      return {
        key: `${day}-${interval}`,
        day,
        startHour,
        endHour,
        level,
        score: simulatedScore,
      };
    });
  });
};

const getDotSize = (level: MonthlyLevel, compact: boolean) => {
  if (compact) {
    if (level === 'high') return 6;
    if (level === 'medium') return 4.75;
    return 3.5;
  }

  if (level === 'high') return 8;
  if (level === 'medium') return 6.25;
  return 4.5;
};

const MonthlyCongestionScatter: React.FC<MonthlyCongestionScatterProps> = ({
  dailyCongestion,
  compact = false,
  axisInset = { left: 100, right: 56 },
}) => {
  const [hoveredCell, setHoveredCell] = useState<MonthlyCell | null>(null);
  const grid = useMemo(() => buildGrid(dailyCongestion), [dailyCongestion]);

  return (
    <div className="relative w-full overflow-visible" style={{ paddingLeft: axisInset.left, paddingRight: axisInset.right }}>
      <div
        className={`${compact ? 'h-[104px] py-3' : 'h-[126px] py-4'} relative w-full overflow-visible border-y border-white/10 bg-transparent shadow-[0_20px_70px_rgba(0,0,0,0.20)] before:pointer-events-none before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.16),transparent)] before:content-[''] after:pointer-events-none after:absolute after:-inset-x-8 after:inset-y-0 after:bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.075),transparent_72%)] after:opacity-80 after:content-['']`}
        onMouseLeave={() => setHoveredCell(null)}
      >
        <div
          className="relative z-10 grid h-full w-full items-stretch"
          style={{ gridTemplateColumns: `repeat(${MONTH_DAYS}, minmax(0, 1fr))` }}
        >
          {grid.map((column, columnIdx) => (
            <div
              key={`month-day-${columnIdx}`}
              className="grid h-full min-w-0 items-center justify-items-center"
              style={{ gridTemplateRows: `repeat(${INTERVAL_COUNT}, minmax(0, 1fr))` }}
            >
              {column.map((cell) => {
                const status = statusMeta[cell.level];
                const active = hoveredCell?.key === cell.key;
                const dotSize = getDotSize(cell.level, compact);

                return (
                  <div
                    key={cell.key}
                    className="group flex h-full w-full cursor-crosshair items-center justify-center"
                    onMouseEnter={() => setHoveredCell(cell)}
                    aria-label={`第${cell.day}天 ${formatHour(cell.startHour)} 到 ${formatHour(cell.endHour)} ${status.label}`}
                  >
                    <div
                      className="rounded-full transition duration-300 ease-out group-hover:scale-[1.75] group-hover:opacity-100"
                      style={{
                        width: dotSize,
                        height: dotSize,
                        backgroundColor: status.color,
                        opacity: active ? 1 : 0.7 + clamp(cell.score ?? 0.45, 0, 1) * 0.22,
                        boxShadow: active
                          ? `0 0 18px ${status.color}, 0 0 44px ${status.color}66`
                          : `0 0 10px ${status.color}40`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MonthlyCongestionScatter;
