@echo off
REM Sobe os apps (PT / EN / ES) em http://localhost:8080
cd /d "%~dp0"
start "" http://localhost:8080/
python _tools\servidor.py 8080
