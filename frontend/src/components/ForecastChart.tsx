import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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
}

type ViewMode = 'timeline' | 'weekly';

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
  metricLabel,
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
  branchLabel,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [internalHoveredPoint, setInternalHoveredPoint] = useState<any>(null);

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
        const valBefore = (pBefore.observed ?? pBefore.predicted ?? 0);
        const valAfter = (pAfter.observed ?? pAfter.predicted ?? 0);
        const interpolatedVal = valBefore + (valAfter - valBefore) * ratio;

        setInternalHoveredPoint({ 
          ...data[idx],
          x: mouseX, 
          y: getY(interpolatedVal),
          displayValue: (data[idx].observed ?? data[idx].predicted ?? 0).toFixed(1)
        });
      } else {
        const seriesData = weeklySeries.map(day => ({
          label: day.isToday ? '今天' : day.day, // 后续会计算 'X天前'
          date: day.date,
          value: day.data[idx],
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
      y: p.observed ?? p.predicted ?? 0,
      time: p.time,
    }));

    const predicted = data.slice(pivot).map((p, i) => ({
      x: pivot + i,
      y: p.predicted ?? p.observed ?? 0,
      time: p.time,
    }));

    return { observed, predicted };
  }, [data, predictionStartIdx]);

  const branchSeries = useMemo(() => {
    if (!branchPredicted || branchPredicted.length === 0 || chartData.predicted.length === 0) return [];
    const anchor = chartData.observed[chartData.observed.length - 1]?.y ?? chartData.predicted[0]?.y ?? 0;
    return chartData.predicted.map((p, i) => ({
      x: p.x,
      y: i === 0 ? anchor : (branchPredicted[i - 1] ?? p.y),
      time: p.time,
    }));
  }, [branchPredicted, chartData]);

  const weeklySeries = useMemo(() => (multiDayData ?? []).filter(d => d.data.length > 0), [multiDayData]);

  // --- 缩放与布局逻辑 ---
  const { minVal, maxVal, range, width, height, padding } = useMemo(() => {
    const allY = viewMode === 'timeline'
      ? [...chartData.observed, ...chartData.predicted, ...branchSeries].map(p => p.y)
      : weeklySeries.flatMap(d => d.data);

    const rawMin = Math.min(...allY, referenceValue ?? Infinity);
    const rawMax = Math.max(...allY, referenceValue ?? -Infinity);
    const pad = (rawMax - rawMin) * 0.2 || 1; 

    const calculatedMax = forcedMax !== undefined ? forcedMax : (rawMax + pad);
    const finalMax = Math.max(calculatedMax, rawMax + 1); // Clamp to at least current max + 1
    const finalMin = rawMin - pad;

    return {
      minVal: finalMin,
      maxVal: finalMax,
      range: (finalMax - finalMin) || 1,
      width: 1000,
      height: 400,
      padding: { top: 60, bottom: 60, left: 80, right: 80 },
    };
  }, [chartData, weeklySeries, viewMode, referenceValue, forcedMax, branchSeries]);

  const getY = (val: number) => height - padding.bottom - ((val - minVal) / range) * (height - padding.top - padding.bottom);
  const getX = (idx: number, total: number) => padding.left + (idx / Math.max(total - 1, 1)) * (width - padding.left - padding.right);

  const observedPathPoints = chartData.observed.map(p => ({ x: getX(p.x, data.length), y: getY(p.y) }));
  const predictedPathPoints = chartData.predicted.map(p => ({ x: getX(p.x, data.length), y: getY(p.y) }));
  const branchPathPoints = branchSeries.map(p => ({ x: getX(p.x, data.length), y: getY(p.y) }));

  const timelineVisible = viewMode === 'timeline';

  // --- 5min Trend Intelligence (Green Increase / Red Decrease) ---
  const trendColor = useMemo(() => {
    if (!chartData.observed.length || !chartData.predicted.length) return 'transparent';
    const currentVal = chartData.observed[chartData.observed.length - 1].y;
    const forecastVal = chartData.predicted[1]?.y ?? currentVal; // next step (5min)
    const delta = forecastVal - currentVal;
    
    if (Math.abs(delta) < 0.001) return 'rgba(255,255,255,0.1)'; 
    return delta > 0 ? '#10b981' : '#f43f5e';
  }, [chartData]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-full overflow-visible group/chart"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between p-7 pb-2 gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {!compact && (
              <div className="flex items-center gap-2 px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10">
                <motion.div 
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: trendColor }}
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
                <div className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">
                  实时情报
                </div>
              </div>
            )}
            <span className="text-[9px] font-bold tracking-wider text-zinc-400 uppercase">{metricLabel} ({unit})</span>
            {branchPathPoints.length > 1 && timelineVisible && (
              <span className="text-[8px] font-bold tracking-wider text-cyan-300 uppercase">
                {branchLabel ?? '分支预测'}
              </span>
            )}
          </div>
          <h2 className={`${compact ? 'text-sm' : 'text-xl'} font-black tracking-tight text-white uppercase italic`}>
            {compact ? metricLabel : (
              metricLabel.includes('风险') 
                ? <>{metricLabel.replace('指数', '')} <span className="text-zinc-600">指数</span></>
                : <>{metricLabel.split(' ')[0]} <span className="text-zinc-600">{metricLabel.split(' ').slice(1).join(' ') || 'Forecast'}</span></>
            )}
          </h2>
        </div>

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

      <div className="relative h-[320px] w-full overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
            const val = minVal + p * range;
            const y = getY(val);
            const label = range < 2 ? val.toFixed(2) : range < 10 ? val.toFixed(1) : Math.round(val);
            return (
              <g key={i} className="transition-opacity duration-1000">
                <line 
                  x1={padding.left} y1={y} x2={width - padding.right} y2={y} 
                  stroke="currentColor" className="text-zinc-700/50" strokeWidth="1" strokeDasharray="4 8" 
                />
                <text 
                  x={padding.left - 28} y={y} 
                  fill="currentColor" className="text-zinc-400 font-mono text-[12px] font-bold" 
                  textAnchor="end" dominantBaseline="middle"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* 横坐标标签 */}
          {timelineVisible ? (
            data.length > 0 && [0, Math.floor(data.length / 2), data.length - 1].map((idx) => (
              <text 
                key={idx}
                x={getX(idx, data.length)} y={height - padding.bottom + 28} 
                fill="currentColor" className="text-zinc-400 font-mono text-[11px] font-bold uppercase tracking-wider"
                textAnchor="middle"
              >
                {data[idx].time.split(' ')[1] || data[idx].time}
              </text>
            ))
          ) : (
            weeklyTimes && weeklyTimes.length > 0 && [0, Math.floor(weeklyTimes.length / 2), weeklyTimes.length - 1].map((idx) => (
              <text 
                key={idx}
                x={getX(idx, weeklyTimes.length)} y={height - padding.bottom + 28} 
                fill="currentColor" className="text-zinc-400 font-mono text-[11px] font-bold uppercase tracking-widest"
                textAnchor="middle"
              >
                {weeklyTimes[idx]}
              </text>
            ))
          )}

          {/* 增加坐标轴基准线 */}
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#3f3f46" strokeWidth="1" />
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#3f3f46" strokeWidth="1" />

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
                <defs>
                  <linearGradient id="glowGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                
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
            onMouseMove={(e) => {
              const svg = e.currentTarget.ownerSVGElement;
              if (!svg) return;
              const point = svg.createSVGPoint();
              point.x = e.clientX; point.y = e.clientY;
              const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());
              handleHover(svgPoint.x);
            }}
            onMouseLeave={() => handleHover(null)}
          />

          {hoveredPoint && (
            <motion.line initial={{ opacity: 0 }} animate={{ opacity: 1 }} x1={hoveredPoint.x} y1={padding.top} x2={hoveredPoint.x} y2={height - padding.bottom} stroke="rgba(255,255,255,0.1)" strokeWidth="1" className="pointer-events-none" />
          )}

          <AnimatePresence>
            {hoveredPoint && (
              <motion.foreignObject
                key="chart-tooltip"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                // 智能避让定位：如果鼠标在右半边，卡片显式在左边
                x={hoveredPoint.x > width * 0.6 ? hoveredPoint.x - 220 : hoveredPoint.x + 20}
                y={hoveredPoint.isWeekly ? height / 2 - 80 : Math.max(0, hoveredPoint.y - 120)}
                width="200"
                height="200"
                style={{ overflow: 'visible', pointerEvents: 'none' }}
              >
                <div className={`flex h-full ${hoveredPoint.x > width * 0.6 ? 'justify-end' : 'justify-start'} items-center`}>
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, x: hoveredPoint.x > width * 0.6 ? 10 : -10 }} 
                    animate={{ opacity: 1, scale: 1, x: 0 }} 
                    exit={{ opacity: 0, scale: 0.95, x: hoveredPoint.x > width * 0.6 ? 10 : -10 }} 
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} 
                    className="bg-zinc-900/95 backdrop-blur-xl border border-white/10 p-3.5 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] min-w-[140px] space-y-3"
                  >
                    <div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] border-b border-white/5 pb-2">{hoveredPoint.time}</div>
                    
                    {!hoveredPoint.isWeekly ? (
                      <div className="flex items-end gap-2">
                        <div className="text-2xl font-black text-white italic leading-none">{hoveredPoint.displayValue}</div>
                        <div className="text-[10px] text-zinc-400 font-bold mb-0.5">{unit}</div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {hoveredPoint.series?.map((s: any, i: number) => {
                          // 计算 'X 天前'，改用仿真时间作为参考基准
                          let dateLabel = s.label;
                          if (!s.isToday) {
                            const refDate = simTime ? new Date(simTime) : new Date();
                            const diff = Math.round((refDate.getTime() - new Date(s.date).getTime()) / (1000 * 60 * 60 * 24));
                            if (diff > 0) {
                              if (diff === 7) dateLabel = '上周同日';
                              else if (diff === 1) dateLabel = '昨天';
                              else dateLabel = `${diff}天前`;
                            } else {
                              dateLabel = s.label;
                            }
                          }
                          return (
                            <div key={i} className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full ${s.isToday ? 'bg-cyan-400' : 'bg-zinc-500'}`} />
                                <span className={`text-[10px] font-bold ${s.isToday ? 'text-white' : 'text-zinc-500'}`}>{dateLabel}</span>
                              </div>
                              <span className={`text-[11px] font-mono font-black ${s.isToday ? 'text-cyan-400' : 'text-zinc-300'}`}>
                                {s.value?.toFixed(1)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                </div>
              </motion.foreignObject>
            )}
          </AnimatePresence>
        </svg>
      </div>

    </motion.div>
  );
};

export default ForecastChart;
