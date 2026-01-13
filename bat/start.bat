@echo off
chcp 65001 >nul

echo 选择启动模式：
echo 1. 开发模式 (启动Vite + Electron)
echo 2. 生产模式 (仅启动Electron)
echo 3. 退出

set /p mode=请输入数字选择:

if "%mode%"=="1" (
    echo 正在启动开发模式...
    npm run dev
    goto end
)

if "%mode%"=="2" (
    echo 正在启动生产模式...
    npm run start
    goto end
)

if "%mode%"=="3" (
    echo 退出程序
    goto end
)

echo 无效的选择，请重新运行脚本

:end
pause