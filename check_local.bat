@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
echo Python:
python --version
echo.
echo Pip:
python -m pip --version
echo.
echo Key files:
dir app.py requirements.txt render.yaml start.sh runtime.txt
echo.
pause
