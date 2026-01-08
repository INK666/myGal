@echo off
chcp 65001 >nul

:MAIN_MENU
echo ============================================
echo             GameManage Control             
echo ============================================
echo.
echo 1. Development Mode (Vite + Electron)
echo 2. Production Mode (Only Electron)
echo 3. Stop All Related Processes
echo 4. Exit
echo.

set /p choice=Please enter your choice (1-4): 

echo.

if "%choice%"=="1" (
    echo Starting Development Mode...
    echo This will start both Vite dev server and Electron
    echo ============================================
    start "GameManage Dev" /min cmd /c "npm run dev"
    echo Development Mode started successfully!
    echo Vite dev server is running on http://localhost:5173
    echo Electron application should open shortly
    echo.
    goto MAIN_MENU
)

if "%choice%"=="2" (
    echo Starting Production Mode...
    echo ============================================
    start cmd /k "npm run electron-prod"
    echo Production Mode started successfully!
    echo.
    goto MAIN_MENU
)

if "%choice%"=="3" (
    echo Stopping All Related Processes...
    echo ============================================
    taskkill /im node.exe /f 2>nul
    taskkill /im electron.exe /f 2>nul
    taskkill /im vite.exe /f 2>nul
    echo All processes have been stopped successfully!
    echo.
    goto MAIN_MENU
)

if "%choice%"=="4" (
    echo Exiting...
    exit /b
)

echo Invalid choice. Please try again.
echo.
goto MAIN_MENU