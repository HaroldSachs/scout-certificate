@echo off
rem Serves the draft site at http://localhost:8642 (close this window to stop).
cd /d "%~dp0docs"
start "" http://localhost:8642/
python -m http.server 8642 --bind 127.0.0.1
