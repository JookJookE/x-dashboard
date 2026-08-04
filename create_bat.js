const fs = require('fs');

const batContent = `@echo off
title X Tweet Generator Server

echo =======================================================
echo  X Tweet Generator Dashboard Server Starting...
echo =======================================================
echo.

echo [INFO] Stopping any existing server instances...
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

set NODE_EXEC="C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Microsoft\\VisualStudio\\NodeJs\\node.exe"

if exist %NODE_EXEC% (
    %NODE_EXEC% server.js
) else (
    node server.js
)

pause
`;

fs.writeFileSync('실행하기.bat', batContent, 'utf8');
console.log('Smart 실행하기.bat created with taskkill cleanup');
