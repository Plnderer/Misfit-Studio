@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\apply.ps1"
if errorlevel 1 (
  echo.
  echo Install failed. See messages above.
  pause
  exit /b 1
)
echo.
echo Done. Restart Antigravity.
pause
