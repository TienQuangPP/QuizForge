@echo off
setlocal
cd /d "%~dp0"
title QuizForge
set "NODE_EXE=%~dp0runtime\node.exe"
if not exist "%NODE_EXE%" for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined FOUND set "FOUND=%%I"
if not exist "%NODE_EXE%" set "NODE_EXE=%FOUND%"
if not exist "%NODE_EXE%" (
  echo [LOI] Khong tim thay runtime\node.exe. Hay giai nen DAY DU file ZIP vao mot thu muc.
  pause
  exit /b 1
)
if not exist "%~dp0app\index.html" (
  echo [LOI] Thieu thu muc app. Hay giai nen DAY DU file ZIP, khong chay truc tiep trong ZIP.
  pause
  exit /b 1
)
"%NODE_EXE%" "%~dp0quizforge-server.mjs"
if errorlevel 1 pause
