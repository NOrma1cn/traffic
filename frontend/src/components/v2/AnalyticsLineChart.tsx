import React from 'react';

const dates = [
  ['01', 'Sat'],
  ['02', 'Sun'],
  ['03', 'Mon'],
  ['04', 'Tue'],
  ['05', 'Wed'],
  ['06', 'Thu'],
  ['07', 'Fri'],
  ['08', 'Sat'],
  ['09', 'Sun'],
  ['10', 'Mon'],
  ['11', 'Tue'],
  ['12', 'Wed'],
  ['13', 'Thu'],
] as const;

const xAxisLabels = ['7 am', '8 am', '9 am', '10 am', '11 am', '12 am', '1 pm', '2 pm', '3 pm', '4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm', '10 pm'];

const purpleLinePath = 'M0 150 C40 150 45 170 75 170 C105 170 115 130 145 130 C175 130 180 160 215 160 C245 160 255 128 285 128 C315 128 320 150 355 150 C385 150 390 205 420 205 C450 205 455 56 490 56 C525 56 520 150 555 150 C585 150 595 132 625 132 C655 132 665 162 695 162 C725 162 735 132 765 132 C795 132 805 150 835 150 C865 150 875 124 905 124 C935 124 945 148 970 148 C985 148 995 140 1000 140';
const yellowLinePath = 'M0 132 C35 142 45 152 75 146 C105 140 115 112 145 116 C175 120 185 150 215 146 C245 142 255 104 285 106 C315 108 325 176 355 174 C385 172 395 150 425 152 C455 154 465 86 495 86 C525 86 535 146 565 144 C595 142 605 72 635 72 C665 72 675 88 705 88 C735 88 745 128 775 128 C805 128 815 102 845 102 C875 102 885 162 915 164 C945 166 955 116 985 114 C992 113 996 112 1000 112';

const AnalyticsLineChart: React.FC = () => (
  <section className="rounded-2xl border border-[#1b2430] bg-black p-6 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
    <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="text-[28px] font-semibold text-white">Statistics</h2>
      <div className="flex gap-5 text-[15px] font-medium">
        <span className="cursor-pointer text-white">Days</span>
        <span className="cursor-pointer text-[#8e8e93] transition hover:text-white">Weeks</span>
        <span className="cursor-pointer text-[#8e8e93] transition hover:text-white">Months</span>
      </div>
    </div>

    <div className="mb-8 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {dates.map(([day, name]) => {
        const isActive = day === '10';

        return (
          <button
            key={day}
            type="button"
            className={`flex h-[75px] min-w-[65px] flex-col items-center justify-center rounded-2xl text-center transition ${
              isActive ? 'scale-[1.02] bg-[#eaddff] text-[#111111]' : 'bg-[#1c1c1e] text-white hover:bg-[#242427]'
            }`}
          >
            <span className="mb-1 text-lg font-semibold">{day}</span>
            <span className="text-xs opacity-70">{name}</span>
          </button>
        );
      })}
    </div>

    <div className="flex h-[280px] gap-4">
      <div className="flex w-[30px] flex-col justify-between pb-[40px] text-[13px] font-medium text-[#8e8e93]">
        <span>4h</span>
        <span>3h</span>
        <span>2h</span>
        <span>1h</span>
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex h-full min-w-[960px] flex-col">
          <div className="relative min-h-0 flex-1">
            <svg className="h-full w-full overflow-visible" viewBox="0 0 1000 250" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="v2PurpleGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#9b51e0" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#9b51e0" stopOpacity="0" />
                </linearGradient>
              </defs>

              <path d={`${purpleLinePath} L1000 250 L0 250 Z`} fill="url(#v2PurpleGradient)" />
              <path d={purpleLinePath} fill="none" stroke="#9b51e0" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <path d={yellowLinePath} fill="none" stroke="#e3c158" strokeWidth="2" strokeDasharray="6 8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>

          <div className="mt-4 grid grid-cols-[repeat(16,minmax(0,1fr))] px-1 text-[12px] font-medium text-[#8e8e93]">
            {xAxisLabels.map((label) => (
              <span key={label} className="whitespace-nowrap text-center">{label}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default AnalyticsLineChart;
