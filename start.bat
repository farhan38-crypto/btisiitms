@echo off
rem BITS reports for Windows: double-click this file (or run "start.bat -Local" for no public link, "start.bat -Classic" to also run the old app).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
