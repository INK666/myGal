@echo off
title myGal 一键打包工具
cd /d "%~dp0"

echo ========================================================
echo                 myGal 一键打包构建程序
echo ========================================================
echo.
echo  请选择打包目标:
echo    [1] 全部打包 (PC 端 + 移动端 Android APK) [默认]
echo    [2] 仅打包 PC 端 (Windows 安装包)
echo    [3] 仅打包 移动端 (Android APK)
echo    [0] 退出
echo.
set /p choice=" 请输入选项 [1/2/3/0] (默认 1): "

if "%choice%"=="" set choice=1
if "%choice%"=="0" exit /b 0
if "%choice%"=="1" goto BUILD_ALL
if "%choice%"=="2" goto BUILD_PC
if "%choice%"=="3" goto BUILD_ANDROID

echo.
echo 无效选项，退出。
goto END

:BUILD_ALL
echo.
echo 正在开始完整打包 (PC + Android)...
node scripts/build-all.js --open
goto END

:BUILD_PC
echo.
echo 正在打包 PC 端...
node scripts/build-all.js --pc --open
goto END

:BUILD_ANDROID
echo.
echo 正在打包 移动端...
node scripts/build-all.js --android --open
goto END

:END
echo.
echo ========================================================
pause
