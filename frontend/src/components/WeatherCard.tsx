import React from 'react';
import { motion } from 'framer-motion';
import { CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Cloudy, Droplets, Sun, Wind } from 'lucide-react';
import { getWeatherDisplayLabel, type WeatherDisplayCondition } from '../weather';

interface WeatherCardProps {
  temp: number;
  condition: WeatherDisplayCondition;
  humidity: number;
  windSpeed: number;
  delay?: number;
}

const WeatherCard: React.FC<WeatherCardProps> = ({ temp, condition, humidity, windSpeed, delay = 0 }) => {
  const displayLabel = getWeatherDisplayLabel(condition);

  const getIcon = () => {
    switch (condition) {
      case 'Sunny': return <Sun className="text-amber-400" size={32} strokeWidth={1.5} />;
      case 'PartlyCloudy': return <CloudSun className="text-sky-300" size={32} strokeWidth={1.5} />;
      case 'Overcast': return <Cloudy className="text-zinc-300" size={32} strokeWidth={1.5} />;
      case 'Foggy': return <CloudFog className="text-cyan-200" size={32} strokeWidth={1.5} />;
      case 'Drizzle': return <CloudDrizzle className="text-sky-400" size={32} strokeWidth={1.5} />;
      case 'Rainy': return <CloudRain className="text-indigo-400" size={32} strokeWidth={1.5} />;
      case 'Stormy': return <CloudLightning className="text-violet-300" size={32} strokeWidth={1.5} />;
      case 'Windy': return <Wind className="text-emerald-300" size={32} strokeWidth={1.5} />;
    }
  };

  const getGradient = () => {
    switch (condition) {
      case 'Sunny': return 'from-amber-500/10 to-transparent';
      case 'PartlyCloudy': return 'from-sky-500/10 to-transparent';
      case 'Overcast': return 'from-zinc-500/10 to-transparent';
      case 'Foggy': return 'from-cyan-500/10 to-transparent';
      case 'Drizzle': return 'from-sky-500/10 to-transparent';
      case 'Rainy': return 'from-indigo-500/10 to-transparent';
      case 'Stormy': return 'from-violet-500/10 to-transparent';
      case 'Windy': return 'from-emerald-500/10 to-transparent';
    }
  };

  const getDrivingNote = () => {
    switch (condition) {
      case 'Sunny':
      case 'PartlyCloudy':
        return '适宜驾驶';
      case 'Overcast':
      case 'Windy':
        return '轻微气象干扰';
      case 'Foggy':
      case 'Drizzle':
        return '能见度下降';
      case 'Rainy':
        return '路面受影响';
      case 'Stormy':
        return '严重气象干扰';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: delay * 0.1 }}
      className={`bg-[#18181B]/80 backdrop-blur-md border border-zinc-800/50 rounded-2xl p-6 relative overflow-hidden group shadow-2xl`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${getGradient()} opacity-100`} />
      <div className="flex justify-between items-start relative z-10">
        <div className="space-y-1">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">环境状态</p>
          <div className="flex items-center gap-2">
            <h3 className="text-2xl font-bold text-white tracking-tighter">{temp}°C</h3>
            <span className="text-sm font-medium text-zinc-400">{displayLabel}</span>
          </div>
        </div>
        <motion.div 
          animate={condition === 'Sunny' ? { rotate: 360 } : condition === 'Stormy' ? { scale: [1, 1.08, 1] } : { y: [0, -5, 0] }}
          transition={condition === 'Sunny' ? { duration: 10, repeat: Infinity, ease: "linear" } : condition === 'Stormy' ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          {getIcon()}
        </motion.div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 relative z-10">
        <div className="bg-zinc-900/50 border border-zinc-800/30 rounded-xl p-3 flex items-center gap-3">
          <Droplets size={16} className="text-indigo-400/70" />
          <div>
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-tighter">相对湿度</p>
            <p className="text-xs font-bold text-zinc-200">{humidity}%</p>
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/30 rounded-xl p-3 flex items-center gap-3">
          <Wind size={16} className="text-emerald-400/70" />
          <div>
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-tighter">风速</p>
            <p className="text-xs font-bold text-zinc-200">{windSpeed} km/h</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${condition === 'Stormy' ? 'bg-violet-400' : condition === 'Rainy' || condition === 'Drizzle' || condition === 'Foggy' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
        <p className="text-[9px] font-medium text-zinc-500 uppercase tracking-widest">{getDrivingNote()}</p>
      </div>
    </motion.div>
  );
};

export default WeatherCard;
