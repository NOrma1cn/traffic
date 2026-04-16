import React, { useEffect, useRef, useMemo } from 'react';

const ROWS = 25;
const COLS = 55;

const COLORS = {
  orange: '#F59E0B',
  purple: '#8B5CF6',
  blue: '#3B82F6',
  white: '#E0E7FF',
  none: 'transparent'
};

const DotGridChart: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Generate stable offsets for each column
  const colOffsets = useMemo(() => Array.from({ length: COLS }, () => Math.random() * 0.2 - 0.1), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      ctx.clearRect(0, 0, rect.width, rect.height);

      const cellW = rect.width / COLS;
      const cellH = rect.height / ROWS;

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          let ratio = (y / (ROWS - 1)) + colOffsets[x];
          ratio = Math.max(0, Math.min(1, ratio));

          let size = 0;
          let color = COLORS.none;
          let opacity = 1;

          // Same logic as previous DOM version
          if (ratio > 0.85) {
            size = 10;
            color = COLORS.orange;
          } else if (ratio > 0.55) {
            size = 4 + Math.random() * 6;
            const rand = Math.random();
            if (rand > 0.8) color = COLORS.purple;
            else if (rand > 0.05) color = COLORS.orange;
            else color = COLORS.none;
          } else if (ratio > 0.3) {
            size = 3 + Math.random() * 5;
            const rand = Math.random();
            if (rand > 0.4) color = COLORS.purple;
            else if (rand > 0.2) color = Math.random() > 0.5 ? COLORS.orange : COLORS.blue;
            else if (rand > 0.1) color = COLORS.blue;
            else color = COLORS.none;
          } else {
            size = 2 + Math.random() * 3;
            const rand = Math.random();
            const threshold = 0.7 + (1 - ratio);
            
            if (rand > threshold) {
              color = Math.random() > 0.5 ? COLORS.white : COLORS.blue;
              if (Math.random() > 0.95) color = Math.random() > 0.5 ? COLORS.purple : COLORS.orange;
            } else {
              color = COLORS.none;
            }
            opacity = 0.4 + Math.random() * 0.6;
          }

          if (color !== COLORS.none) {
            ctx.globalAlpha = opacity;
            ctx.fillStyle = color;
            
            // Draw circle
            const centerX = x * cellW + cellW / 2;
            const centerY = y * cellH + cellH / 2;
            
            // Add subtle glow (simulated with shadow for efficiency)
            ctx.shadowBlur = size / 2;
            ctx.shadowColor = color;

            ctx.beginPath();
            ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
            ctx.fill();
            
            // Reset shadows for next dot
            ctx.shadowBlur = 0;
          }
        }
      }
    };

    draw();

    // Re-draw only on resize
    const handleResize = () => {
      const newRect = canvas.getBoundingClientRect();
      canvas.width = newRect.width * dpr;
      canvas.height = newRect.height * dpr;
      ctx.scale(dpr, dpr);
      draw();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [colOffsets]);

  return (
    <div className="relative w-full h-full flex flex-col p-8 bg-zinc-950/50 rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
      <div className="flex-1 min-h-0 w-full flex items-center justify-center p-4">
        <canvas 
          ref={canvasRef} 
          className="w-full h-full max-w-[900px] max-h-[400px]"
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};

export default DotGridChart;
