import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MapPin, ArrowRight, ArrowLeft, Navigation } from 'lucide-react';

interface SensorNode {
  id: string;
  index: number;
  freeway: string;
  direction: string;
  abs_pm: number;
  latitude: number;
  longitude: number;
  station_name: string;
}

interface PathwaySegment {
  sensors: SensorNode[];
  direction: 'upstream' | 'current' | 'downstream';
}

interface SensorPathwayViewProps {
  selectedSensor: SensorNode | null;
  allSensors: SensorNode[];
  onSensorClick?: (sensorIndex: number) => void;
}

const SensorPathwayView: React.FC<SensorPathwayViewProps> = ({
  selectedSensor,
  allSensors,
  onSensorClick,
}) => {
  // 计算传感器所在路段和前后相连路段
  const pathwayData = useMemo(() => {
    if (!selectedSensor) return null;

    const { freeway, direction, abs_pm } = selectedSensor;

    // 找到同一高速公路同一方向的所有传感器
    const sameCorridorSensors = allSensors.filter(
      s => s.freeway === freeway && s.direction === direction
    ).sort((a, b) => a.abs_pm - b.abs_pm);

    // 找到当前传感器在排序后的位置
    const currentIndex = sameCorridorSensors.findIndex(
      s => s.index === selectedSensor.index
    );

    if (currentIndex === -1) return null;

    // 获取前后各3个传感器（可调整）
    const upstreamSensors = sameCorridorSensors.slice(
      Math.max(0, currentIndex - 3),
      currentIndex
    ).reverse(); // 反转使最近的在前

    const currentSegment = [selectedSensor];

    const downstreamSensors = sameCorridorSensors.slice(
      currentIndex + 1,
      Math.min(sameCorridorSensors.length, currentIndex + 4)
    );

    return {
      upstream: upstreamSensors,
      current: currentSegment,
      downstream: downstreamSensors,
      corridorInfo: {
        freeway,
        direction,
        totalSensors: sameCorridorSensors.length,
        position: currentIndex + 1,
      },
    };
  }, [selectedSensor, allSensors]);

  if (!pathwayData || !selectedSensor) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6">
        <div className="text-center text-zinc-500 text-sm">
          选择一个传感器查看其所在路段信息
        </div>
      </div>
    );
  }

  const { upstream, current, downstream, corridorInfo } = pathwayData;

  const renderSensorCard = (sensor: SensorNode, position: 'upstream' | 'current' | 'downstream') => {
    const isSelected = sensor.index === selectedSensor.index;
    const directionLabel = sensor.direction === 'E' ? '东' : 
                          sensor.direction === 'W' ? '西' : 
                          sensor.direction === 'N' ? '北' : '南';

    return (
      <motion.div
        key={sensor.index}
        initial={{ opacity: 0, y: position === 'upstream' ? -20 : position === 'downstream' ? 20 : 0 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`
          relative p-4 rounded-xl border-2 transition-all cursor-pointer
          ${isSelected 
            ? 'bg-cyan-500/20 border-cyan-400 shadow-lg shadow-cyan-500/20' 
            : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800'
          }
        `}
        onClick={() => onSensorClick?.(sensor.index)}
      >
        {/* 位置指示器 */}
        {isSelected && (
          <div className="absolute -top-2 -right-2 bg-cyan-500 text-zinc-950 text-xs font-bold px-2 py-1 rounded-full">
            当前
          </div>
        )}

        {/* 传感器信息 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin size={14} className={isSelected ? "text-cyan-400" : "text-zinc-500"} />
              <span className="text-xs font-mono text-zinc-400">
                #{sensor.index}
              </span>
            </div>
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              I-{sensor.freeway} {directionLabel}
            </div>
          </div>

          <div className="text-sm font-bold text-white">
            {sensor.station_name || '未命名站点'}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Postmile:</span>
            <span className="font-mono text-zinc-300">{sensor.abs_pm.toFixed(3)}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">坐标:</span>
            <span className="font-mono text-zinc-300">
              {sensor.latitude.toFixed(4)}, {sensor.longitude.toFixed(4)}
            </span>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-6 space-y-6">
      {/* 路段信息头部 */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h3 className="text-lg font-bold text-white">路段视图</h3>
          <p className="text-sm text-zinc-400 mt-1">
            I-{corridorInfo.freeway} {corridorInfo.direction === 'E' ? '东向' : 
                                      corridorInfo.direction === 'W' ? '西向' : 
                                      corridorInfo.direction === 'N' ? '北向' : '南向'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">位置</div>
          <div className="text-sm font-mono text-cyan-400">
            {corridorInfo.position} / {corridorInfo.totalSensors}
          </div>
        </div>
      </div>

      {/* 路段可视化 */}
      <div className="space-y-4">
        {/* 上游路段 */}
        {upstream.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-500 uppercase tracking-wider">
              <ArrowLeft size={14} />
              <span>上游路段 ({upstream.length} 个传感器)</span>
            </div>
            <div className="space-y-2 pl-4 border-l-2 border-zinc-700">
              {upstream.map(sensor => renderSensorCard(sensor, 'upstream'))}
            </div>
          </div>
        )}

        {/* 当前位置 */}
        <div className="flex items-center justify-center">
          <div className="flex items-center gap-3 bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent px-6 py-3 rounded-full border border-cyan-500/30">
            <Navigation size={16} className="text-cyan-400" />
            <span className="text-sm font-bold text-cyan-400">当前选中传感器</span>
            <Navigation size={16} className="text-cyan-400" />
          </div>
        </div>

        {/* 当前传感器 */}
        <div className="pl-4">
          {current.map(sensor => renderSensorCard(sensor, 'current'))}
        </div>

        {/* 下游路段 */}
        {downstream.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-500 uppercase tracking-wider">
              <ArrowRight size={14} />
              <span>下游路段 ({downstream.length} 个传感器)</span>
            </div>
            <div className="space-y-2 pl-4 border-l-2 border-zinc-700">
              {downstream.map(sensor => renderSensorCard(sensor, 'downstream'))}
            </div>
          </div>
        )}
      </div>

      {/* 统计信息 */}
      <div className="bg-zinc-800/50 rounded-lg p-4 grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">上游站点</div>
          <div className="text-xl font-bold text-zinc-300">{upstream.length}</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">当前路段</div>
          <div className="text-xl font-bold text-cyan-400">1</div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">下游站点</div>
          <div className="text-xl font-bold text-zinc-300">{downstream.length}</div>
        </div>
      </div>
    </div>
  );
};

export default SensorPathwayView;
