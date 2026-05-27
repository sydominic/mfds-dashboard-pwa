@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title MFDS Dashboard Local

echo [1/4] Checking Python...
python --version || goto :err

echo [2/4] Installing requirements...
python -m pip install -r requirements.txt || goto :err

echo [3/4] Starting Streamlit...
echo Local URL: http://localhost:8501
python -m streamlit run app.py --server.port 8501 --server.address=0.0.0.0 --browser.gatherUsageStats=false
goto :end

:err
echo.
echo ERROR occurred. Check the message above.
pause

:end
