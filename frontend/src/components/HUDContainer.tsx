import React, { useState, useEffect } from 'react';
import { motion, useSpring, useMotionValue } from 'framer-motion';

interface HUDContainerProps {
  children: React.ReactNode;
}

const HUDContainer: React.FC<HUDContainerProps> = ({ children }) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Smooth springs without bounce/spring effect (high damping)
  const springConfig = { damping: 40, stiffness: 100, mass: 1 };
  const rotateX = useSpring(mouseY, springConfig);
  const rotateY = useSpring(mouseX, springConfig);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Normalize mouse position to range [-1, 1]
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;
      
      // Limit rotation to a subtle ±5 degrees
      mouseX.set(x * 5);
      mouseY.set(y * -5);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  return (
    <div className="relative w-full h-full flex items-center justify-center perspective-[2000px] overflow-visible">
      <motion.div
        style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
        className="relative w-full max-w-[1600px] p-8 rounded-[48px] overflow-visible"
      >
        {/* Content Layer */}
        <div className="relative z-20 flex flex-col items-center justify-center">
            {children}
        </div>
      </motion.div>
    </div>
  );
};

export default HUDContainer;
