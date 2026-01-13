@echo off
chcp 65001 >nul

echo 正在停止GameManage相关进程...

echo 终止Electron进程...
taskkill /f /im electron.exe 2>nul

echo 终止Vite进程...
taskkill /f /im node.exe /fi "WINDOWTITLE eq *Vite*" 2>nul

echo 所有相关进程已停止
echo.
pause