import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Terminal, Command, Grid3X3, Activity, Layers, Image } from 'lucide-react';
import DotGridChart from './DotGridChart';
import WeightedEqualizer from './WeightedEqualizer';
import SensorFlowSankey from './SensorFlowSankey';
import AIVoiceAssistant from './AIVoiceAssistant';
import ProjectGallery from './ProjectGallery';

interface DevConsoleProps {
  isOpen: boolean;
  initialTab?: DevTab;
  onClose: () => void;
}

type DevTab = 'home' | 'dot_matrix' | 'equalizer' | 'sensor_flow' | 'ai_assistant' | 'gallery' | 'logs';

const DevConsole: React.FC<DevConsoleProps> = ({ isOpen, initialTab = 'home', onClose }) => {
  const [activeTab, setActiveTab] = useState<DevTab>(initialTab);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`fixed inset-0 z-[1000] flex items-center justify-center bg-[#050506]/95 backdrop-blur-3xl overflow-hidden transition-all duration-75 ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      {/* Technical Background */}
      <div className="absolute inset-0 pointer-events-none opacity-5 bg-[radial-gradient(#22d3ee_1px,transparent_1px)] [background-size:20px_20px]" />
      
      <div className="relative w-full max-w-6xl h-[80vh] bg-zinc-900/50 border border-white/10 rounded-3xl flex overflow-hidden shadow-2xl">
        
        {/* Sidebar Shell */}
        <div className="w-64 border-r border-white/5 bg-black/20 p-6 flex flex-col">
          <div className="flex items-center gap-3 mb-10">
            <Terminal size={18} className="text-cyan-400" />
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-500/80">LAB_TERMINAL</div>
          </div>

          <div className="flex-1 space-y-2">
            <SidebarButton 
              active={activeTab === 'home'} 
              onClick={() => setActiveTab('home')}
              icon={<Command size={16} />}
              label="控制台主页"
            />
            <SidebarButton 
              active={activeTab === 'dot_matrix'} 
              onClick={() => setActiveTab('dot_matrix')}
              icon={<Grid3X3 size={16} />}
              label="点阵可视化"
            />
            <SidebarButton 
              active={activeTab === 'equalizer'} 
              onClick={() => setActiveTab('equalizer')}
              icon={<Activity size={16} />}
              label="指标均衡器"
            />
            <SidebarButton 
              active={activeTab === 'sensor_flow'} 
              onClick={() => setActiveTab('sensor_flow')}
              icon={<Layers size={16} />}
              label="拓扑流分析"
            />
            <SidebarButton 
              active={activeTab === 'ai_assistant'} 
              onClick={() => setActiveTab('ai_assistant')}
              icon={<Terminal size={16} />}
              label="AI 分析员"
            />
            <SidebarButton 
              active={activeTab === 'gallery'} 
              onClick={() => setActiveTab('gallery')}
              icon={<Image size={16} />}
              label="资产资料库"
            />
          </div>

          <div className="mt-auto pt-6 border-t border-white/5 opacity-30">
            <div className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">System Mode</div>
            <div className="text-[10px] font-mono text-zinc-400">DEV_BYPASS_ENABLED</div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 relative flex flex-col overflow-hidden">
            <button 
              onClick={onClose}
              className="absolute top-6 right-8 p-2 rounded-xl hover:bg-white/5 transition-colors group z-[1100]"
            >
              <X size={20} className="text-zinc-500 group-hover:text-white" />
            </button>

            <div className="flex-1 p-12 overflow-y-auto custom-scrollbar">
                <AnimatePresence mode="wait">
                    {activeTab === 'home' && (
                        <motion.div
                          key="home"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="h-full flex flex-col items-center justify-center text-center"
                        >
                            <div className="w-20 h-20 rounded-3xl bg-cyan-500/5 border border-white/5 flex items-center justify-center">
                                <Layers size={32} className="text-white/10" />
                            </div>
                        </motion.div>
                    )}

                    {activeTab === 'dot_matrix' && (
                        <motion.div
                          key="dot_matrix"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="h-full"
                        >
                            <DotGridChart />
                        </motion.div>
                    )}

                    {activeTab === 'equalizer' && (
                        <motion.div
                          key="equalizer"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="h-full"
                        >
                            <WeightedEqualizer />
                        </motion.div>
                    )}

                    {activeTab === 'sensor_flow' && (
                        <motion.div
                          key="sensor_flow"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="h-full"
                        >
                            <SensorFlowSankey />
                        </motion.div>
                    )}

                    {activeTab === 'ai_assistant' && (
                        <motion.div
                          key="ai_assistant"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="h-full"
                        >
                            <AIVoiceAssistant />
                        </motion.div>
                    )}

                    {activeTab === 'gallery' && (
                        <motion.div
                          key="gallery"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="h-full"
                        >
                            <ProjectGallery />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
      </div>
    </motion.div>
  );
};

interface SidebarButtonProps {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    disabled?: boolean;
}

const SidebarButton: React.FC<SidebarButtonProps> = ({ active, onClick, icon, label, disabled }) => {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-300 ${
                disabled ? 'opacity-20 cursor-not-allowed' :
                active ? 'bg-cyan-500/10 border border-cyan-500/20 text-white' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
            }`}
        >
            <div className={active ? 'text-cyan-400' : 'text-zinc-600'}>{icon}</div>
            <span className={`text-[11px] font-black uppercase tracking-wider ${active ? 'opacity-100' : 'opacity-60'}`}>{label}</span>
            {active && (
                <div className="ml-auto w-1 h-1 rounded-full bg-cyan-400 shadow-[0_0_8px_cyan]" />
            )}
        </button>
    );
};

export default DevConsole;
