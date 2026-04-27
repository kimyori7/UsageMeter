@echo off
setlocal
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo Creating venv...
    python -m venv .venv
    .venv\Scripts\pip install -r requirements-dev.txt
)

.venv\Scripts\pyinstaller ^
    --onefile ^
    --noconsole ^
    --name ClaudeMeter ^
    --icon assets\icon.ico ^
    --add-data "assets;assets" ^
    src\claudemeter\__main__.py

echo.
echo Build done. Output: dist\ClaudeMeter.exe
endlocal
