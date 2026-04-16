# Caltrans D03 Traffic Forecast Dashboard

一个聚焦 **Caltrans District 03 / Sacramento 2023** 的交通预测与可视化演示仓库。  
当前版本已经做过精简，只保留了可以直接运行的主线：

- Python 后端推理服务
- React + Vite 前端仪表板
- 一键启动脚本
- 运行所需的最小本地数据约定
- 运行所需的最小 checkpoint

## 当前仓库定位

这个仓库现在更偏向：

- 本地演示
- 前后端联调
- 推理接口开发
- D03 可视化展示

它 **不再以完整训练与数据构建仓库为目标**。  
原始数据准备流程、数据过滤流程、训练脚本和中间训练产物已经从当前公开版本中移除。

## 仓库保留内容

- `backend/`：后端 API 服务
- `frontend/`：前端页面与可视化组件
- `traffic_ew/`：推理阶段仍然需要的共享模型代码
- `runs_d03/`：最小保留 checkpoint
- `start_all.ps1` / `start_all.bat`：一键启动
- `verify_d03_setup.py`：本地环境与资源检查
- `config_d03.json`：D03 路径与运行配置
- `BACKEND_DATA_MAPPING.md`：接口与数据字段说明

## 仓库不再保留的内容

为了让仓库更适合上传到 GitHub，下面这些内容已经移除或默认不提交：

- 原始交通数据
- 原始事故文本数据
- 原始元数据快照
- 中间处理数据集
- 数据处理工具脚本
- 训练脚本
- 前端构建产物
- `node_modules`
- 本地环境文件和日志

## 环境要求

- Python 3.8+
- Node.js 16+
- npm
- 可选：CUDA / GPU

## 本地运行所需数据

虽然仓库已经做了精简，但运行时仍然默认读取以下本地目录：

- `Caltrans_2023_D03/processed_d03_2023_ml95_enriched/`
- `Caltrans_2023_D03/weather_d03_2023_rich/`
- `Caltrans_2023_D03/processed_d03_accident_train_2023/`

如果这些目录不存在，`verify_d03_setup.py` 会直接报缺失。

## 保留的最小模型文件

当前默认使用两个本地 checkpoint：

- `runs_d03/d03_baseline_pure_st/best.pt`
- `runs_d03/correction_model/correction_model.pt`

## 推荐启动方式

### Windows 用户

直接双击：

- `start_all.bat`

或者在 PowerShell 中运行：

```powershell
.\start_all.ps1
```

这个脚本会自动：

- 检查 Python / Node.js / npm
- 安装 Python 依赖
- 安装前端依赖
- 自动补齐 `frontend/.env`
- 执行项目自检
- 启动前后端

如果 `5173` 已被占用，前端会自动切换到 `5174` 或其他空闲端口。

中文新手说明见 [GUIDE_ZH_CN.md](GUIDE_ZH_CN.md)。

## 手动启动

### 1. 安装 Python 依赖

```bash
pip install -r requirements.txt
```

### 2. 安装前端依赖

```bash
cd frontend
npm install
```

### 3. 运行资源检查

```bash
python verify_d03_setup.py
```

### 4. 启动系统

根目录直接启动联动开发：

```bash
node dev.js
```

或者单独启动后端：

Windows PowerShell：

```powershell
.\start_d03_server.ps1
```

Linux / macOS：

```bash
./start_d03_server.sh
```

再单独启动前端：

```bash
cd frontend
npm run dev
```

## 常用接口

后端默认地址：

- `http://127.0.0.1:8010`

常用接口：

- `GET /api/health`
- `GET /api/forecast?sensor=0`
- `GET /api/graph_structure`

字段说明见 [BACKEND_DATA_MAPPING.md](BACKEND_DATA_MAPPING.md)。

## 仓库结构

```text
.
├─ backend/                  # 后端服务
├─ frontend/                 # 前端项目
├─ traffic_ew/               # 推理阶段共享代码
├─ runs_d03/                 # 最小 checkpoint
├─ start_all.ps1             # PowerShell 一键启动
├─ start_all.bat             # 双击启动入口
├─ verify_d03_setup.py       # 资源检查
├─ config_d03.json           # 配置
└─ README.md
```

## 上传 GitHub 前建议

上传前建议确认：

1. `git status` 中不包含本地数据目录、`node_modules`、`dist`、日志
2. `python verify_d03_setup.py` 可正常通过
3. `.\start_all.ps1` 或 `node dev.js` 可以成功启动
4. README 描述与当前仓库内容一致

## 说明

当前 GitHub 版本专注于 **D03 可运行展示主线**。  
如果未来还要恢复训练链路，建议单独放在内部仓库或新分支维护。
