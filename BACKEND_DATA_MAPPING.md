# Backend Data Mapping

这份文档总结当前 `backend/server_d03_pipeline.py` 暴露的数据字段与底层数据集/内存对象的对应关系，便于前端联调、接口扩展和排查数据来源。

## 总览

| 接口 | 顶层字段 | 主要来源 | 说明 |
| --- | --- | --- | --- |
| `/api/forecast` | `meta` | 服务运行时状态 + `timestamps` | 当前仿真时间、预测步长、传感器索引等 |
| `/api/forecast` | `dataset_context` | 服务初始化配置 + 数据张量 shape | 数据集规模、字段名、模型上下文 |
| `/api/forecast` | `station` | `station_metadata.csv` + `static_features` | 当前传感器基础信息和静态特征 |
| `/api/forecast` | `network` | `build_caltrans_graph(...)` 结果 | 当前站点的局部邻居和局部边 |
| `/api/forecast` | `current` | `flow.npy` / `occupancy.npy` / `speed.npy` + 风险函数 | 当前真实交通状态 |
| `/api/forecast` | `prediction_windows` | 模型预测 `pred` + 风险函数 | `h1/h6/h12` 多窗口预测摘要 |
| `/api/forecast` | `prediction_series` | 模型预测 `pred` | 未来每 5 分钟的预测序列 |
| `/api/forecast` | `history_tail` | 真实交通张量 | 过去 2 小时历史尾部 |
| `/api/forecast` | `weekly_compare` | 真实交通张量 | 最近 7 天同一时段窗口对比 |
| `/api/forecast` | `current_weather` | `weather_raw` | 当前天气摘要 |
| `/api/forecast` | `weather` | `weather_df` | 12 个月天气 panorama |
| `/api/forecast` | `weather_transition` | `weather_raw` 未来窗口 | 未来 1 小时天气变化检测 |
| `/api/forecast` | `weather_context` | `weather_raw` + `weather_model_raw` + `weather_df` | 当前/历史/未来天气完整上下文 |
| `/api/forecast` | `accidents` | `SparseAccidentFeatureSet` | 当前与历史事故特征详情 |
| `/api/forecast` | `profiles` | `self.profiles` | 当前时段历史分位统计 |
| `/api/forecast` | `scenario_predictions` | 天气情景 override 批推理 | 天气扰动情景预测 |
| `/api/forecast` | `incident_scenarios` | 事故情景 override 批推理 | 事故持续情景预测 |
| `/api/forecast` | `confidence` | 风险分量 + 走势一致性 | 预测置信度解释 |
| `/api/forecast` | `congestion_summary` | 当前/未来窗口风险 | 最高风险窗口摘要 |
| `/api/forecast` | `global_state` | 全图未来风险数组 | 所有节点未来风险峰值 |
| `/api/forecast` | `model_context` | checkpoint/config | 模型结构与输入上下文 |
| `/api/graph_structure` | `nodes` | `station_metadata.csv` | 全量路网节点 |
| `/api/graph_structure` | `links` | 图构建 edge dataframe | 全量路网边及属性 |
| `/api/graph_structure` | `metadata` | metadata 范围 + 图摘要 | 地理范围、中心点、边数量 |
| `/api/dataset_context` | 全部 | `dataset_context` 同源 | 只返回全局数据集上下文 |

## 数据源文件

| 数据源 | 典型路径 | 在服务中的对象 | 说明 |
| --- | --- | --- | --- |
| 站点元数据 | `Caltrans_2023_D03/processed_d03_2023_ml95_enriched/station_metadata.csv` | `self.metadata` | 站点属性、经纬度、车道数、里程、覆盖率 |
| 时间轴 | `Caltrans_2023_D03/processed_d03_2023_ml95_enriched/timestamps.npy` | `self.timestamps` | 5 分钟分辨率时间序列 |
| 车流量 | `.../flow.npy` | `self.flow_raw` | `veh/5min` |
| 占有率 | `.../occupancy.npy` | `self.occupancy_raw` | 原始比例值，接口里常转成 `%` |
| 速度 | `.../speed.npy` | `self.speed_raw` | 原始 `mph`，接口里常转成 `km/h` |
| 天气 NPY | `Caltrans_2023_D03/weather_d03_2023_rich/*.npy` | `self.weather_raw` / `self.weather_model_raw` | 对齐到交通时间轴的天气特征 |
| 天气 CSV | `Caltrans_2023_D03/weather_d03_2023_rich/*.csv` | `self.weather_df` | 原始天气表，用于月度 panorama |
| 事故特征 | `Caltrans_2023_D03/processed_d03_accident_train_2023/` | `self.accident_features` | 稀疏事故矩阵 |
| 静态特征 | 由 metadata 构造 | `self.static_features` | 归一化数值 + one-hot 类别 |
| 图结构 | 由 metadata 构造 | `self.graph_edge_df` / `self.graph_links` | 路网拓扑和边权重 |
| 历史分位画像 | 由 traffic tensors 构造 | `self.profiles` | `q10/median/q90` |

## `/api/forecast` 字段对照

### 1. 运行与数据集上下文

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `meta.dataset` | 常量 | 当前数据集名称 |
| `meta.mode` | 常量 | 当前服务模式标识 |
| `meta.t_obs` | `_now_index()` | 当前仿真时间索引 |
| `meta.sensor` | 请求参数 | 当前传感器索引 |
| `meta.sim_time` | `self.timestamps[t_obs]` | 当前仿真时间 |
| `meta.day_type` | `_day_type_index(t_obs)` | `weekday` / `weekend` |
| `meta.slot_index` | `_slot_index(t_obs)` | 当天 5 分钟槽位编号 |
| `dataset_context.weather_fields` | `self.weather_field_names` | 完整天气字段名 |
| `dataset_context.accident_feature_names` | `self.accident_feature_names` | 事故特征字段名 |
| `dataset_context.static_feature_spec` | `self.static_feature_spec_live` | 静态特征编码说明 |
| `dataset_context.graph_summary` | `self.graph_summary_live` | 图构建摘要 |

### 2. 站点与路网

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `station.station_id` | `metadata.station_id` | Caltrans 站点 ID |
| `station.station_name` | `metadata.station_name` | 站点名 |
| `station.freeway` | `metadata.freeway` | 高速编号 |
| `station.direction` | `metadata.direction` | 行驶方向 |
| `station.lane_type` | `metadata.lane_type` / `meta_type` | 车道类型 |
| `station.lanes` | `metadata.lanes` | 车道数 |
| `station.abs_pm` | `metadata.abs_pm` | 绝对 postmile |
| `station.latitude` / `station.longitude` | `metadata` | 地理坐标 |
| `station.coverage_ratio` | `metadata.coverage_ratio` | 数据完整度 |
| `station.meta_flags.*` | `meta_*_mismatch` | 元数据一致性标志 |
| `station.static_features.numeric` | `self.static_features` + spec | 数值静态特征原值/归一化值 |
| `station.static_features.categorical` | `self.static_features` + spec | 类别特征 one-hot 解释 |
| `network.local_neighbors` | `graph_edge_df` + `metadata` | 当前节点邻居站点 |
| `network.local_links` | `graph_edge_df` | 当前节点附近的边、边类型、权重、成本 |

### 3. 交通状态与预测

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `current.*` | 当前 `flow/occupancy/speed` | 当前真实状态 |
| `current.components.*` | `_risk_from_state(...)` | 风险分量 |
| `prediction_windows.h1/h6/h12` | `pred` + `_window_packet(...)` | 关键预测窗口摘要 |
| `prediction_series.*` | `pred[sensor, :, :]` | 逐步预测序列 |
| `history_tail.*` | 真实交通张量 | 默认过去 48 个点，可用 `history_steps` / `history_tail_steps` 调整 |
| `daily_congestion.*` | 真实交通张量 + `_risk_from_state(...)` | 当前自然日 24 个小时均值拥堵点，未来小时为 `none` |
| `weekly_compare.days[].*` | 真实交通张量 | 最近 7 天相同时段窗口 |
| `profiles.metrics.*` | `self.profiles` | 当前时段历史分位对照 |
| `global_state.pred_scores` | `_risk_from_arrays(...)` | 全图未来风险峰值 |

### 4. 天气

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `current_weather` | `_weather_packet(t_obs)` | 当前天气摘要 |
| `weather` | `_monthly_weather_panorama(...)` | 12 个月 panorama 采样 |
| `weather_transition` | `_detect_weather_transition(...)` | 天气转场检测 |
| `weather_context.current.raw_fields` | `self.weather_raw[t_obs]` | 当前完整天气字段 |
| `weather_context.current.model_fields` | `self.weather_model_raw[t_obs]` | 模型真正使用的天气字段 |
| `weather_context.recent_history[]` | `weather_raw[t_obs-11:t_obs]` | 最近 1 小时天气上下文 |
| `weather_context.forecast_window[]` | `weather_raw[future_idx]` | 未来窗口天气上下文 |

### 5. 事故

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `accidents.feature_names` | `feature_names.json` | 事故特征名列表 |
| `accidents.current.*` | `SparseAccidentFeatureSet.slice_dense(...)` | 当前站点事故特征 |
| `accidents.current.<name>.value` | 稀疏矩阵原值（反 `log1p`） | 更接近原始事故强度/计数 |
| `accidents.current.<name>.log_value` | 稀疏矩阵加载后值 | 当前内部 logged 值 |
| `accidents.current.<name>.normalized` | 用训练统计标准化后 | 可直接给模型或调试 |
| `accidents.active_features` | 当前激活项筛选 | 当前非零事故特征 |
| `accidents.history[]` | 最近 12 个时间点事故特征 | 调试事故演变 |
| `incident_scenarios[]` | 事故 override 批推理 | 事故持续情景预测 |

## 事故特征名

当前事故特征来自 `processed_d03_accident_train_2023/feature_names.json`：

| 特征名 | 含义 |
| --- | --- |
| `incident_total` | 事故总量/总强度 |
| `cat_collision` | 碰撞类事件 |
| `cat_obstruction_hazard` | 障碍物/危险物 |
| `cat_fire_hazmat` | 火灾/危化品 |
| `cat_control_closure` | 交通管制/封闭 |
| `cat_maintenance_construction` | 维护/施工 |
| `cat_weather_environment` | 天气/环境因素 |
| `cat_emergency_special` | 紧急/特殊事件 |
| `cat_other` | 其他事件 |

## 当前最适合前端直接消费的字段

如果前端想尽快做“高信息密度”的可视化，优先推荐：

| 用途 | 推荐字段 |
| --- | --- |
| 传感器详情面板 | `station` |
| 局部路网卡片 | `network.local_neighbors`, `network.local_links` |
| 天气原始参数面板 | `weather_context.current.raw_fields` |
| 天气时间轴 | `weather_context.recent_history`, `weather_context.forecast_window` |
| 事故详情面板 | `accidents.current`, `accidents.history`, `accidents.active_features` |
| 当前异常解释 | `profiles`, `current.components`, `confidence` |
| 周时段对比图 | `weekly_compare` |
| 全局数据集说明 | `/api/dataset_context` |

## 备注

- 当前后端已经尽量把“服务内已有的数据”结构化吐出，但仍然是以单传感器查询为主。
- 如果后续需要更细的接口，建议拆分成：
  - `station_context`
  - `weather_context`
  - `accident_context`
  - `network_context`
- 这样前端可以按需懒加载，避免 `/api/forecast` 响应继续膨胀。
