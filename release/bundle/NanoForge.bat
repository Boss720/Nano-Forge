@echo off
setlocal
title NanoForge Platform
cd /d "%~dp0"

echo ===================================================
echo   NanoForge Standalone Runner
echo ===================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in system PATH.
    echo Please install Node.js 20+ from https://nodejs.org
    pause
    exit /b 1
)

node "%~dp0nanoforge-launcher.cjs" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo NanoForge exited with status %ERRORLEVEL%.
    pause
)
