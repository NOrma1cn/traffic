import React, { useLayoutEffect, useRef, useState, useMemo } from 'react';
import { motion, useAnimation } from 'framer-motion';

export interface FlowNode {
  id: string;
  title: string;
  value: string;
  subValue: string;
  thickness: number;
  gradient: {
    from: string;
    to: string;
    fromOpacity?: number;
    toOpacity?: number;
  };
  icon?: React.ReactNode;
}

interface SankeyFlowChartProps {
  leftNodes: FlowNode[];
  rightNodes: FlowNode[];
  centerNode: {
    title: string;
    bigValue?: string;
    smallValue: string;
    icon?: React.ReactNode;
  };
  className?: string;
  height?: number;
  hideTitle?: boolean;
  compact?: boolean;
  background?: boolean;
}

const SankeyFlowChart: React.FC<SankeyFlowChartProps> = ({
  leftNodes,
  rightNodes,
  centerNode,
  className = "",
  height = 600,
  hideTitle = false,
  compact = false,
  background = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const centerLRef = useRef<HTMLDivElement>(null);
  const centerRRef = useRef<HTMLDivElement>(null);
  const leftAnchorRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const rightAnchorRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const [paths, setPaths] = useState<{ full: string; collapsed: string }[]>([]);
  const [gradientIds, setGradientIds] = useState<{ id: string; node: FlowNode; side: 'L' | 'R' }[]>([]);
  const [isHovered, setIsHovered] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const calculatePaths = () => {
    if (!containerRef.current || !svgRef.current || !centerLRef.current || !centerRRef.current) return;

    const container = containerRef.current;
    const cWidth = container.offsetWidth;
    const cHeight = container.offsetHeight;

    if (cWidth === 0 || cHeight === 0) return;

    // Stable constants based on fixed Tailwind classes (w-56/72)
    const CENTER_SIZE = compact ? 224 : 288;
    const JUNCTION_RATIO = 0.9; // Matches top-[5%] bottom-[5%]

    // Helper to get coordinates relative to the root container
    const getRelativeCoords = (el: HTMLElement) => {
      let top = 0;
      let left = 0;
      let current: HTMLElement | null = el;
      while (current && current !== container) {
        top += current.offsetTop;
        left += current.offsetLeft;
        current = current.offsetParent as HTMLElement;
      }
      return { top, left, width: el.offsetWidth, height: el.offsetHeight };
    };

    // Use a mix of layout measurement and stable constants for the center node
    const cNode = getRelativeCoords(centerLRef.current.parentElement as HTMLElement);
    
    // Stable center junction bounds (immune to mount-time measurement errors)
    const centerLeftHeight = CENTER_SIZE * JUNCTION_RATIO;
    const cLeftTop = cNode.top + (CENTER_SIZE * (1 - JUNCTION_RATIO) / 2);
    const cLeftX = cNode.left;

    const centerRightHeight = CENTER_SIZE * JUNCTION_RATIO;
    const cRightTop = cNode.top + (CENTER_SIZE * (1 - JUNCTION_RATIO) / 2);
    const cRightX = cNode.left + CENTER_SIZE;

    const newPaths: { full: string; collapsed: string }[] = [];
    const newGradients: { id: string; node: FlowNode; side: 'L' | 'R' }[] = [];

    const createRibbonD = (startX: number, startY: number, endX: number, endTopY: number, endBottomY: number, thickness: number, isRightSide: boolean) => {
      const offset = Math.abs(endX - startX) * 0.5;
      const cp1X = isRightSide ? startX - offset : startX + offset;
      const cp2X = isRightSide ? endX + offset : endX - offset;

      return `
        M ${startX} ${startY - thickness / 2}
        C ${cp1X} ${startY - thickness / 2}, ${cp2X} ${endTopY}, ${endX} ${endTopY}
        L ${endX} ${endBottomY}
        C ${cp2X} ${endBottomY}, ${cp1X} ${startY + thickness / 2}, ${startX} ${startY + thickness / 2}
        Z
      `;
    };

    const getScaleFactor = (nodes: FlowNode[], availableHeight: number) => {
      const sum = nodes.reduce((acc, n) => acc + (n.thickness || 1), 0);
      return (sum > 0 && sum > availableHeight * 0.95) ? (availableHeight * 0.95) / sum : 1;
    };

    const scaleL = getScaleFactor(leftNodes, centerLeftHeight);
    const totalThicknessL = leftNodes.reduce((acc, n) => acc + (n.thickness || 1), 0) * scaleL;
    let currentCenterYLeft = cLeftTop + (centerLeftHeight - totalThicknessL) / 2;

    leftNodes.forEach((node) => {
      const anchorEl = leftAnchorRefs.current[node.id];
      if (!anchorEl) return;
      const anchor = getRelativeCoords(anchorEl);
      const scaledThickness = (node.thickness || 1) * scaleL;
      const startX = anchor.left + anchor.width;
      const startY = anchor.top + anchor.height / 2;
      
      const full = createRibbonD(startX, startY, cLeftX, currentCenterYLeft, currentCenterYLeft + scaledThickness, scaledThickness, false);
      const collapsed = createRibbonD(cLeftX, currentCenterYLeft + scaledThickness/2, cLeftX, currentCenterYLeft, currentCenterYLeft + scaledThickness, scaledThickness, false);
      
      newPaths.push({ full, collapsed });
      newGradients.push({ id: `grad-${node.id}`, node, side: 'L' });
      currentCenterYLeft += scaledThickness;
    });

    const scaleR = getScaleFactor(rightNodes, centerRightHeight);
    const totalThicknessR = rightNodes.reduce((acc, n) => acc + (n.thickness || 1), 0) * scaleR;
    let currentCenterYRight = cRightTop + (centerRightHeight - totalThicknessR) / 2;

    rightNodes.forEach((node) => {
      const anchorEl = rightAnchorRefs.current[node.id];
      if (!anchorEl) return;
      const anchor = getRelativeCoords(anchorEl);
      const scaledThickness = (node.thickness || 1) * scaleR;
      const startX = anchor.left;
      const startY = anchor.top + anchor.height / 2;
      
      const full = createRibbonD(startX, startY, cRightX, currentCenterYRight, currentCenterYRight + scaledThickness, scaledThickness, true);
      const collapsed = createRibbonD(cRightX, currentCenterYRight + scaledThickness/2, cRightX, currentCenterYRight, currentCenterYRight + scaledThickness, scaledThickness, true);
      
      newPaths.push({ full, collapsed });
      newGradients.push({ id: `grad-${node.id}`, node, side: 'R' });
      currentCenterYRight += scaledThickness;
    });

    setPaths(newPaths);
    setGradientIds(newGradients);
    setIsReady(true);
  };

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(calculatePaths);
    });
    observer.observe(containerRef.current);
    calculatePaths();
    return () => observer.disconnect();
  }, [leftNodes, rightNodes, height, compact, isHovered]);

  return (
    <div 
      ref={containerRef} 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative w-full flex justify-between items-center overflow-hidden transition-all duration-700 ${compact ? 'px-2 py-6' : 'p-6 md:p-10'} ${background ? 'bg-[#0B0D14] rounded-2xl border border-white/5' : ''} ${className}`}
      style={{ height }}
    >
      {/* Background Title */}
      {!hideTitle && (
        <div className="absolute top-8 w-full text-center pointer-events-none select-none z-0">
          <h2 className={`font-black uppercase tracking-[0.2em] text-white/[0.04] ${compact ? 'text-[32px]' : 'text-[64px]'}`}>
            气象拓扑流量
          </h2>
        </div>
      )}

      {/* Dotted Circle Decoration */}
      {!compact && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-dashed border-white/10 rounded-full pointer-events-none z-[1]" />
      )}

      {/* SVG Canvas for Ribbons */}
      <svg 
        ref={svgRef} 
        className="absolute inset-0 w-full h-full z-[2] pointer-events-none mix-blend-screen"
      >
        <defs>
          {gradientIds.map(({ id, node, side }) => (
            <linearGradient key={id} id={id} x1="0%" y1="0%" x2="100%" y2="0%">
              {side === 'L' ? (
                <>
                  <stop offset="0%" stopColor={node.gradient.from} stopOpacity={node.gradient.fromOpacity ?? 0.9} />
                  <stop offset="100%" stopColor={node.gradient.to} stopOpacity={node.gradient.toOpacity ?? 0.4} />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor={node.gradient.from} stopOpacity={node.gradient.fromOpacity ?? 0.4} />
                  <stop offset="100%" stopColor={node.gradient.to} stopOpacity={node.gradient.toOpacity ?? 0.9} />
                </>
              )}
            </linearGradient>
          ))}
        </defs>
        {paths.map((pathObj, i) => (
          <motion.path
            key={i}
            initial={{ d: pathObj.collapsed, opacity: 0 }}
            animate={{ 
               d: isHovered ? pathObj.full : pathObj.collapsed,
               opacity: isHovered ? 1 : 0,
            }}
            transition={{ 
              d: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
              opacity: { duration: 0.6, ease: "linear" }
            }}
            fill={`url(#${gradientIds[i]?.id})`}
          />
        ))}
      </svg>

      {/* Left Column Nodes */}
      <motion.div 
        animate={{ 
          opacity: isHovered ? 1 : 0,
          x: isHovered ? 0 : -20,
        }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className={`flex flex-col justify-around h-full z-[3] ${compact ? 'w-[140px]' : 'w-[200px]'}`}
      >
        {leftNodes.map((node) => (
          <div key={node.id} className="relative group">
             <div className="flex flex-col items-end text-right px-4 py-2 bg-white/[0.02] border border-white/5 backdrop-blur-md rounded-xl hover:bg-white/[0.05] transition-all">
                <div className="flex items-center gap-2 mb-1.5 opacity-85">
                  <div className={`${compact ? 'text-[9px]' : 'text-[11px]'} text-zinc-200 font-bold uppercase tracking-wider`}>
                    {node.title}
                  </div>
                  {node.icon && <div className="text-zinc-400 opacity-90">{node.icon}</div>}
                </div>
                <div className={`${compact ? 'text-2xl' : 'text-3xl'} font-black text-white tracking-tighter leading-none`}>
                  {node.value}
                </div>
                <div className={`${compact ? 'text-[8px]' : 'text-[10px]'} text-zinc-400 font-bold mt-1.5 uppercase tracking-wider`}>
                  {node.subValue}
                </div>
             </div>
            {/* Anchor point for SVG lines */}
            <div 
              ref={(el) => {
                leftAnchorRefs.current[node.id] = el;
              }}
              className={`absolute top-1/2 -translate-y-1/2 w-1 ${compact ? '-right-0 h-4' : '-right-2 h-8'}`} 
            />
          </div>
        ))}
      </motion.div>

      {/* Center Node */}
      <div className={`relative z-[4] shrink-0 ${compact ? 'w-56 h-56' : 'w-72 h-72'}`}>
        {/* Static Anchor Container - Decoupled from animation to prevent jitter */}
        <div className="absolute inset-0 pointer-events-none">
            <div ref={centerLRef} className="absolute left-0 top-[5%] bottom-[5%] w-px" />
            <div ref={centerRRef} className="absolute right-0 top-[5%] bottom-[5%] w-px" />
        </div>

        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: isHovered ? 1 : 0.9 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className={`${background ? 'bg-[#0B0D14]/80 shadow-[0_0_40px_rgba(0,0,0,0.5)]' : 'bg-transparent'} absolute inset-0 overflow-hidden backdrop-blur-md rounded-full flex items-center justify-center`}
        >
          {centerNode.icon ? (
            <div
              className={`flex shrink-0 items-center justify-center text-white drop-shadow-[0_0_40px_rgba(255,255,255,0.5)] animate-pulse-slow ${compact ? 'w-32 h-32' : 'w-40 h-40'}`}
            >
              <div className="flex h-full w-full items-center justify-center [&>svg]:block [&>svg]:h-full [&>svg]:w-full [&>svg]:shrink-0">
                {centerNode.icon}
              </div>
            </div>
          ) : (
            <div className="text-center">
              <div className={`${compact ? 'text-[9px] tracking-widest mb-1' : 'text-[12px] tracking-[0.3em] mb-2'} text-zinc-400 font-bold uppercase`}>
                {centerNode.title}
              </div>
              <div className={`${compact ? 'text-2xl' : 'text-6xl'} font-black text-white leading-none tracking-tighter drop-shadow-[0_0_20px_rgba(255,255,255,0.1)]`}>
                {centerNode.bigValue}
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Right Column Nodes */}
      <motion.div 
        animate={{ 
          opacity: isHovered ? 1 : 0,
          x: isHovered ? 0 : 20,
        }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className={`flex flex-col justify-around h-full z-[3] ${compact ? 'w-[140px]' : 'w-[200px]'}`}
      >
        {rightNodes.map((node) => (
          <div key={node.id} className="relative group">
            <div className="flex flex-col items-start text-left px-4 py-2 bg-white/[0.02] border border-white/5 backdrop-blur-md rounded-xl hover:bg-white/[0.05] transition-all">
                <div className="flex items-center gap-2 mb-1.5 opacity-85">
                   {node.icon && <div className="text-zinc-400 opacity-90">{node.icon}</div>}
                   <div className={`${compact ? 'text-[9px]' : 'text-[11px]'} text-zinc-200 font-bold uppercase tracking-wider`}>
                    {node.title}
                  </div>
                </div>
                <div className={`${compact ? 'text-2xl' : 'text-3xl'} font-black text-white tracking-tighter leading-none`}>
                  {node.value}
                </div>
                <div className={`${compact ? 'text-[8px]' : 'text-[10px]'} text-zinc-500 font-bold mt-1.5 uppercase tracking-widest`}>
                  {node.subValue}
                </div>
             </div>
            {/* Anchor point for SVG lines */}
            <div 
              ref={(el) => {
                rightAnchorRefs.current[node.id] = el;
              }}
              className={`absolute top-1/2 -translate-y-1/2 w-1 ${compact ? '-left-0 h-4' : '-left-2 h-8'}`} 
            />
          </div>
        ))}
      </motion.div>
    </div>
  );
};

export default SankeyFlowChart;
