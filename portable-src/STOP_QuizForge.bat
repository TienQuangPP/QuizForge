@echo off
powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*quizforge-server.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Da tat QuizForge.
timeout /t 2 >nul
