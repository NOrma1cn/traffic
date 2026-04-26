import React from 'react';
import { Cloud, CloudRain, Droplets, Eye, Thermometer, Wind, type LucideIcon } from 'lucide-react';
import BackgroundShader from '../BackgroundShader';

type WeatherMetric = {
  icon: LucideIcon;
  value: string;
  label: string;
};

const weatherMetrics: WeatherMetric[] = [
  { icon: Cloud, value: '86%', label: 'Cloudy' },
  { icon: Droplets, value: '62%', label: 'Humidity' },
  { icon: Wind, value: '8 km/h', label: 'Wind' },
  { icon: CloudRain, value: '8 mm', label: 'Rain' },
  { icon: Eye, value: '12.4 km', label: 'Visibility' },
  { icon: Thermometer, value: '08°C', label: 'Feels' },
];

const WeatherShowcasePanel: React.FC = () => (
  <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-black text-white shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
    <BackgroundShader weatherCondition="Rainy" precipitation={82} dayPhase="midnight" isActive />

    <div className="absolute inset-0 z-10 bg-[linear-gradient(90deg,rgba(0,0,0,0.34)_0%,rgba(0,0,0,0.18)_50%,rgba(0,0,0,0.48)_100%)]" />
    <div className="absolute inset-0 z-10 bg-[radial-gradient(circle_at_20%_80%,rgba(255,255,255,0.13),transparent_34%)]" />

    <div className="relative z-20 min-h-[560px]">
      <div className="flex min-h-[560px] flex-col xl:flex-row">
        <div className="relative flex min-h-[320px] flex-1 px-6 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12 xl:px-12 xl:py-12">
          <div className="mt-auto flex flex-col gap-5 pb-2 sm:flex-row sm:items-end sm:gap-6">
            <div className="text-[88px] font-[300] leading-none text-white sm:text-[112px] lg:text-[132px] xl:text-[140px]">
              08°
            </div>

            <div className="flex items-center gap-3 pb-2 sm:flex-col sm:items-start sm:gap-2 sm:pb-5">
              <CloudRain className="h-10 w-10 text-white sm:h-12 sm:w-12" strokeWidth={1.35} />
              <div className="text-[28px] font-[400] leading-none text-white sm:text-[36px] lg:text-[42px]">Rainy</div>
            </div>
          </div>
        </div>

        <aside className="relative w-full shrink-0 border-t border-white/10 bg-black/30 p-6 backdrop-blur-[24px] sm:p-8 xl:w-[clamp(300px,32%,420px)] xl:border-l xl:border-t-0 xl:p-10">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/45">Weather</div>
              <div className="mt-2 text-lg font-semibold text-white">Live Conditions</div>
            </div>
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/18 bg-white/5">
              <CloudRain className="h-7 w-7 text-white" strokeWidth={1.35} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {weatherMetrics.map((metric) => {
              const Icon = metric.icon;

              return (
                <div key={metric.label} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/14 bg-white/[0.055]">
                    <Icon className="h-5 w-5 text-white" strokeWidth={1.45} />
                  </div>
                  <div className="text-xl font-semibold leading-none text-white">{metric.value}</div>
                  <div className="mt-2 text-[11px] font-medium uppercase tracking-[0.18em] text-white/42">{metric.label}</div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  </section>
);

export default WeatherShowcasePanel;
