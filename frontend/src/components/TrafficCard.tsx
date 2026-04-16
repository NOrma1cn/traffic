import React from 'react';
import { motion } from 'framer-motion';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

interface TrafficCardProps {
  title: string;
  value: string;
  unit: string;
  change: string;
  isPositive: boolean;
  data: { value: number }[];
  icon: React.ReactNode;
  delay?: number;
}

const TrafficCard: React.FC<TrafficCardProps> = ({ 
  title, 
  value, 
  unit, 
  change, 
  isPositive, 
  data, 
  icon,
  delay = 0 
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ 
        duration: 0.6, 
        delay: delay * 0.1, 
        ease: [0.22, 1, 0.36, 1] // Ease-out exponential, no bounce
      }}
      className="bg-[#18181B]/80 backdrop-blur-md border border-zinc-800/50 rounded-2xl p-5 relative overflow-hidden group shadow-2xl"
    >
      <div className="flex justify-between items-start relative z-10">
        <div>
          <p className="text-zinc-400 text-sm font-medium mb-1">{title}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-semibold text-white tracking-tight">{value}</span>
            <span className="text-xs text-zinc-500">{unit}</span>
          </div>
        </div>
        <div className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl group-hover:border-zinc-700 transition-colors duration-300">
          {icon}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 relative z-10">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          isPositive ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
        }`}>
          {isPositive ? '↑' : '↓'} {change}
        </span>
        <span className="text-xs text-zinc-500">较上一小时</span>
      </div>

      {/* Background Sparkline */}
      <div className="absolute bottom-0 left-0 right-0 h-16 opacity-30">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? '#10b981' : '#f43f5e'} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={isPositive ? '#10b981' : '#f43f5e'} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <Area 
              type="monotone" 
              dataKey="value" 
              stroke={isPositive ? '#10b981' : '#f43f5e'} 
              strokeWidth={2}
              fillOpacity={1} 
              fill={`url(#gradient-${title})`} 
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

export default TrafficCard;
