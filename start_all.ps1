[CmdletBinding()]
param(
    [switch]$SkipPythonInstall,
    [switch]$SkipFrontendInstall,
    [switch]$SkipVerify,
    [switch]$PauseOnExit
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$env:PYTHONIOENCODING = "utf-8"
$env:NPM_CONFIG_FUND = "false"
$env:NPM_CONFIG_AUDIT = "false"

function Write-Title([string]$Text) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
}

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "[步骤] $Text" -ForegroundColor Yellow
}

function Write-Ok([string]$Text) {
    Write-Host "[完成] $Text" -ForegroundColor Green
}

function Write-Warn([string]$Text) {
    Write-Host "[提醒] $Text" -ForegroundColor Magenta
}

function Fail([string]$Text) {
    throw $Text
}

function Pause-IfNeeded {
    if ($PauseOnExit) {
        Write-Host ""
        Read-Host "按回车键退出"
    }
}

function Resolve-CommandPath([string[]]$Names) {
    foreach ($name in $Names) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd) {
            return $cmd.Source
        }
    }
    return $null
}

$PythonExe = Resolve-CommandPath @("python", "py")
$PythonPrefixArgs = @()
if (-not $PythonExe) {
    Fail "没有找到 Python。请先安装 Python 3.8 或更高版本，并勾选 Add Python to PATH。"
}
if ((Split-Path $PythonExe -Leaf) -ieq "py.exe") {
    $PythonPrefixArgs = @("-3")
}

$NodeExe = Resolve-CommandPath @("node")
if (-not $NodeExe) {
    Fail "没有找到 Node.js。请先安装 Node.js 16 或更高版本。"
}

$NpmExe = Resolve-CommandPath @("npm", "npm.cmd")
if (-not $NpmExe) {
    Fail "没有找到 npm。请确认 Node.js 已正确安装。"
}

function Invoke-Python {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Args
    )

    & $PythonExe @($PythonPrefixArgs + $Args)
    if ($LASTEXITCODE -ne 0) {
        Fail "Python 命令执行失败：$($Args -join ' ')"
    }
}

function Invoke-Npm {
    param(
        [string[]]$NpmArgs,
        [string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        & $NpmExe @NpmArgs
        if ($LASTEXITCODE -ne 0) {
            Fail "npm 命令执行失败：$($NpmArgs -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

try {
    Write-Title "D03 交通预测平台一键启动"
    Write-Host "这个脚本会自动帮你做下面几件事：" -ForegroundColor Gray
    Write-Host "1. 检查 Python / Node.js 是否可用" -ForegroundColor Gray
    Write-Host "2. 自动补齐 Python 依赖" -ForegroundColor Gray
    Write-Host "3. 自动补齐前端依赖" -ForegroundColor Gray
    Write-Host "4. 自动生成 frontend/.env（如果缺失）" -ForegroundColor Gray
    Write-Host "5. 自动执行项目自检" -ForegroundColor Gray
    Write-Host "6. 自动启动后端和前端" -ForegroundColor Gray

    Write-Step "检查基础运行环境"
    Invoke-Python --version
    & $NodeExe --version
    & $NpmExe --version
    Write-Ok "Python / Node.js / npm 已就绪"

    if (-not (Test-Path "frontend\.env")) {
        if (Test-Path "frontend\.env.d03") {
            Write-Step "自动生成前端配置文件 frontend/.env"
            Copy-Item "frontend\.env.d03" "frontend\.env" -Force
            Write-Ok "已生成 frontend/.env"
        }
        else {
            Write-Warn "没有找到 frontend/.env.d03，前端将使用默认配置继续启动"
        }
    }
    else {
        Write-Ok "frontend/.env 已存在，跳过自动生成"
    }

    if (-not $SkipPythonInstall) {
        Write-Step "检查并补齐 Python 依赖（第一次运行会稍慢）"
        Invoke-Python -m pip install -r requirements.txt
        Write-Ok "Python 依赖已就绪"
    }
    else {
        Write-Warn "已跳过 Python 依赖安装"
    }

    if (-not $SkipFrontendInstall) {
        Write-Step "检查并补齐前端依赖（第一次运行会稍慢）"
        Invoke-Npm -NpmArgs @("install") -WorkingDirectory (Join-Path $RepoRoot "frontend")
        Write-Ok "前端依赖已就绪"
    }
    else {
        Write-Warn "已跳过前端依赖安装"
    }

    if (-not $SkipVerify) {
        Write-Step "执行项目自检"
        Invoke-Python verify_d03_setup.py
        Write-Ok "项目自检通过"
    }
    else {
        Write-Warn "已跳过项目自检"
    }

    Write-Step "启动前后端服务"
    Write-Host "启动后会看到一个本地访问地址，例如 http://localhost:5173 或 http://localhost:5174" -ForegroundColor Gray
    Write-Host "如果 5173 被其他程序占用，系统会自动换一个端口，这是正常现象。" -ForegroundColor Gray
    Write-Host "停止服务时，直接在这个窗口按 Ctrl + C 即可。" -ForegroundColor Gray
    Write-Host ""

    & $NodeExe (Join-Path $RepoRoot "dev.js")
    if ($LASTEXITCODE -ne 0) {
        Fail "一键启动失败，请滚动查看上面的报错信息。"
    }
}
catch {
    Write-Host ""
    Write-Host "[失败] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "排查建议：" -ForegroundColor Red
    Write-Host "1. 先确认 Python 和 Node.js 已安装" -ForegroundColor Red
    Write-Host "2. 确认网络可访问 pip / npm 源" -ForegroundColor Red
    Write-Host "3. 再次运行本脚本，查看最早出现的报错位置" -ForegroundColor Red
    Pause-IfNeeded
    exit 1
}

Pause-IfNeeded
