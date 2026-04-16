import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface CongestionWarningProps {
  level: 'low' | 'medium' | 'high';
  reason: string;
}

const CongestionWarning: React.FC<CongestionWarningProps> = ({ level, reason }) => {
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    setTrigger(t => t + 1);
  }, [level, reason]);

  const colors = {
    low: { primary: '#eab308' },
    medium: { primary: '#f59e0b' },
    high: { primary: '#ef4444' },
  };

  const c = colors[level];
  const size = 600; 
  const cx = 60;     
  const cy = 540;  

  const getRelativeArc = (r: number) => {
    const startAngle = -120;
    const endAngle = 96;
    const startRad = startAngle * Math.PI / 180;
    const endRad = endAngle * Math.PI / 180;
    const x1 = r * Math.cos(startRad);
    const y1 = r * Math.sin(startRad);
    const x2 = r * Math.cos(endRad);
    const y2 = r * Math.sin(endRad);
    return `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`;
  };

  return (
    <div 
      className="absolute bottom-0 left-0 z-40 pointer-events-none select-none" 
      style={{ width: '600px', height: '600px' }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full overflow-visible" style={{ overflow: 'visible' }}>
        <defs>
          <clipPath id="wedge-mask-final">
            <path d={`M 0 0 L ${1000 * Math.cos(-120 * Math.PI / 180)} ${1000 * Math.sin(-120 * Math.PI / 180)} A 1000 1000 0 1 1 ${1000 * Math.cos(96 * Math.PI / 180)} ${1000 * Math.sin(96 * Math.PI / 180)} Z`} />
          </clipPath>
        </defs>

        <g transform={`translate(${cx}, ${cy})`}>
          
          {/* 1. 一次性全圆脉冲拖尾 */}
          <motion.circle
            key={`pulse-${trigger}`}
            cx={0} cy={0}
            fill="none"
            stroke={c.primary}
            initial={{ r: 10, strokeWidth: 350, opacity: 1 }}
            animate={{ r: 700, strokeWidth: 0, opacity: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />

          {/* 动画集合体：结束后缓慢收缩，进入待机沉浸状态 */}
          <motion.g
            key={`assembly-${trigger}`}
            initial={{ scale: 1, opacity: 1 }}
            animate={{ scale: 0.85, opacity: 0.65 }}
            transition={{ delay: 2.8, duration: 6, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: '0px 0px' }}
          >
            {/* 2. 静止厚轨道 */}
            <motion.g key={`static-tracks-${trigger}`}>
              <motion.path 
                d={getRelativeArc(160)} fill="none" stroke={c.primary} strokeWidth="50" opacity="0.15" 
                initial={{ opacity: 0 }} animate={{ opacity: 0.15 }} transition={{ delay: 0.1 }}
              />
              <motion.path 
                d={getRelativeArc(260)} fill="none" stroke={c.primary} strokeWidth="30" opacity="0.08" 
                initial={{ opacity: 0 }} animate={{ opacity: 0.08 }} transition={{ delay: 0.2 }}
              />
            </motion.g>

            {/* 3. 完美绕圆心公转的文字 */}
            <g clipPath="url(#wedge-mask-final)">
              <motion.g
                key={`orbit-main-${trigger}`}
                initial={{ rotate: -720, opacity: 0 }}
                animate={{ rotate: [-720, -360, 0], opacity: [0, 1, 1] }}
                transition={{ 
                  duration: 2.4, 
                  times: [0, 0.5, 1], 
                  ease: [[0.16, 1, 0.3, 1], [0.42, 0, 0.58, 1]] 
                }}
                style={{ transformOrigin: "50% 50%" }}
              >
                {/* 隐形大圆确保中心点绝对在 0,0 */}
                <circle cx="0" cy="0" r="500" fill="none" />
                <path id={`guide-main-${trigger}`} d="M -160 0 A 160 160 0 0 1 160 0 A 160 160 0 0 1 -160 0" fill="none" />
                
                {/* 扫描占位符文本 (减速期间渐隐) */}
                <motion.text fill={c.primary} fontSize="20" fontWeight="900" letterSpacing="4"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.4, delay: 0.8, ease: [0.4, 0, 0.2, 1] }}
                >
                  <textPath href={`#guide-main-${trigger}`} startOffset="27%" dominantBaseline="middle">
                    {`正在扫描路网状态`}
                  </textPath>
                </motion.text>

                {/* 真实警告文本 (加速期间渐隐进入) */}
                <motion.text fill={c.primary} fontSize="20" fontWeight="900" letterSpacing="4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 1.2, ease: [0.4, 0, 0.2, 1] }}
                >
                  <textPath href={`#guide-main-${trigger}`} startOffset="27%" dominantBaseline="middle">
                    {`路况评估：${level === 'high' ? '高风险' : level === 'medium' ? '中等风险' : '低风险'}`}
                  </textPath>
                </motion.text>
              </motion.g>

              <motion.g
                key={`orbit-sub-${trigger}`}
                initial={{ rotate: -720, opacity: 0 }}
                animate={{ rotate: [-720, -360, 0], opacity: [0, 1, 1] }}
                transition={{ 
                  duration: 2.8, 
                  times: [0, 0.5, 1], 
                  ease: [[0.16, 1, 0.3, 1], [0.42, 0, 0.58, 1]] 
                }}
                style={{ transformOrigin: "50% 50%" }}
              >
                <circle cx="0" cy="0" r="500" fill="none" />
                <path id={`guide-sub-${trigger}`} d="M -260 0 A 260 260 0 0 1 260 0 A 260 260 0 0 1 -260 0" fill="none" />
                
                {/* 扫描占位符文本 */}
                <motion.text fill={c.primary} fontSize="12" fontWeight="bold" letterSpacing="2"
                  initial={{ opacity: 0.9 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.4, delay: 1.0, ease: [0.4, 0, 0.2, 1] }}
                >
                  <textPath href={`#guide-sub-${trigger}`} startOffset="30%" dominantBaseline="middle">
                    {`正在分析拥堵特征`}
                  </textPath>
                </motion.text>

                {/* 实际原因文本 */}
                <motion.text fill={c.primary} fontSize="12" fontWeight="bold" letterSpacing="2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.9 }}
                  transition={{ duration: 0.5, delay: 1.4, ease: [0.4, 0, 0.2, 1] }}
                >
                  <textPath href={`#guide-sub-${trigger}`} startOffset="30%" dominantBaseline="middle">
                    {`预测原因：${reason}`}
                  </textPath>
                </motion.text>
              </motion.g>
            </g>
          </motion.g>

          {/* 4. 中心锚点 */}
          <motion.circle 
            key={`center-${trigger}`}
            cx={0} cy={0} r="20" fill={c.primary}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
          <text x={0} y={0} fill="#000" fontSize="11" fontWeight="900" textAnchor="middle" dominantBaseline="middle">
            {level === 'high' ? '03' : level === 'medium' ? '02' : '01'}
          </text>
          
          <circle 
            cx={0} cy={0} r="100" 
            fill="transparent" 
            className="pointer-events-auto cursor-pointer" 
            onClick={() => setTrigger(t => t + 1)}
          />

        </g>
      </svg>
    </div>
  );
};

export default CongestionWarning;