@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Media Bot

if not "%~1"=="" set "BOT_TOKEN=%~1"
if not "%~2"=="" set "WEBAPP_URL=%~2"
if not exist ".env" if exist ".env.example" copy /y ".env.example" ".env" >nul

if not exist ".venv\Scripts\python.exe" (
    where py >nul 2>nul
    if not errorlevel 1 (
        py -3 -m venv .venv
    ) else (
        where python >nul 2>nul
        if errorlevel 1 (
            echo Не найден Python 3. Установите Python и повторите запуск.
            pause
            exit /b 1
        )
        python -m venv .venv
    )
    if errorlevel 1 goto :failed
    .venv\Scripts\python.exe -m pip install --upgrade pip
    if errorlevel 1 goto :failed
    .venv\Scripts\python.exe -m pip install -r bot\requirements.txt
    if errorlevel 1 goto :failed
)

.venv\Scripts\python.exe bot\bot.py
if not "%errorlevel%"=="0" (
    echo.
    echo Бот остановлен с ошибкой. Проверьте сообщение выше и файл .env.
    pause
)
endlocal
exit /b

:failed
echo Не удалось подготовить окружение Python. Проверьте подключение к интернету.
pause
endlocal
exit /b 1
