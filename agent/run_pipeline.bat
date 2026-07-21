@echo off
REM Обёртка для Планировщика задач Windows: сборка снапшота + публикация.
REM Использование: run_pipeline.bat <pipeline>   (today | historical)
setlocal
set "AGENT_DIR=%~dp0"
cd /d "%AGENT_DIR%"
set "PIPELINE=%~1"
if "%PIPELINE%"=="" set "PIPELINE=today"

REM Синк .env из единого платформенного .env (один пароль на всё — BACKLOG).
REM Best-effort: если платформы рядом нет, работаем со своим .env как раньше.
set "SYNC_SCRIPT=%AGENT_DIR%..\..\telecom-analytics-platform\scripts\sync_orders_env.py"
if exist "%SYNC_SCRIPT%" (
    "C:\Users\1\AppData\Local\Programs\Python\Python314\python.exe" "%SYNC_SCRIPT%"
)

"C:\Users\1\AppData\Local\Programs\Python\Python314\python.exe" collector.py --pipeline %PIPELINE%
endlocal
