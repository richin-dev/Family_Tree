@echo off
cd /d "%~dp0"
node scripts\reset-password.mjs
if errorlevel 1 echo.
if errorlevel 1 echo Reset was not confirmed. Review the message above.
echo.
pause