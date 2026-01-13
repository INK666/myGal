@echo off
taskkill /f /im electron.exe 2>nul
taskkill /f /im node.exe 2>nul
echo Processes stopped.
pause