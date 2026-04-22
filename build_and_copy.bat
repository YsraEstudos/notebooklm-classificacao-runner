@echo off
setlocal

cd /d "%~dp0"

echo =======================================================
echo Building NotebookLM Classificacao Runner...
echo Project: %CD%
echo =======================================================
echo.

if not exist node_modules (
  echo [1/3] Installing dependencies...
  call npm install
  if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b %ERRORLEVEL%
  )
)

echo [2/3] Running Vite build...
call npm run build
if %ERRORLEVEL% neq 0 (
  echo.
  echo [ERRO] Falha ao compilar o userscript.
  pause
  exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Copying generated userscript to clipboard...
clip < dist\notebooklm-classificacao-runner.user.js

echo.
echo [SUCESSO] Build concluida e copiada para a area de transferencia.
echo Arquivo gerado: %CD%\dist\notebooklm-classificacao-runner.user.js
echo.
pause
