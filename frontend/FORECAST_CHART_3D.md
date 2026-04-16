# ForecastChart 3D 功能说明

## 功能概述

`ForecastChart` 组件已升级支持 **2D/3D 双模式切换**，用户可以点击图表下方的按钮在两种视图间平滑过渡。

## 主要特性

### 2D 模式（默认）
- 显示今天的历史数据和预测数据
- 青色曲线表示历史数据
- 绿色虚线表示预测数据
- 渐变填充效果

### 3D 模式
- 将观测区与预测区挤出为 3D 体积层（前/后/侧面）
- 2D 填充与 3D 体积在切换时平滑淡入淡出
- 支持 OrbitControls 交互（旋转、缩放、平移）

## 使用方法

### 基本用法

```tsx
import ForecastChart from './components/ForecastChart';

<ForecastChart
  data={chartData}
  predictionStartIdx={24}
  metricLabel="速度"
  unit="km/h"
  referenceValue={60}
  referenceLabel="基准速度"
/>
```

### 提供多日对比数据（可选）

```tsx
const multiDayData = [
  {
    day: 'MON',
    date: '2026-04-06',
    data: [60, 65, 70, 75, 80, 85, 90, 95],
    isToday: false,
  },
  // ... 更多天数
  {
    day: 'SUN',
    date: '2026-04-12',
    data: [65, 70, 75, 80, 85, 90, 95, 100],
    isToday: true,
  },
];

<ForecastChart
  data={chartData}
  multiDayData={multiDayData}
  // ... 其他 props
/>
```

## 技术实现

- **Three.js**：3D 渲染引擎
- **GLSL 着色器**：自定义渐变和描边效果
- **CatmullRom 曲线**：平滑曲线插值
- **ExtrudeGeometry**：2D 形状挤出为 3D 体积
- **Backface Expansion**：描边效果

## 交互说明

1. 点击图表下方的 **"INITIATE 3D COMPARISON"** 按钮切换到 3D 模式
2. 在 3D 模式下：
   - 🖱️ 左键拖动旋转视角
   - 🖱️ 滚轮缩放
   - 🖱️ 右键拖动平移
3. 点击 **"RETURN TO 2D"** 按钮返回 2D 模式

## 数据结构

```typescript
interface ForecastChartPoint {
  time: string;              // 时间戳
  observed: number | null;   // 历史观测值
  predicted: number | null;  // 预测值
}

interface DayData {
  day: string;        // 星期几 (MON, TUE, ...)
  date: string;       // 日期 (YYYY-MM-DD)
  data: number[];     // 数据点数组（8个点）
  isToday: boolean;   // 是否为当前日
}
```

## 注意事项

- `multiDayData` 当前为预留扩展接口（未来可用于多日对比层叠）
- 3D 模式需要 WebGL 支持
- 建议在桌面端使用以获得最佳体验
