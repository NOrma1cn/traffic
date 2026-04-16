@echo off
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0start_all.ps1" -PauseOnExit
set "EXITCODE=%ERRORLEVEL%"
exit /b %EXITCODE%
