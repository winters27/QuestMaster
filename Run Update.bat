@echo off
:: ============================================================================
:: QuestMaster Vencord Plugin Updater
:: Double-click this file to update the plugin
:: ============================================================================

title QuestMaster Plugin Updater

echo ============================================
echo    QuestMaster Vencord Plugin Updater
echo ============================================
echo.

:: Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

:: Check if the PowerShell script exists
if not exist "%SCRIPT_DIR%_update-script.ps1" (
    echo [ERROR] _update-script.ps1 not found in %SCRIPT_DIR%
    echo Please ensure _update-script.ps1 is in the same folder as this batch file.
    pause
    exit /b 1
)

:: Check if PowerShell Core (pwsh) is available, otherwise use Windows PowerShell
where pwsh >nul 2>&1
if %errorlevel% equ 0 (
    echo Using PowerShell Core...
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%_update-script.ps1"
) else (
    echo Using Windows PowerShell...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%_update-script.ps1"
)

:: Always pause so user can see output
echo.
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Script exited with error code: %errorlevel%
)
echo.
pause
