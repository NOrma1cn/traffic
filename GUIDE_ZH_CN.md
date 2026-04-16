# D03 交通预测平台小白启动指南

这份说明是给第一次接触项目、希望“直接跑起来”的中文用户准备的。

## 你只需要做什么

1. 先安装 **Python 3.8+**
2. 再安装 **Node.js 16+**
3. 回到项目根目录，直接双击 [`start_all.bat`](start_all.bat)

如果你平时用 PowerShell，也可以右键“使用 PowerShell 运行” [`start_all.ps1`](start_all.ps1)。

## 一键启动脚本会自动帮你做什么

- 自动检查 Python / Node.js / npm 是否存在
- 自动安装 Python 依赖
- 自动安装前端依赖
- 自动补出 `frontend/.env`
- 自动执行项目自检
- 自动启动后端和前端

也就是说，大多数情况下你不需要手动执行 `pip install`、`npm install`、复制 `.env`、分别启动服务。

## 第一次运行会发生什么

第一次运行通常最慢，因为要下载依赖。

正常情况下你会在窗口里看到类似下面的信息：

```text
[完成] Python 依赖已就绪
[完成] 前端依赖已就绪
[完成] 项目自检通过
[DevRunner] Backend is healthy at http://127.0.0.1:8010
Local: http://localhost:5173/
```

如果 `5173` 端口已经被别的程序占用了，也可能看到：

```text
Port 5173 is in use, trying another one...
Local: http://localhost:5174/
```

这也是正常现象。打开终端里显示的那个地址即可。

## 怎么确认已经启动成功

看到下面两类信息，就说明基本成功了：

- 后端健康检查通过：`Backend is healthy`
- 前端给出本地地址：`Local: http://localhost:5173/` 或其他端口

随后在浏览器里打开那个地址，就能看到前端页面。

## 怎么停止程序

如果程序正在运行：

- 直接回到启动窗口
- 按 `Ctrl + C`

这样会同时停止前端和后端。

## 最常见的几个问题

### 1. 提示找不到 Python

说明电脑没有安装 Python，或者没有把 Python 加进 PATH。

处理方法：

- 安装 Python 3.8 或更高版本
- 安装时勾选 `Add Python to PATH`
- 安装完成后重新双击 [`start_all.bat`](start_all.bat)

### 2. 提示找不到 Node.js / npm

说明前端运行环境还没装好。

处理方法：

- 安装 Node.js 16 或更高版本
- 安装完成后重新运行脚本

### 3. 依赖安装很慢

第一次运行比较常见，尤其在网络不稳定的时候。

你可以：

- 稍等几分钟再看
- 确认网络可访问 pip / npm 源
- 重新运行脚本

### 4. 页面打不开

先看启动窗口最后显示的地址是多少。

注意：

- 不一定是 `5173`
- 也可能是 `5174`、`5175` 等

请以脚本最后打印出来的 `Local:` 地址为准。

### 5. 想单独启动后端

可以使用：

- Windows: [`start_d03_server.ps1`](start_d03_server.ps1)

但如果你只是想把整套系统跑起来，优先推荐 [`start_all.bat`](start_all.bat)。

## 推荐启动方式

对大多数中文用户，最简单的流程就是：

1. 安装 Python
2. 安装 Node.js
3. 双击 [`start_all.bat`](start_all.bat)
4. 打开终端里显示的本地地址

这就是完整流程。
