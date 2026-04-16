import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

interface EqualizerData {
  weights: [number, number, number]; // [Cyan, Pink, Purple]
}

const WeightedEqualizer: React.FC = () => {
  // Generate 24 columns of random weighted data for demo
  const data: EqualizerData[] = useMemo(() => {
    return Array.from({ length: 24 }, () => ({
      weights: [
        Math.random() * 30 + 10,  // Weight 1: 10% - 40%
        Math.random() * 20 + 5,   // Weight 2: 5% - 25%
        Math.random() * 40 + 10   // Weight 3: 10% - 50%
      ]
    }));
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center p-12 bg-zinc-950/40 rounded-3xl border border-white/5 shadow-inner overflow-hidden">
      {/* Main Equalizer Container */}
      <div className="flex items-center justify-center h-[260px] gap-3 px-10 py-8 bg-zinc-900/40 border border-white/5 rounded-3xl backdrop-blur-sm">
        {data.map((col, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="w-2.5 h-full flex flex-col justify-center gap-1.5"
          >
            <div 
              className="w-full bg-[#5be5cd] rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(91,229,205,0.3)]"
              style={{ height: `${col.weights[0]}%` }}
            />
            <div 
              className="w-full bg-[#ff477e] rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(255,71,126,0.3)]"
              style={{ height: `${col.weights[1]}%` }}
            />
            <div 
              className="w-full bg-[#8b3dff] rounded-full transition-all duration-500 shadow-[0_0_10px_rgba(139,61,255,0.3)]"
              style={{ height: `${col.weights[2]}%` }}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
};

const LegendItem = ({ color, label }: { color: string, label: string }) => (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-1.5 rounded-full ${color} shadow-sm`} />
      <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{label}</span>
    </div>
);

export default WeightedEqualizer;
