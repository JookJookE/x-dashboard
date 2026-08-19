@echo off
chcp 65001 >nul
cd /d "%~dp0"
title X Tweet Generator - Code Updater

echo =======================================================
echo  GitHub 최신 코드 업데이트를 시작합니다...
echo =======================================================
echo.

git pull origin main --no-rebase

echo.
echo [INFO] 신규 패키지 의존성(npm)을 설치/점검합니다...
call npm.cmd install --no-audit

echo.
echo =======================================================
echo  최신 코드 및 패키지 업데이트가 완료되었습니다!
echo =======================================================

pause
