import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { ArrowLeftRight, ChevronDown, TrendingUp, Users } from 'lucide-react';

const chartColors = {
  dark: '#6D5BDB',
  mid: '#B2A5F2',
  light: '#EDE9FA',
};

const DashboardWidgetCards: React.FC = () => {
  const chart1Ref = useRef<HTMLDivElement | null>(null);
  const chart2Ref = useRef<HTMLDivElement | null>(null);
  const chart3Ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chart1Ref.current || !chart2Ref.current || !chart3Ref.current) return;

    const chart1 = echarts.init(chart1Ref.current);
    const chart2 = echarts.init(chart2Ref.current);
    const chart3 = echarts.init(chart3Ref.current);
    const { dark, mid, light } = chartColors;

    chart1.setOption({
      color: [light, dark, mid],
      series: [{
        type: 'pie',
        radius: ['0%', '100%'],
        center: ['50%', '50%'],
        startAngle: 110,
        label: { show: false },
        silent: true,
        data: [
          { value: 20 },
          { value: 65 },
          { value: 15 },
        ],
      }],
    });

    chart2.setOption({
      series: [{
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        radius: '100%',
        center: ['50%', '72%'],
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 14,
            color: [
              [0.45, dark],
              [0.65, mid],
              [1, light],
            ],
          },
        },
        splitLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        detail: { show: false },
      }],
    });

    chart3.setOption({
      series: [{
        type: 'gauge',
        startAngle: 180,
        endAngle: 0,
        radius: '100%',
        center: ['50%', '72%'],
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 10,
            color: [[1, light]],
          },
        },
        progress: {
          show: true,
          roundCap: true,
          width: 10,
          itemStyle: { color: dark },
        },
        pointer: {
          icon: 'path://M -1.5 0 L 0 -100 L 1.5 0 Z',
          length: '65%',
          offsetCenter: [0, '0%'],
          itemStyle: { color: mid },
        },
        splitLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        detail: { show: false },
        data: [{ value: 65 }],
      }],
    });

    const handleResize = () => {
      chart1.resize();
      chart2.resize();
      chart3.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart1.dispose();
      chart2.dispose();
      chart3.dispose();
    };
  }, []);

  return (
    <section className="grid gap-5 xl:grid-cols-3">
      <article className="rounded-[24px] border border-[#1b2430] bg-[#0b1017] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div className="text-base font-semibold text-[#f8fafc]">Projects statues</div>
          <button className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#202938] bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-[#7f8ea3]">
            This Week
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative h-[130px] w-[130px] shrink-0">
            <div ref={chart1Ref} className="h-full w-full" />
          </div>

          <div className="flex flex-1 flex-col">
            <div className="mb-0.5 text-[11px] font-medium text-[#e5edf7]">Total Project</div>
            <div className="mb-4 flex items-center gap-2.5">
              <div className="text-[34px] font-bold leading-none tracking-[-0.03em] text-[#f8fafc]">1200</div>
              <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border-[1.5px] border-[#1b2a22] text-[#52d07b]">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
            </div>

            <ul className="flex list-none flex-col gap-2 text-[11px] font-medium text-[#7f8ea3]">
              <li className="flex items-center gap-2"><span className="h-[5px] w-[5px] rounded-full bg-[#6d5bdb]" />65 Active now</li>
              <li className="flex items-center gap-2"><span className="h-[5px] w-[5px] rounded-full bg-[#b2a5f2]" />20 Pending</li>
              <li className="flex items-center gap-2"><span className="h-[5px] w-[5px] rounded-full bg-[#e2ddfa]" />20 Under review</li>
            </ul>
          </div>
        </div>
      </article>

      <article className="rounded-[24px] border border-[#1b2430] bg-[#0b1017] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div className="text-base font-semibold text-[#f8fafc]">Total task</div>
          <button className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#202938] bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-[#7f8ea3]">
            This Week
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative h-[130px] w-[130px] shrink-0">
            <div ref={chart2Ref} className="h-full w-full" />
            <div className="absolute bottom-[30px] w-full text-center leading-[1.2]">
              <div className="text-[13px] font-semibold text-[#f8fafc]">29</div>
              <div className="text-[10px] font-medium text-[#7f8ea3]">Pending tasks</div>
            </div>
          </div>

          <div className="flex flex-1 flex-col">
            <div className="mb-0.5 text-[11px] font-medium text-[#e5edf7]">Total task</div>
            <div className="mb-4 flex items-center gap-2.5">
              <div className="text-[34px] font-bold leading-none tracking-[-0.03em] text-[#f8fafc]">1500</div>
              <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border-[1.5px] border-[#1b2a22] text-[#52d07b]">
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </div>
            </div>

            <ul className="flex list-none flex-col gap-2 text-[11px] font-medium text-[#7f8ea3]">
              <li className="flex items-center gap-2"><span className="h-[5px] w-[5px] rounded-full bg-[#6d5bdb]" />199 Active now</li>
              <li className="flex items-center gap-2"><span className="h-[5px] w-[5px] rounded-full bg-[#b2a5f2]" />29 Pending</li>
              <li className="flex items-center gap-2"><span className="h-[5px] w-[5px] rounded-full bg-[#e2ddfa]" />1182 Under review</li>
            </ul>
          </div>
        </div>
      </article>

      <article className="rounded-[24px] border border-[#1b2430] bg-[#0b1017] p-6 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div className="text-base font-semibold text-[#f8fafc]">Team productivity</div>
          <button className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#202938] bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-[#7f8ea3]">
            This Week
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative h-[130px] w-[130px] shrink-0">
            <div ref={chart3Ref} className="h-full w-full" />
            <div className="absolute bottom-3 w-full text-center text-[10px] font-medium text-[#7f8ea3]">65% Productive houses</div>
          </div>

          <div className="flex flex-1 flex-col">
            <div className="mb-0.5 text-[11px] font-medium text-[#e5edf7]">Weekly working time</div>
            <div className="mb-4 flex items-center gap-2.5">
              <div className="text-[34px] font-bold leading-none tracking-[-0.03em] text-[#f8fafc]">47h</div>
              <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border-[1.5px] border-[#1b2a22] text-[#52d07b]">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
            </div>

            <ul className="flex list-none flex-col gap-2 text-[11px] font-medium text-[#7f8ea3]">
              <li className="flex items-center gap-2"><span className="h-[5px] w-[5px] rounded-full bg-[#6d5bdb]" />65% Productive</li>
              <li className="flex items-center gap-2"><span className="h-[5px] w-[5px] rounded-full bg-[#e2ddfa]" />35% Unproductive</li>
              <li className="flex items-center gap-2 text-[#7f8ea3]">
                <Users className="-ml-0.5 h-3.5 w-3.5 text-[#b2a5f2]" />
                67K+ Members
              </li>
            </ul>
          </div>
        </div>
      </article>
    </section>
  );
};

export default DashboardWidgetCards;
