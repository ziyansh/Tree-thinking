@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo ========================================
echo   树状对话 - 一键启动（后端 + 前端）
echo ========================================
echo.

REM ---------- 1. 后端虚拟环境 ----------
if not exist "backend\.venv\Scripts\python.exe" (
    echo [1/4] 未找到后端虚拟环境，正在创建 backend\.venv ...
    python -m venv backend\.venv
    if errorlevel 1 goto :no_python
    echo       正在安装后端依赖，请稍候 ...
    backend\.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
    if errorlevel 1 goto :pip_failed
) else (
    echo [1/4] 后端虚拟环境已就绪
)

REM ---------- 2. 前端依赖 ----------
if not exist "frontend\node_modules" (
    echo [2/4] 未找到前端依赖，正在执行 npm install ...
    call npm install --prefix frontend
    if errorlevel 1 goto :npm_failed
) else (
    echo [2/4] 前端依赖已就绪
)

REM ---------- 3. 默认配置 ----------
REM 这里只准备配置文件的默认值；API 相关配置请在页面左下角「设置」中完成
if not exist "backend\.env" (
    echo [3/4] 未找到 backend\.env，已从 .env.example 复制默认配置
    copy "backend\.env.example" "backend\.env" >nul
) else (
    echo [3/4] 配置文件 backend\.env 已就绪
)

REM ---------- 4. 端口占用提示 ----------
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 echo       提示：8000 端口已被占用，后端可能启动失败
netstat -ano | findstr ":5173" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 echo       提示：5173 端口已被占用，前端可能启动失败

REM ---------- 5. 启动前后端 ----------
echo [4/4] 正在启动服务（新窗口）...
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload' -WorkingDirectory '%CD%\backend'"

powershell -NoProfile -Command "Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory '%CD%\frontend'"

echo.
echo 等待服务就绪（约 8 秒）后自动打开浏览器 ...
ping -n 9 127.0.0.1 >nul
start "" http://localhost:5173

echo.
echo 后端： http://127.0.0.1:8000  （健康检查 /health）
echo 前端： http://localhost:5173
echo.
echo 两个新窗口请勿关闭；关闭窗口即可停止对应服务。
echo 首次使用：在页面左下角「设置」中填写 API Key，保存后立即生效（无需重启）。
echo.
pause
exit /b 0

REM ---------- 错误分支 ----------
:no_python
echo.
echo [错误] 未找到 python 命令，请先安装 Python 3.10+ 并勾选 "Add to PATH"。
echo        下载地址：https://www.python.org/downloads/
pause
exit /b 1

:pip_failed
echo.
echo [错误] 后端依赖安装失败，请检查网络后重试：
echo        backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
pause
exit /b 1

:npm_failed
echo.
echo [错误] 前端依赖安装失败，请检查 Node.js 与网络后重试：
echo        npm install --prefix frontend
echo        Node.js 下载：https://nodejs.org/
pause
exit /b 1
