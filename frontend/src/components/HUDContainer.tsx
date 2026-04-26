import React from 'react';

interface HUDContainerProps {
  children: React.ReactNode;
}

const HUDContainer: React.FC<HUDContainerProps> = ({ children }) => {
  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-visible">
      <div className="relative w-full max-w-[1600px] p-8 rounded-[48px] overflow-visible">
        {/* Content Layer */}
        <div className="relative z-20 flex flex-col items-center justify-center">
            {children}
        </div>
      </div>
    </div>
  );
};

export default HUDContainer;
