import React from 'react';

const liveEventData = [
  { label: 'Cars', raw: '4,504,210', pct: '55%', color: '#00d2ff' },
  { label: 'Trucks', raw: '2,100,950', pct: '25%', color: '#00e676' },
  { label: 'Buses', raw: '1,980,240', pct: '15%', color: '#ffab00' },
  { label: 'Commercial', raw: '1,504,210', pct: '15%', color: '#a948ff' },
] as const;

const VehicleStatsPanel: React.FC = () => (
  <aside className="w-full shrink-0 rounded-[28px] border border-[#171b22] bg-[#000000] px-8 py-10 text-white shadow-[0_20px_60px_rgba(0,0,0,0.42)] xl:sticky xl:top-10 xl:w-[360px]">
    <section className="mb-14">
      <h2 className="mb-3 text-[28px] font-bold tracking-[-0.03em] text-white">Overall Statistics</h2>
      <div className="mb-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-white">Total Detected Vehicles</span>
        <span className="text-[10px] font-bold tracking-[0.05em] text-[#6b7280]">MORE INFO &gt;</span>
      </div>
      <div className="text-[42px] font-bold leading-none tracking-[-0.06em] text-white">5,291,427</div>
    </section>

    <section>
      <h3 className="mb-4 text-base font-bold text-white">Live Event Data</h3>

      <div className="mb-6 flex h-[6px] w-full gap-0.5 overflow-hidden rounded-full">
        {liveEventData.map((item) => (
          <div
            key={item.label}
            className="h-full rounded-full"
            style={{ backgroundColor: item.color, flex: Number(item.pct.replace('%', '')) }}
          />
        ))}
      </div>

      <div className="flex flex-col gap-3.5">
        {liveEventData.map((item) => (
          <div key={item.label} className="grid grid-cols-[120px_1fr_40px] items-center text-[13.5px]">
            <div className="flex items-center gap-3 font-medium text-[#9ca3af]">
              <span
                className="h-[6px] w-[6px] rounded-full"
                style={{ backgroundColor: item.color, boxShadow: `0 0 4px ${item.color}` }}
              />
              <span>{item.label}</span>
            </div>
            <div className="pr-4 text-right font-medium text-white">{item.raw}</div>
            <div className="text-right font-semibold text-white">{item.pct}</div>
          </div>
        ))}
      </div>
    </section>
  </aside>
);

export default VehicleStatsPanel;
