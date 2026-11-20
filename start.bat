@echo off
@chcp 437 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo ==========================================
echo   Tree Thinking - One-click launcher
echo ==========================================
echo.

title "Tree Thinking startup"

REM ---------- 1. Check Python ----------
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY goto :no_python

REM ---------- 2. Check Node.js ----------
where npm >nul 2>nul || goto :no_node

REM ---------- 3. Backend venv + dependencies ----------
if not exist "backend\.venv\Scripts\python.exe" (
    echo [1/4] Creating backend virtual environment...
    %PY% -m venv "backend\.venv"
    if errorlevel 1 goto :venv_failed
)
echo [1/4] Installing backend dependencies...
"backend\.venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r "backend\requirements.txt"
if errorlevel 1 goto :pip_failed

REM ---------- 4. Default config ----------
if not exist "backend\.env" (
    echo [2/4] Creating backend\.env from .env.example
    copy "backend\.env.example" "backend\.env" >nul
) else (
    echo [2/4] backend\.env is ready
)

REM ---------- 5. Frontend dependencies ----------
echo [3/4] Installing frontend dependencies...
pushd "frontend"
call npm install --no-audit --no-fund
if errorlevel 1 (
    popd
    goto :npm_failed
)
popd

REM ---------- 6. Start services ----------
echo [4/4] Starting backend and frontend...
start "Tree Thinking Backend" /D "%~dp0backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

echo Waiting for backend health check...
powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/health' -TimeoutSec 2; if($r.StatusCode -eq 200){$ok=$true; break} } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ok){ exit 1 }"
if errorlevel 1 (
    echo [WARN] Backend did not become ready. Check the backend window for errors.
) else (
    echo Backend is ready.
)

start "Tree Thinking Frontend" /D "%~dp0frontend" cmd /k "npm run dev"
ping -n 4 127.0.0.1 >nul
start "" http://localhost:5173

echo.
echo Backend:  http://127.0.0.1:8000/health
echo Frontend: http://localhost:5173
echo Keep both windows open; closing a window stops that service.
echo Configure the API key in Settings (bottom-left of the page).
echo.
pause
exit /b 0

REM ---------- Error branches ----------
:no_python
echo.
echo [ERROR] Python 3.10+ not found.
echo Install from https://www.python.org/downloads/
echo During installation enable "Add python.exe to PATH".
pause
exit /b 1

:no_node
echo.
echo [ERROR] Node.js / npm not found.
echo Install the LTS version from https://nodejs.org/
pause
exit /b 1

:venv_failed
echo.
echo [ERROR] Failed to create backend\.venv
pause
exit /b 1

:pip_failed
echo.
echo [ERROR] Failed to install backend dependencies. Check network and retry:
echo   backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
pause
exit /b 1

:npm_failed
echo.
echo [ERROR] Failed to install frontend dependencies. Check Node.js and network:
echo   cd frontend
echo   npm install
pause
exit /b 1
