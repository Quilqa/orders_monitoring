@echo off
REM Обёртка для Планировщика задач Windows: сборка снапшота + публикация.
REM Использование: run_pipeline.bat <pipeline>   (today | historical)
setlocal
set "AGENT_DIR=%~dp0"
cd /d "%AGENT_DIR%"
set "PIPELINE=%~1"
if "%PIPELINE%"=="" set "PIPELINE=today"
"C:\Users\1\AppData\Local\Programs\Python\Python314\python.exe" collector.py --pipeline %PIPELINE%
endlocal
