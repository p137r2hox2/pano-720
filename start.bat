@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ============================================
echo     720 pano - local preview
echo     http://localhost:8712/
echo     Close this window to stop the server
echo   ============================================
echo.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8712/"
python tools\serve.py 8712
if errorlevel 1 (
  echo Python not found, trying py launcher...
  py tools\serve.py 8712
)
pause
