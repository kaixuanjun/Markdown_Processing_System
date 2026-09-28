@echo off
rem MPS classroom-vote launcher (ASCII only wrapper; real logic is in start-vote.ps1,
rem which is saved as UTF-8 with BOM so PowerShell reads Chinese text correctly).
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-vote.ps1"
if errorlevel 1 pause
endlocal