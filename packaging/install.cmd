@echo off
rem Double-click to install the WeChat export plugin into a Godot game.
powershell -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0install.ps1" %*
if errorlevel 2 pause
