type IncidentCategory =
  | 'collision'
  | 'obstruction_hazard'
  | 'fire_hazmat'
  | 'control_closure'
  | 'maintenance_construction'
  | 'weather_environment'
  | 'emergency_special'
  | 'other'
  | string;

export type IncidentEvent = {
  incident_id?: number | null;
  event_type?: string | null;
  subtype_id?: number | null;
  category?: IncidentCategory | null;
  severity?: number | null;
  duration_minutes?: number | null;
  phase?: 'active' | 'recovery' | string;
  minutes_since_start?: number | null;
  minutes_until_clear?: number | null;
  freeway?: string | null;
  direction?: string | null;
  location_text?: string | null;
  distance_km?: number | null;
  spatial_weight?: number | null;
  debug_start_in_minutes?: number | null;
  debug_start_time?: string | null;
  debug_end_time?: string | null;
  incident_datetime?: string | null;
  end_datetime?: string | null;
};

export type IncidentContext = {
  feature_names?: string[];
  current?: Record<string, { value?: number; log_value?: number; normalized?: number; active?: boolean }>;
  active_features?: string[];
  current_events?: IncidentEvent[];
  summary?: {
    has_active_incident?: boolean;
    incident_total?: number;
    active_feature_count?: number;
    active_event_count?: number;
    current_event_count?: number;
  };
};

export type IncidentScenario = {
  key: string;
  label: string;
  description: string;
  flow_veh_5min: number;
  occupancy_pct: number;
  speed_kmh: number;
  delta_speed_kmh: number;
  delta_occupancy_pct: number;
  congestion_score: number;
  congestion_probability?: number;
  congestion_level: 'low' | 'medium' | 'high' | 'severe';
};

type IncidentIconSpec = {
  iconClass: string;
  label: string;
  color: string;
};

const categoryIconMap: Record<string, IncidentIconSpec> = {
  collision: { iconClass: 'fa-car-burst', label: '碰撞事故', color: '#e74c3c' },
  obstruction_hazard: { iconClass: 'fa-triangle-exclamation', label: '道路障碍', color: '#f39c12' },
  fire_hazmat: { iconClass: 'fa-fire', label: '火灾/危化', color: '#e67e22' },
  control_closure: { iconClass: 'fa-road-barrier', label: '管制/封闭', color: '#c0392b' },
  maintenance_construction: { iconClass: 'fa-person-digging', label: '施工维护', color: '#3498db' },
  weather_environment: { iconClass: 'fa-cloud-sun-rain', label: '天气环境', color: '#2980b9' },
  emergency_special: { iconClass: 'fa-life-ring', label: '紧急事件', color: '#9b59b6' },
  other: { iconClass: 'fa-circle-question', label: '其他事件', color: '#bdc3c7' },
};

const subtypeIconMap: Record<number, IncidentIconSpec> = {
  0: { iconClass: 'fa-triangle-exclamation', label: '交通危险', color: '#f39c12' },
  1: { iconClass: 'fa-car-burst', label: '碰撞/伤情未知', color: '#e74c3c' },
  2: { iconClass: 'fa-car', label: '无伤碰撞', color: '#e74c3c' },
  3: { iconClass: 'fa-truck-medical', label: '碰撞/救护响应', color: '#e74c3c' },
  4: { iconClass: 'fa-person-running', label: '肇事逃逸', color: '#e74c3c' },
  5: { iconClass: 'fa-fire', label: '火警', color: '#e67e22' },
  6: { iconClass: 'fa-paw', label: '动物危险', color: '#f39c12' },
  7: { iconClass: 'fa-paw', label: '动物占道', color: '#f39c12' },
  8: { iconClass: 'fa-truck-medical', label: '碰撞/救护响应', color: '#e74c3c' },
  9: { iconClass: 'fa-fire-flame-curved', label: '车辆起火', color: '#e67e22' },
  10: { iconClass: 'fa-person-digging', label: '施工协助', color: '#3498db' },
  11: { iconClass: 'fa-ban', label: '交通截流', color: '#c0392b' },
  12: { iconClass: 'fa-car-burst', label: '车辆打滑', color: '#f39c12' },
  13: { iconClass: 'fa-arrow-right-arrow-left', label: '逆行车辆', color: '#9b59b6' },
  14: { iconClass: 'fa-life-ring', label: '特殊救援', color: '#9b59b6' },
  15: { iconClass: 'fa-wrench', label: 'Caltrans 通知', color: '#3498db' },
  16: { iconClass: 'fa-screwdriver-wrench', label: '维护协助', color: '#3498db' },
  17: { iconClass: 'fa-traffic-light', label: '交通管制', color: '#c0392b' },
  18: { iconClass: 'fa-water', label: '道路积水', color: '#2980b9' },
  19: { iconClass: 'fa-triangle-exclamation', label: '信号故障', color: '#c0392b' },
  20: { iconClass: 'fa-cubes', label: '飞散物', color: '#f39c12' },
  21: { iconClass: 'fa-truck-medical', label: '伤人肇逃', color: '#e74c3c' },
  22: { iconClass: 'fa-road-barrier', label: '道路封闭', color: '#c0392b' },
  23: { iconClass: 'fa-car-burst', label: '轻伤碰撞', color: '#e74c3c' },
  24: { iconClass: 'fa-snowflake', label: '雪情', color: '#bdc3c7' },
  25: { iconClass: 'fa-cloud-sun-rain', label: '道路/天气', color: '#2980b9' },
  26: { iconClass: 'fa-wind', label: '大风预警', color: '#2980b9' },
  27: { iconClass: 'fa-shield-halved', label: 'CHP 管制请求', color: '#c0392b' },
  28: { iconClass: 'fa-hill-rockslide', label: '泥石/落石', color: '#2980b9' },
  29: { iconClass: 'fa-link', label: '链条管制', color: '#bdc3c7' },
  30: { iconClass: 'fa-smog', label: '大雾', color: '#2980b9' },
  31: { iconClass: 'fa-bullhorn', label: '交通公告', color: '#c0392b' },
  32: { iconClass: 'fa-droplet', label: '泄漏物', color: '#e67e22' },
  33: { iconClass: 'fa-skull-crossbones', label: '致命事故', color: '#9b59b6' },
  34: { iconClass: 'fa-car-burst', label: '重大伤害碰撞', color: '#e74c3c' },
  35: { iconClass: 'fa-biohazard', label: '危险品事件', color: '#e67e22' },
  36: { iconClass: 'fa-circle-question', label: '县道事件', color: '#bdc3c7' },
  37: { iconClass: 'fa-car-side', label: '天气护送', color: '#2980b9' },
  38: { iconClass: 'fa-plane-circle-exclamation', label: '航空紧急', color: '#9b59b6' },
  39: { iconClass: 'fa-person-cane', label: '特殊搜寻(走失)', color: '#bdc3c7' },
};

const subtypeCatalog: Array<{
  subtype_id: number;
  event_type: string;
  count: number;
  category: string;
  severity: number;
  recovery_steps: number;
}> = [
  { subtype_id: 0, event_type: '1125-Traffic Hazard', count: 16697, category: 'obstruction_hazard', severity: 0.8, recovery_steps: 6 },
  { subtype_id: 1, event_type: '1183-Trfc Collision-Unkn Inj', count: 4749, category: 'collision', severity: 1.15, recovery_steps: 10 },
  { subtype_id: 2, event_type: '1182-Trfc Collision-No Inj', count: 4519, category: 'collision', severity: 1.0, recovery_steps: 8 },
  { subtype_id: 3, event_type: '1179-Trfc Collision-1141 Enrt', count: 2593, category: 'collision', severity: 1.2, recovery_steps: 12 },
  { subtype_id: 4, event_type: '20002-Hit and Run No Injuries', count: 1456, category: 'collision', severity: 1.0, recovery_steps: 8 },
  { subtype_id: 5, event_type: 'FIRE-Report of Fire', count: 1341, category: 'fire_hazmat', severity: 1.15, recovery_steps: 12 },
  { subtype_id: 6, event_type: '1125A-Animal Hazard', count: 912, category: 'obstruction_hazard', severity: 0.65, recovery_steps: 4 },
  { subtype_id: 7, event_type: 'ANIMAL-Live or Dead Animal', count: 601, category: 'obstruction_hazard', severity: 0.6, recovery_steps: 4 },
  { subtype_id: 8, event_type: '1179-Trfc Collision-1141Enrt', count: 546, category: 'collision', severity: 1.2, recovery_steps: 12 },
  { subtype_id: 9, event_type: 'CFIRE-Car Fire', count: 526, category: 'fire_hazmat', severity: 1.35, recovery_steps: 14 },
  { subtype_id: 10, event_type: 'CZP-Assist with Construction', count: 484, category: 'maintenance_construction', severity: 0.8, recovery_steps: 12 },
  { subtype_id: 11, event_type: 'BREAK-Traffic Break', count: 289, category: 'control_closure', severity: 0.95, recovery_steps: 8 },
  { subtype_id: 12, event_type: 'SPINOUT', count: 285, category: 'obstruction_hazard', severity: 0.9, recovery_steps: 6 },
  { subtype_id: 13, event_type: 'WW-Wrong Way Driver', count: 281, category: 'emergency_special', severity: 1.45, recovery_steps: 14 },
  { subtype_id: 14, event_type: 'JUMPER', count: 236, category: 'emergency_special', severity: 1.25, recovery_steps: 12 },
  { subtype_id: 15, event_type: 'DOT-Request CalTrans Notify', count: 227, category: 'maintenance_construction', severity: 0.55, recovery_steps: 6 },
  { subtype_id: 16, event_type: 'MZP-Assist CT with Maintenance', count: 167, category: 'maintenance_construction', severity: 0.7, recovery_steps: 18 },
  { subtype_id: 17, event_type: '1184-Provide Traffic Control', count: 129, category: 'control_closure', severity: 0.85, recovery_steps: 6 },
  { subtype_id: 18, event_type: 'FLOOD-Roadway Flooding', count: 124, category: 'weather_environment', severity: 1.2, recovery_steps: 18 },
  { subtype_id: 19, event_type: '1166-Defective Traffic Signals', count: 122, category: 'control_closure', severity: 0.7, recovery_steps: 6 },
  { subtype_id: 20, event_type: '23114-Object Flying From Veh', count: 89, category: 'obstruction_hazard', severity: 0.75, recovery_steps: 6 },
  { subtype_id: 21, event_type: '20001-Hit and Run w/Injuries', count: 84, category: 'collision', severity: 1.2, recovery_steps: 12 },
  { subtype_id: 22, event_type: 'CLOSURE-Closure of a Road', count: 35, category: 'control_closure', severity: 0.9, recovery_steps: 8 },
  { subtype_id: 23, event_type: '1181-Trfc Collision-Minor Inj', count: 26, category: 'collision', severity: 1.15, recovery_steps: 10 },
  { subtype_id: 24, event_type: 'SNOW Information', count: 17, category: 'other', severity: 0.7, recovery_steps: 6 },
  { subtype_id: 25, event_type: '1013-Road/Weather Conditions', count: 15, category: 'weather_environment', severity: 0.95, recovery_steps: 8 },
  { subtype_id: 26, event_type: 'WIND Advisory', count: 15, category: 'weather_environment', severity: 0.95, recovery_steps: 10 },
  { subtype_id: 27, event_type: '1184-Req CHP Traffic Control', count: 13, category: 'other', severity: 0.7, recovery_steps: 6 },
  { subtype_id: 28, event_type: 'SLIDE-Mud/Dirt/Rock', count: 10, category: 'weather_environment', severity: 1.15, recovery_steps: 16 },
  { subtype_id: 29, event_type: 'CHAINS-Chain Control', count: 9, category: 'other', severity: 0.7, recovery_steps: 6 },
  { subtype_id: 30, event_type: 'FOG-Foggy Conditions', count: 7, category: 'weather_environment', severity: 1.05, recovery_steps: 18 },
  { subtype_id: 31, event_type: 'TADV-Traffic Advisory', count: 5, category: 'control_closure', severity: 0.8, recovery_steps: 6 },
  { subtype_id: 32, event_type: 'SPILL-Spilled Material Inc', count: 4, category: 'fire_hazmat', severity: 1.1, recovery_steps: 12 },
  { subtype_id: 33, event_type: '1144-Fatality', count: 3, category: 'emergency_special', severity: 1.6, recovery_steps: 18 },
  { subtype_id: 34, event_type: '1180-Trfc Collision-Major Inj', count: 3, category: 'collision', severity: 1.55, recovery_steps: 18 },
  { subtype_id: 35, event_type: 'HAZMAT-Hazardous Materials Inc', count: 2, category: 'fire_hazmat', severity: 1.5, recovery_steps: 18 },
  { subtype_id: 36, event_type: 'CORD-County Roads', count: 1, category: 'other', severity: 0.7, recovery_steps: 6 },
  { subtype_id: 37, event_type: 'ESCORT for Road Conditions', count: 1, category: 'weather_environment', severity: 0.75, recovery_steps: 10 },
  { subtype_id: 38, event_type: 'MAYDAY-Aircraft Emergency', count: 1, category: 'emergency_special', severity: 1.45, recovery_steps: 18 },
  { subtype_id: 39, event_type: 'SILVER-Missing Elderly', count: 1, category: 'other', severity: 0.7, recovery_steps: 6 },
];

const featureToCategory: Record<string, string> = {
  cat_collision: 'collision',
  cat_obstruction_hazard: 'obstruction_hazard',
  cat_fire_hazmat: 'fire_hazmat',
  cat_control_closure: 'control_closure',
  cat_maintenance_construction: 'maintenance_construction',
  cat_weather_environment: 'weather_environment',
  cat_emergency_special: 'emergency_special',
  cat_other: 'other',
};

const categoryFeatureRows = Object.entries(featureToCategory).map(([feature, category]) => ({
  feature,
  category,
  spec: categoryIconMap[category] ?? categoryIconMap.other,
}));

const getIncidentIcon = (event: IncidentEvent): IncidentIconSpec => {
  const subtypeId = Number(event.subtype_id);
  if (Number.isFinite(subtypeId) && subtypeIconMap[subtypeId]) return subtypeIconMap[subtypeId];
  return categoryIconMap[String(event.category ?? 'other')] ?? categoryIconMap.other;
};

const getFeatureIcon = (feature: string): IncidentIconSpec => {
  const category = featureToCategory[feature] ?? 'other';
  return categoryIconMap[category] ?? categoryIconMap.other;
};

const formatSigned = (value: number | null | undefined, unit: string) => {
  if (!Number.isFinite(Number(value))) return '--';
  const numeric = Number(value);
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(1)}${unit}`;
};

const iconClassName = (spec: IncidentIconSpec) => `fa-solid ${spec.iconClass}`;

type IncidentStatusPanelProps = {
  accidents?: IncidentContext | null;
  incidentScenarios?: IncidentScenario[];
};

const IncidentStatusPanel: React.FC<IncidentStatusPanelProps> = ({ accidents, incidentScenarios = [] }) => {
  const events = accidents?.current_events ?? [];
  const activeFeatures = (accidents?.active_features ?? []).filter((name) => name !== 'incident_total');
  const hasIncident = Boolean(accidents?.summary?.has_active_incident || events.length || activeFeatures.length);
  const primaryEvent = events[0];
  const primarySpec = primaryEvent ? getIncidentIcon(primaryEvent) : null;
  const fallbackSpec = primarySpec ?? categoryIconMap.obstruction_hazard;
  const featureRows = (accidents?.feature_names ?? []).map((feature) => ({
    feature,
    payload: accidents?.current?.[feature],
    spec: feature === 'incident_total' ? { iconClass: 'fa-gauge-high', label: '总影响强度', color: '#e5e7eb' } : getFeatureIcon(feature),
    category: featureToCategory[feature] ?? 'total',
  }));

  return (
    <section className="rounded-[34px] border border-white/10 bg-[#05070b]/92 p-6 text-white shadow-[0_24px_120px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-6 border-b border-white/10 pb-5">
        <div className="flex items-center gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl border bg-white/5"
            style={{ borderColor: `${primarySpec?.color ?? '#22d3ee'}55`, color: primarySpec?.color ?? '#22d3ee' }}
          >
            <i className={iconClassName(fallbackSpec)} style={{ fontSize: 28 }} />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-rose-200/60">Incident Debug Page</div>
            <div className="mt-1 text-2xl font-black tracking-tight">事故数据关系调试</div>
            <div className="mt-1 text-sm text-white/45">事件 subtype → 事故类别 → 特征矩阵 → 图标 → 当前传感器影响 → 情景预测</div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-right font-mono">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">impact</div>
            <div className="text-lg font-black" style={{ color: hasIncident ? '#fb7185' : '#34d399' }}>{Number(accidents?.summary?.incident_total ?? 0).toFixed(2)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">events</div>
            <div className="text-lg font-black text-white/85">{accidents?.summary?.current_event_count ?? events.length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">features</div>
            <div className="text-lg font-black text-white/85">{activeFeatures.length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">scenes</div>
            <div className="text-lg font-black text-white/85">{incidentScenarios.length}</div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[1.15fr_0.85fr] gap-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Current Sensor Hit Graph</div>
              <div className="mt-1 text-lg font-black">当前传感器命中的事件关系</div>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-mono text-white/50">limit 50</span>
          </div>

          {events.length > 0 ? (
            <div className="space-y-2">
              {events.map((event, idx) => {
                const spec = getIncidentIcon(event);
                const featureName = event.category ? `cat_${event.category}` : 'incident_total';
                return (
                  <div key={`${event.incident_id ?? idx}-${idx}`} className="rounded-2xl border border-white/8 bg-black/25 p-3">
                    <div className="flex items-start gap-3">
                      <i className={iconClassName(spec)} style={{ color: spec.color, fontSize: 20, width: 22, textAlign: 'center' }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-white/40">#{event.incident_id ?? '--'}</span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-white/55">subtype {event.subtype_id ?? '--'}</span>
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${spec.color}18`, color: spec.color }}>{spec.label}</span>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/50">{event.phase === 'active' ? 'active window' : 'recovery tail'}</span>
                        </div>
                        <div className="mt-1 text-sm font-bold text-white/85">{event.event_type ?? spec.label}</div>
                        <div className="mt-1 text-[11px] text-white/45">{event.freeway ?? '--'} {event.direction ?? ''} · {event.location_text ?? '位置未知'}</div>
                        <div className="mt-2 grid grid-cols-5 gap-2 text-[10px] font-mono text-white/50">
                          <div>category<br /><span className="text-white/80">{event.category ?? '--'}</span></div>
                          <div>feature<br /><span className="text-white/80">{featureName}</span></div>
                          <div>duration<br /><span className="text-white/80">{event.duration_minutes ?? '--'} min</span></div>
                          <div>severity<br /><span className="text-white/80">{event.severity ?? '--'}</span></div>
                          <div>weight<br /><span className="text-white/80">{event.spatial_weight ?? '--'}</span></div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200/80">
              当前传感器没有事件表命中。下面仍展示全局 subtype / category / feature / icon 映射关系。
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
          <div className="mb-3">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Feature Matrix</div>
            <div className="mt-1 text-lg font-black">当前帧事故特征通道</div>
          </div>
          <div className="space-y-2">
            {featureRows.map(({ feature, payload, spec, category }) => {
              return (
                <div key={feature} className="grid grid-cols-[24px_1fr_78px_78px_78px] items-center gap-2 rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-[11px]">
                  <i className={iconClassName(spec)} style={{ color: spec.color, fontSize: 15, width: 18, textAlign: 'center' }} />
                  <div className="min-w-0">
                    <div className="truncate font-bold text-white/75">{feature}</div>
                    <div className="truncate text-white/35">{category} → {spec.label}</div>
                  </div>
                  <div className="font-mono text-white/50">raw {payload?.value ?? 0}</div>
                  <div className="font-mono text-white/50">log {payload?.log_value ?? 0}</div>
                  <div className="font-mono text-white/50">z {payload?.normalized ?? 0}</div>
                </div>
              );
            })}
            {!featureRows.length && <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/45">后端没有返回事故特征名。</div>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[0.9fr_1.1fr] gap-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
          <div className="mb-3">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Category Relation</div>
            <div className="mt-1 text-lg font-black">类别 → 矩阵通道 → 兜底图标</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {categoryFeatureRows.map(({ feature, category, spec }) => {
              return (
                <div key={feature} className="rounded-2xl border border-white/8 bg-black/20 p-3">
                  <div className="flex items-center gap-2">
                    <i className={iconClassName(spec)} style={{ color: spec.color, fontSize: 16, width: 18, textAlign: 'center' }} />
                    <span className="text-sm font-black text-white/80">{spec.label}</span>
                  </div>
                  <div className="mt-2 font-mono text-[10px] text-white/45">{category}</div>
                  <div className="font-mono text-[10px] text-white/65">{feature}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Scenario Relation</div>
              <div className="mt-1 text-lg font-black">事故持续情景 → 预测变化</div>
            </div>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-mono text-white/50">{incidentScenarios.length} rows</span>
          </div>
          {incidentScenarios.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {incidentScenarios.map((scenario) => (
                <div key={scenario.key} className="rounded-2xl border border-rose-300/15 bg-rose-500/[0.07] px-3 py-3">
                  <div className="text-sm font-black text-rose-100">{scenario.label}</div>
                  <div className="mt-1 text-[11px] text-white/45">{scenario.description}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-mono text-white/50">
                    <div>speed<br /><span className="text-white/80">{formatSigned(scenario.delta_speed_kmh, ' km/h')}</span></div>
                    <div>occupancy<br /><span className="text-white/80">{formatSigned(scenario.delta_occupancy_pct, '%')}</span></div>
                    <div>degree<br /><span className="text-white/80">{(scenario.congestion_score * 100).toFixed(0)}%</span></div>
                    <div>level<br /><span className="text-white/80">{scenario.congestion_level}</span></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/45">当前没有活跃事故，所以后端没有生成事故持续情景。</div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.025] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Subtype Catalog</div>
            <div className="mt-1 text-lg font-black">全部 40 个事故词条 → 类别 → 图标关系</div>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-mono text-white/50">40 rows</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {subtypeCatalog.map((row) => {
            const spec = subtypeIconMap[row.subtype_id] ?? categoryIconMap[row.category] ?? categoryIconMap.other;
            const feature = featureToCategory[`cat_${row.category}`] ? `cat_${row.category}` : 'cat_other';
            return (
              <div key={row.subtype_id} className="grid grid-cols-[28px_52px_1fr_150px_92px_80px] items-center gap-2 rounded-2xl border border-white/8 bg-black/20 px-3 py-2 text-[11px]">
                <i className={iconClassName(spec)} style={{ color: spec.color, fontSize: 16, width: 18, textAlign: 'center' }} />
                <div className="font-mono text-white/55">#{row.subtype_id}</div>
                <div className="min-w-0">
                  <div className="truncate font-bold text-white/80">{row.event_type}</div>
                  <div className="truncate text-white/35">icon: {spec.label}</div>
                </div>
                <div className="font-mono text-white/50">{row.category}</div>
                <div className="font-mono text-white/50">{feature}</div>
                <div className="text-right font-mono text-white/45">n={row.count}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default IncidentStatusPanel;
