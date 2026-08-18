@echo off
cd /d "%~dp0"
title X Tweet Generator Server

echo =======================================================
echo  X Tweet Generator Dashboard Server Starting...
echo =======================================================
echo.

echo [INFO] Stopping any existing server instances...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im cloudflared.exe >nul 2>&1
powershell -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
powershell -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*hide_window.ps1*' } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
ping 127.0.0.1 -n 2 >nul

echo [INFO] Server starting... Window will auto-hide to background in 10 seconds.
echo.

start "" powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0hide_window.ps1" "%time%"

if exist "C:\Program Files\nodejs\node.exe" goto RUN_PROGRAM_FILES
if exist "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" goto RUN_VS

:RUN_NODE
node "%~dp0server.js"
timeout /t 2 /nobreak >nul
goto RUN_NODE

:RUN_PROGRAM_FILES
"C:\Program Files\nodejs\node.exe" "%~dp0server.js"
timeout /t 2 /nobreak >nul
goto RUN_PROGRAM_FILES

:RUN_VS
"C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" "%~dp0server.js"
timeout /t 2 /nobreak >nul
goto RUN_VS

:END
exit
