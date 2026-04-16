import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, ShieldCheck } from 'lucide-react';

interface FeaturePopupProps {
  isVisible: boolean;
  onClose: () => void;
}

export const FeaturePopup: React.FC<FeaturePopupProps> = ({ isVisible, onClose }) => {
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        onClose();
      }, 5000); // 5秒后自动关闭
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, x: 100, y: 100, scale: 0.8 }}
          animate={{ opacity: 1, x: -32, y: -32, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.3 } }}
          transition={{ 
            type: "spring", 
            stiffness: 260, 
            damping: 20,
            duration: 0.6 
          }}
          className="fixed bottom-0 right-0 z-[1000] select-none pointer-events-none"
        >
          <div className="relative w-64 h-32 bg-[#050505]/95 backdrop-blur-3xl border border-zinc-800/80 rounded-2xl overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.8)] flex flex-col justify-center px-6">
            
            {/* RTX Style Scanning Line */}
            <motion.div 
              initial={{ left: '-100%' }}
              animate={{ left: '100%' }}
              transition={{ 
                duration: 1.2, 
                ease: "easeInOut",
                delay: 0.4
              }}
              className="absolute top-0 bottom-0 w-1 bg-emerald-400 z-10 shadow-[0_0_20px_#10b981]"
            />

            {/* Split Background Contrast (Simulating RTX ON) */}
            <motion.div 
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ 
                duration: 1.2, 
                ease: "easeInOut",
                delay: 0.4
              }}
              className="absolute top-0 bottom-0 left-0 bg-emerald-500/5 border-r border-emerald-500/20"
            />

            {/* Content Container */}
            <div className="relative z-20">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                  <ShieldCheck size={18} className="text-emerald-400" />
                </div>
                <div className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500">
                  神经核心
                </div>
              </div>

              <div className="flex flex-col">
                <h4 className="text-2xl font-black italic tracking-tighter text-white flex items-baseline gap-2">
                  <span className="text-emerald-400">AI</span>
                  <span>已激活</span>
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  <div className="h-1 flex-1 bg-zinc-900 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: '0%' }}
                      animate={{ width: '100%' }}
                      transition={{ duration: 1.5, delay: 1 }}
                      className="h-full bg-emerald-500" 
                    />
                  </div>
                  <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-widest">已优化</span>
                </div>
              </div>
            </div>

            {/* Corner Decorative Dots */}
            <div className="absolute top-4 right-4 flex gap-1">
              <div className="w-1 h-1 rounded-full bg-emerald-500/30" />
              <div className="w-1 h-1 rounded-full bg-emerald-500/30" />
            </div>

            {/* Subtle Sound-wave visualization */}
            <div className="absolute bottom-4 left-6 right-6 flex items-end gap-1 h-2 opacity-20">
              {Array.from({ length: 12 }).map((_, i) => (
                <motion.div
                  key={i}
                  animate={{ height: ['20%', '80%', '40%'] }}
                  transition={{ 
                    repeat: Infinity, 
                    duration: 0.8, 
                    delay: i * 0.1,
                    ease: "easeInOut"
                  }}
                  className="flex-1 bg-emerald-500 rounded-full"
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
