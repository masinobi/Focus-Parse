@echo off
rem Double-click this to read. It builds only when something has changed,
rem serves the production bundle, and opens the browser when the server is
rem actually up. Closing this window stops the server.
rem
rem Named for what it does rather than shortened, because it is meant to be
rem found in a folder listing rather than typed.
title FocusParse - study mode
cd /d "%~dp0"

rem Next prints box-drawing and tick characters, and this script's own output is
rem UTF-8. Without this the window renders them through the OEM codepage and the
rem first thing the reader sees is mojibake: "FocusParse a?" and so on. Measured
rem by running it -- the log file was clean, the console was not.
chcp 65001 >nul

node "scripts\study.mjs"
set EXITCODE=%ERRORLEVEL%

rem Only hold the window open on a real failure. A clean stop (closing the
rem window, or Ctrl+C) should not demand a keypress before it will go away.
if %EXITCODE% NEQ 0 (
  echo.
  echo   Stopped with exit code %EXITCODE%.
  echo.
  pause
)
