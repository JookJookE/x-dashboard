@echo off
title X Tweet Generator Server

echo =======================================================
echo  X Tweet Generator Dashboard Server Starting...
echo =======================================================
echo.

echo [INFO] Stopping any existing server instances...
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

set NODE_EXEC="C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe"

if exist %NODE_EXEC% (
    %NODE_EXEC% server.js
) else (
    node server.js
)

pause
