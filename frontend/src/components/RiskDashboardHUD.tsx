import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Wind, Zap } from 'lucide-react';

interface MetricState {
  label: string;
  current: number;
  predicted: number;
  limit: number;
  unit: string;
  color: string;
  weight: number;
}

interface RiskDashboardHUDProps {
  riskScore: number;
  selectedMetric: 'risk' | 'speed' | 'occupancy' | 'flow';
  onMetricSelect: (m: 'risk' | 'speed' | 'occupancy' | 'flow') => void;
  replaceRiskInstrument?: React.ReactNode;
  metrics: {
    speed: MetricState;
    flow: MetricState;
    occupancy: MetricState;
  };
}

const RiskDashboardHUD: React.FC<RiskDashboardHUDProps> = ({
  riskScore,
  selectedMetric,
  onMetricSelect,
  replaceRiskInstrument,
  metrics,
}) => {
  // GEOMETRIC CONSTANTS (Locked from Apollonian Solve)
  const arcCenterX = 700;
  const arcCenterY = 291.65;
  const arcRadius = 131.65;

  const startAngle = 0.3;     // Clamp Right
  const endAngle = 270;       // Clamp Top
  const totalSweep = 269.7;   // Total Sweep (Avoiding Top-Right Ring Cluster)
  const hudScale = 1.82;
  const hudOffsetX = -639;
  const hudOffsetY = -220;

  const ringConfigs = useMemo(() => [
    { key: 'speed' as const, ...metrics.speed, x: 780, y: 160, r: 80, icon: <Activity size={24} /> },
    { key: 'flow' as const, ...metrics.flow, x: 920, y: 160, r: 60, icon: <Zap size={20} /> },
    { key: 'occupancy' as const, ...metrics.occupancy, x: 867, y: 257, r: 50, icon: <Wind size={18} /> },
  ], [metrics]);

  const labelArcAngles = {
    speed: { start: 202, end: 292, sweep: 1 },
    flow: { start: 248, end: 338, sweep: 1 },
    occupancy: { start: 98, end: 8, sweep: 0 },
  } as const;

  // Derived Values
  const totalRisk = riskScore * 10;
  const riskStatus = totalRisk > 7 ? 'Critical' : totalRisk > 4 ? 'Alert' : 'Stable';
  const statusColor = totalRisk > 7 ? '#ef4444' : totalRisk > 4 ? '#f59e0b' : '#22d3ee';

  return (
    <div className="relative w-full min-h-[660px] select-none">
      <svg
        width="1100"
        height="500"
        viewBox="0 0 1100 500"
        className="h-auto w-full overflow-visible drop-shadow-[0_0_30px_rgba(34,211,238,0.15)]"
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.2" />
            <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        <g transform={`translate(${hudOffsetX} ${hudOffsetY})`}>
          <g transform={`scale(${hudScale})`}>
             {!replaceRiskInstrument && (
               <>
                 {/* ANALYTIC ARC (THE HULL) */}
                 <g className="opacity-60">
                    {/* Static Track */}
                   {[...Array(101)].map((_, i) => {
                     const angle = (startAngle + (i / 100) * totalSweep) * (Math.PI / 180);
                     const isMajor = i % 20 === 0;
                     const x1 = arcCenterX + (arcRadius - (isMajor ? 12 : 6)) * Math.cos(angle);
                     const y1 = arcCenterY + (arcRadius - (isMajor ? 12 : 6)) * Math.sin(angle);
                     const x2 = arcCenterX + (arcRadius + (isMajor ? 12 : 6)) * Math.cos(angle);
                     const y2 = arcCenterY + (arcRadius + (isMajor ? 12 : 6)) * Math.sin(angle);
                     return (
                       <line 
                         key={`static-${i}`} 
                         x1={x1} y1={y1} x2={x2} y2={y2} 
                         stroke="rgba(148,163,184,0.15)" 
                         strokeWidth={isMajor ? 2 : 1} 
                       />
                     );
                   })}
                   
                   {/* Active Risk Ticks */}
                   {[...Array(101)].map((_, i) => {
                     const progress = i / 100;
                     if (progress > riskScore) return null;

                     const angle = (startAngle + progress * totalSweep) * (Math.PI / 180);
                     const isMajor = i % 20 === 0;
                     const x1 = arcCenterX + (arcRadius - (isMajor ? 15 : 8)) * Math.cos(angle);
                     const y1 = arcCenterY + (arcRadius - (isMajor ? 15 : 8)) * Math.sin(angle);
                     const x2 = arcCenterX + (arcRadius + (isMajor ? 15 : 8)) * Math.cos(angle);
                     const y2 = arcCenterY + (arcRadius + (isMajor ? 15 : 8)) * Math.sin(angle);

                     const isRiskSelected = selectedMetric === 'risk';
                     const activeColor = isRiskSelected ? '#22c55e' : '#f8fafc';

                     return (
                       <motion.line
                         key={`active-${i}`}
                         x1={x1} y1={y1} x2={x2} y2={y2}
                         stroke={activeColor}
                         strokeWidth={isMajor ? 4 : 2}
                         initial={{ opacity: 0 }}
                         animate={{ opacity: 1 }}
                         transition={{ delay: i * 0.005 }}
                       />
                     );
                   })}
                </g>

                {/* Bridge Spline (The "Welding" Path) */}
                <path
                  d={`M 780 160 Q 700 160 ${arcCenterX} ${arcCenterY - arcRadius}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                  strokeDasharray="5 5"
                />
              </>
            )}

            {/* METRIC RINGS */}
            {ringConfigs.map((cfg) => {
              const isSelected = selectedMetric === cfg.key;
              const labelRadius = cfg.r + 12;
              const labelArc = labelArcAngles[cfg.key];
              const labelStart = {
                x: cfg.x + labelRadius * Math.cos((labelArc.start * Math.PI) / 180),
                y: cfg.y + labelRadius * Math.sin((labelArc.start * Math.PI) / 180),
              };
              const labelEnd = {
                x: cfg.x + labelRadius * Math.cos((labelArc.end * Math.PI) / 180),
                y: cfg.y + labelRadius * Math.sin((labelArc.end * Math.PI) / 180),
              };
              const labelPathId = `metric-label-arc-${cfg.key}`;

              return (
                <g key={cfg.key} className="cursor-pointer" onClick={() => onMetricSelect(cfg.key)}>
                  <defs>
                    <path
                      id={labelPathId}
                      d={`M ${labelStart.x} ${labelStart.y} A ${labelRadius} ${labelRadius} 0 0 ${labelArc.sweep} ${labelEnd.x} ${labelEnd.y}`}
                    />
                  </defs>

                  {/* Background Glow */}
                  <circle
                    cx={cfg.x}
                    cy={cfg.y}
                    r={cfg.r + 10}
                    fill="none"
                    stroke={cfg.color}
                    strokeWidth="1"
                    opacity={isSelected ? 0.2 : 0}
                    className="transition-opacity duration-500"
                  />

                  {/* Outer Boundary */}
                  <circle
                    cx={cfg.x}
                    cy={cfg.y}
                    r={cfg.r}
                    fill="rgba(10,10,12,0.6)"
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth="1"
                    className="backdrop-blur-sm"
                  />

                  {/* Progress Bar (Dual-Layer Predictive System) */}
                  {(() => {
                    const baseProgress = Math.min(1, cfg.current / (cfg.limit || 100));
                    const forecastProgress = Math.min(1, cfg.predicted / (cfg.limit || 100));
                    const isIncreasing = forecastProgress > baseProgress;
                    const circumference = 2 * Math.PI * (cfg.r - 5);

                    const maxProgress = Math.max(baseProgress, forecastProgress);
                    const minProgress = Math.min(baseProgress, forecastProgress);

                    return (
                      <>
                        {/* Layer 1: Predictive Delta (Background) */}
                        <motion.circle
                          cx={cfg.x}
                          cy={cfg.y}
                          r={cfg.r - 5}
                          fill="none"
                          stroke={isIncreasing ? '#10b981' : '#f43f5e'}
                          strokeWidth="10"
                          strokeDasharray={`${maxProgress * circumference} ${circumference}`}
                          strokeLinecap="round"
                          transform={`rotate(-90 ${cfg.x} ${cfg.y})`}
                          initial={{ strokeDasharray: `0 ${circumference}` }}
                          animate={{ strokeDasharray: `${maxProgress * circumference} ${circumference}` }}
                          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                          opacity={isSelected ? 0.6 : 0.3}
                        />
                        {/* Layer 2: Current Status (Foreground) */}
                        <motion.circle
                          cx={cfg.x}
                          cy={cfg.y}
                          r={cfg.r - 5}
                          fill="none"
                          stroke={cfg.color}
                          strokeWidth="10"
                          strokeDasharray={`${minProgress * circumference} ${circumference}`}
                          strokeLinecap="round"
                          transform={`rotate(-90 ${cfg.x} ${cfg.y})`}
                          initial={{ strokeDasharray: `0 ${circumference}` }}
                          animate={{ strokeDasharray: `${minProgress * circumference} ${circumference}` }}
                          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                          opacity={isSelected ? 1 : 0.7}
                        />
                      </>
                    );
                  })()}

                  {/* Ring Label */}
                  <text
                    className="pointer-events-none fill-white text-[14px] font-medium tracking-[0.26em]"
                    opacity={isSelected ? 1 : 0.86}
                  >
                    <textPath href={`#${labelPathId}`} startOffset="50%" textAnchor="middle">
                      {cfg.label}
                    </textPath>
                  </text>

                  {/* Metric Metadata */}
                  <foreignObject
                    x={cfg.x - cfg.r}
                    y={cfg.y - cfg.r}
                    width={cfg.r * 2}
                    height={cfg.r * 2}
                  >
                     <div className="w-full h-full flex flex-col items-center justify-center text-center p-2">
                        <div className={`transition-transform duration-300 ${isSelected ? 'scale-110' : 'scale-100'}`} style={{ color: cfg.color }}>
                          {cfg.icon}
                        </div>
                        <div className="mt-2 flex flex-col items-center text-white">
                           <span className="text-lg font-black text-white leading-none">{(cfg.current).toFixed(1)}</span>
                           <span className="mt-0.5 text-xs font-black uppercase leading-none text-white">{cfg.unit}</span>
                        </div>
                     </div>
                  </foreignObject>
                </g>
              );
            })}

            {replaceRiskInstrument ? (
              <foreignObject x={arcCenterX - 130} y={arcCenterY - 130} width={260} height={260}>
                <div className="flex h-full w-full items-center justify-center overflow-visible">
                  {replaceRiskInstrument}
                </div>
              </foreignObject>
            ) : (
              /* CENTRAL RISK INSTRUMENT */
              <g onClick={() => onMetricSelect('risk')} className="cursor-pointer">
                 <text 
                   x={arcCenterX} 
                   y={arcCenterY + 20} 
                   textAnchor="middle" 
                   className="font-technical text-6xl font-black italic fill-white drop-shadow-[0_0_20px_rgba(34,211,238,0.3)]"
                 >
                   {(riskScore * 100).toFixed(0)}%
                 </text>
              </g>
            )}
          </g>
        </g>

      </svg>
    </div>
  );
};

export default RiskDashboardHUD;
