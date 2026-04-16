import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize2, X, Download, Info } from 'lucide-react';

interface GalleryItem {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  image: string;
  category: string;
}

const ITEMS: GalleryItem[] = [
  {
    id: 'defense',
    title: '防御性流量分析图',
    subtitle: 'Traffic Defense Analysis Plot',
    category: '流量监控',
    description: '本图表展示了基于 District 03 网格数据的防御性流量监控逻辑。通过对比历史均值与实时脉冲，识别潜在的突发性交通异常（如事故或非法占道）。蓝色阴影区域代表模型预测的置信区间，红色标记线为触发系统预警的异常阈值。',
    image: '/assets/defense_analysis.png'
  },
  {
    id: 'sensor-map',
    title: '传感器分布拓扑图',
    subtitle: 'Sensor Topology Mapping',
    category: '硬件架构',
    description: '该可视化详细描绘了 D03 区标段物理节点的部署深度与传感器的空间连通性。每个节点代表一个双向感应线圈或毫米波雷达。绿色标记显示当前在线节点，灰色标记代表维护中或数据缺失的离线传感器，是构建时空网格的基础。',
    image: '/assets/sensor_map.png'
  },
  {
    id: 'model-eval',
    title: '预测模型评估结果',
    subtitle: 'Model Performance Evaluation',
    category: '算法评估',
    description: '本图为 D03 交通预测模型的最新性能评估报告。展示了时空卷积网络（STGCN）在不同预测时长（15/30/60分钟）下的误差分布。横轴为真实交通流速度，纵轴为模型输出值。拟合度高度趋近于 45 度对齐线，证明了系统在 Sacramento 多变路况下的鲁棒性。',
    image: '/assets/model_eval.png'
  }
];

const ProjectGallery: React.FC = () => {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selectedItem = ITEMS.find(i => i.id === selectedId);

    return (
        <div className="w-full h-full flex flex-col p-1">
            <div className="mb-10">
                <div className="text-[10px] font-black text-cyan-500 uppercase tracking-[0.4em] mb-2">Internal Assets Library</div>
                <h2 className="text-3xl font-black text-white italic tracking-tighter">项目资料画廊 <span className="text-zinc-700 italic font-thin">/ ASSETS_GALLERY</span></h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {ITEMS.map((item) => (
                    <motion.div 
                        key={item.id}
                        layoutId={`card-${item.id}`}
                        onClick={() => setSelectedId(item.id)}
                        className="group relative h-[420px] bg-zinc-900/40 border border-white/5 rounded-3xl overflow-hidden cursor-pointer hover:border-cyan-500/30 transition-colors"
                    >
                        {/* Image Preview */}
                        <div className="h-2/3 relative overflow-hidden">
                            <img 
                                src={item.image} 
                                alt={item.title} 
                                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 opacity-70 group-hover:opacity-100"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 to-transparent" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="p-4 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
                                    <Maximize2 size={24} className="text-white" />
                                </div>
                            </div>
                        </div>

                        {/* Text Content */}
                        <div className="p-6">
                            <div className="text-[10px] font-bold text-cyan-500 mb-1 uppercase tracking-widest">{item.category}</div>
                            <h3 className="text-xl font-black text-white mb-2">{item.title}</h3>
                            <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{item.description}</p>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Lightbox / Expanded View */}
            <AnimatePresence>
                {selectedId && selectedItem && (
                    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-8 lg:p-20">
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedId(null)}
                            className="absolute inset-0 bg-[#050508]/95 backdrop-blur-2xl"
                        />
                        
                        <motion.div 
                            layoutId={`card-${selectedItem.id}`}
                            className="relative w-full max-w-7xl h-full bg-zinc-900/50 border border-white/10 rounded-[40px] flex overflow-hidden shadow-2xl"
                        >
                            {/* Detailed Image */}
                            <div className="flex-[1.5] bg-black/40 flex items-center justify-center p-8">
                                <img 
                                    src={selectedItem.image} 
                                    className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
                                    alt={selectedItem.title}
                                />
                            </div>

                            {/* Sidebar Info */}
                            <div className="flex-1 border-l border-white/10 p-12 overflow-y-auto custom-scrollbar flex flex-col">
                                <button 
                                    onClick={() => setSelectedId(null)}
                                    className="absolute top-8 right-12 p-2 rounded-full hover:bg-white/5 transition-colors"
                                >
                                    <X size={24} className="text-zinc-500" />
                                </button>

                                <div className="space-y-8">
                                    <div className="space-y-2">
                                        <div className="text-xs font-black text-cyan-500 uppercase tracking-widest">{selectedItem.category}</div>
                                        <h1 className="text-4xl font-black text-white italic tracking-tight leading-none">{selectedItem.title}</h1>
                                        <div className="text-sm font-light text-zinc-500 font-mono tracking-widest">{selectedItem.subtitle}</div>
                                    </div>

                                    <div className="p-6 bg-white/5 border border-white/10 rounded-3xl">
                                        <div className="flex items-center gap-2 mb-4">
                                            <Info size={16} className="text-cyan-400" />
                                            <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">业务背景与技术解析</span>
                                        </div>
                                        <p className="text-sm text-zinc-300 leading-8 text-justify">
                                            {selectedItem.description}
                                        </p>
                                    </div>

                                    <div className="pt-8 flex gap-4">
                                        <button className="flex-1 flex items-center justify-center gap-3 bg-white text-black font-black uppercase text-xs tracking-widest py-5 rounded-2xl hover:bg-cyan-400 transition-colors">
                                            <Download size={16} /> 下载源文件
                                        </button>
                                        <button className="w-16 h-16 flex items-center justify-center border border-white/10 rounded-2xl hover:bg-white/5 transition-colors">
                                            <Maximize2 size={16} className="text-white" />
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-auto pt-10 border-t border-white/5 opacity-20 text-[10px] font-mono text-zinc-500 tracking-widest">
                                    ASSET_TAG: {selectedItem.id.toUpperCase()}_v1.0.42
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ProjectGallery;
