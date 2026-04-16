import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

const SensorFlowSankey: React.FC = () => {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const myChart = echarts.init(chartRef.current);

    const data = [
      // --- Left Column: Topology Order (Upstream -> Current -> Downstream) ---
      { 
        name: '上游传感器', 
        itemStyle: { color: '#8844ff' }, 
        label: { position: 'right', distance: 15, color: '#fff', fontFamily: 'monospace', fontWeight: 'bold' }
      },
      { 
        name: '当前传感器',
        itemStyle: { color: '#686a6e' }, 
        label: { position: 'right', distance: 15, color: '#fff', fontFamily: 'monospace' }
      },
      { 
        name: '下游传感器', 
        itemStyle: { color: '#6ae89d' }, 
        label: { position: 'right', distance: 15, color: '#fff', fontFamily: 'monospace', fontWeight: 'bold' }
      },
      // --- Right Column: Status ---
      { 
        name: '拥堵', 
        itemStyle: { color: '#e74579' }, 
        label: { position: 'left', distance: 15, color: '#ff477e', fontWeight: 'black' } 
      },
      { 
        name: '畅通', 
        itemStyle: { color: '#2a2b2d' }, 
        label: { position: 'left', distance: 15, color: '#555', fontWeight: 'bold' }
      }
    ];

    const links = [
      { source: '上游传感器', target: '拥堵', value: 15000 },
      { source: '上游传感器', target: '畅通', value: 43201 },
      { source: '当前传感器', target: '拥堵', value: 45000 },
      { source: '当前传感器', target: '畅通', value: 31991 },
      { source: '下游传感器', target: '畅通', value: 49229 }
    ];

    const option = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        backgroundColor: 'rgba(5, 5, 8, 0.9)',
        borderColor: 'rgba(255, 255, 255, 0.1)',
        textStyle: { color: '#fff', fontSize: 10 }
      },
      series: [
        {
          type: 'sankey',
          layout: 'none',
          nodeAlign: 'justify',
          data: data,
          links: links,
          nodeWidth: 20,
          nodeGap: 40,
          draggable: false,
          itemStyle: {
            borderRadius: 4,
            borderWidth: 2,
            borderColor: 'rgba(255, 255, 255, 0.5)'
          },
          lineStyle: {
            color: 'gradient',
            curveness: 0.5,
            opacity: 0.35
          },
          label: {
              fontSize: 10,
              color: '#ccc',
              fontWeight: 'bold'
          },
          emphasis: {
            lineStyle: {
              opacity: 0.8
            }
          }
        }
      ]
    };

    myChart.setOption(option);

    const handleResize = () => {
      myChart.resize();
    };

    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
        myChart.resize();
    });
    resizeObserver.observe(chartRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      myChart.dispose();
    };
  }, []);

  return (
    <div className="w-full h-full flex flex-col p-8 bg-black/40 rounded-3xl border border-white/5 relative overflow-hidden backdrop-blur-xl">
      <div className="flex-1 min-h-0 relative">
        <div ref={chartRef} className="w-full h-full" />
      </div>
    </div>
  );
};

export default SensorFlowSankey;
