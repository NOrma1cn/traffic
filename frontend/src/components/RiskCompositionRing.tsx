import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

interface RiskCompositionRingProps {
  riskScore: number;
  components: {
    speed: number;
    flow: number;
    occupancy: number;
  };
  labels: {
    speed: string;
    flow: string;
    occupancy: string;
  };
  units: {
    speed: string;
    flow: string;
    occupancy: string;
  };
  values: {
    speed: number;
    flow: number;
    occupancy: number;
  };
}

const RiskCompositionRing: React.FC<RiskCompositionRingProps> = ({
  riskScore,
  components,
  labels,
  units,
  values,
}) => {
  const size = 300;
  const strokeWidth = 14;
  const radius = (size - strokeWidth * 4) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = useMemo(() => {
    const rawRisks = [components.speed, components.flow, components.occupancy];
    const totalRisk = rawRisks.reduce((a, b) => a + b, 0);
    const isZeroRisk = totalRisk === 0;

    // Invasion Algorithm: Base(1/3) + IndividualRisk - (TotalRisk / 3)
    const baseShare = 1 / 3;
    let shares = rawRisks.map(r => baseShare + r - (totalRisk / 3));

    // Ensure a minimum visual "territory" (3%) so indicators don't completely vanish
    const minShare = 0.03;
    let deficit = 0;
    shares = shares.map(s => {
      if (s < minShare) {
        deficit += minShare - s;
        return minShare;
      }
      return s;
    });

    // Distribute deficit from those above minShare (simple proportional reduction)
    if (deficit > 0) {
      const surplusTotal = shares.reduce((acc, s) => acc + (s > minShare ? s - minShare : 0), 0);
      if (surplusTotal > 0) {
        shares = shares.map(s => s > minShare ? s - (deficit * (s - minShare) / surplusTotal) : s);
      }
    }

    const items = [
      { key: 'speed', val: shares[0], color: isZeroRisk ? '#164e63' : '#22d3ee', label: labels.speed, raw: values.speed, unit: units.speed, riskImpact: rawRisks[0] },
      { key: 'flow', val: shares[1], color: isZeroRisk ? '#064e3b' : '#10b981', label: labels.flow, raw: values.flow, unit: units.flow, riskImpact: rawRisks[1] },
      { key: 'occupancy', val: shares[2], color: isZeroRisk ? '#78350f' : '#f59e0b', label: labels.occupancy, raw: values.occupancy, unit: units.occupancy, riskImpact: rawRisks[2] },
    ];

    let currentOffset = 0;
    return {
      isZeroRisk,
      items: items.map((item) => {
        const percentage = item.val; // Already normalized
        const length = percentage * circumference;
        const offset = currentOffset;
        currentOffset += length;
        return { ...item, length, offset, percentage };
      })
    };
  }, [components, circumference, labels, units, values, riskScore]);

  return (
    <div className="relative flex flex-col items-center justify-center group/ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90 drop-shadow-[0_0_15px_rgba(255,255,255,0.05)]">
        {/* Background Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.03)"
          strokeWidth={strokeWidth}
        />
        
        {/* Glowing Base */}
        <circle
          cx={center}
          cy={center}
          r={radius + 8}
          fill="none"
          stroke="url(#ringGlow)"
          strokeWidth="1"
          opacity="0.3"
        />

        <defs>
          <radialGradient id="ringGlow" cx="50%" cy="50%" r="50%">
            <stop offset="80%" stopColor="transparent" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.2" />
          </radialGradient>
        </defs>

        {/* Segments */}
        {segments.items.map((seg, i) => (
          <motion.circle
            key={seg.key}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${seg.length} ${circumference}`}
            strokeDashoffset={-seg.offset}
            strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${seg.length} ${circumference}` }}
            transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1], delay: i * 0.1 }}
            className={`transition-all duration-500 ${segments.isZeroRisk ? 'opacity-40' : 'drop-shadow-[0_0_8px_var(--tw-shadow-color)]'}`}
            style={{ '--tw-shadow-color': seg.color } as any}
          />
        ))}

        {/* Decorative inner rings */}
        <circle cx={center} cy={center} r={radius - 20} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="2 4" />
        <circle cx={center} cy={center} r={radius + 20} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="4 8" />
      </svg>

      {/* Central Risk Info */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-0"
        >
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] ml-1">交通风险指数</span>
          <div className="flex items-baseline justify-center">
            <span className="text-6xl font-black italic tracking-tighter text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]">
              {(riskScore * 10).toFixed(1)}
            </span>
          </div>
          <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-full mt-2">
             <span className="text-[9px] font-bold text-zinc-400 tracking-widest uppercase">
                {riskScore > 0.7 ? '危急' : riskScore > 0.4 ? '异常' : '稳定'}
             </span>
          </div>
        </motion.div>
      </div>

      {/* Outer Labels/Legend */}
      <div className="mt-12 w-full max-w-[400px] grid grid-cols-3 gap-4">
        {segments.items.map((seg) => (
          <div key={seg.key} className="flex flex-col items-center gap-2 p-3 bg-white/5 border border-white/5 rounded-2xl backdrop-blur-md">
            <div className={`w-2 h-2 rounded-full ${segments.isZeroRisk ? 'opacity-30' : ''}`} style={{ backgroundColor: seg.color }} />
            <div className="text-[9px] font-black text-zinc-500 uppercase tracking-widest text-center">{seg.label}</div>
            
            <div className="flex flex-col items-center">
              <div className="flex items-baseline gap-1">
                <span className={`text-sm font-black transition-colors ${segments.isZeroRisk ? 'text-zinc-600' : 'text-white'}`}>{seg.raw.toFixed(0)}</span>
                <span className="text-[8px] font-bold text-zinc-600 truncate">{seg.unit}</span>
              </div>
              {!segments.isZeroRisk && seg.riskImpact > 0 && (
                <div className="text-[8px] font-bold text-rose-500 mt-0.5 animate-pulse">
                  +{ (seg.riskImpact * 100).toFixed(0) }% 风险贡献
                </div>
              )}
            </div>

            <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mt-1 text-[1px]">
               <motion.div 
                 className="h-full" 
                 style={{ backgroundColor: seg.color, opacity: segments.isZeroRisk ? 0.2 : 1 }}
                 initial={{ width: 0 }}
                 animate={{ width: `${seg.percentage * 100}%` }}
                 transition={{ duration: 1, delay: 0.5 }}
               />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RiskCompositionRing;
