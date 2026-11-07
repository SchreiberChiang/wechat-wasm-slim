@echo off
setlocal EnableExtensions DisableDelayedExpansion
if "%~1"=="" goto usage
if not "%~2"=="" goto usage
for %%D in ("%~dp0..") do set "source=%%~fD"
set "out=%~f1"
if exist "%out%" goto invalid
set "ancestor=%out%"
:check_ancestor
if /i "%ancestor%"=="%source%" goto invalid
if not exist "%ancestor%" goto ascend
for %%D in ("%ancestor%") do set "attributes=%%~aD"
if not "%attributes:l=%"=="%attributes%" goto invalid
:ascend
for %%D in ("%ancestor%\..") do set "parent=%%~fD"
if /i "%ancestor%"=="%parent%" goto prepare
set "ancestor=%parent%"
goto check_ancestor

:prepare
mkdir "%out%" || exit /b 1
set "pythonZip=%~dp0platform\python-3.14.0.zip"
"%SystemRoot%\System32\certutil.exe" -hashfile "%pythonZip%" SHA256 > "%out%\bootstrap-hash.txt"
if errorlevel 1 exit /b 1
"%SystemRoot%\System32\findstr.exe" /i /x /c:"649b9528654298354a4fa844e4e9106e23e175f0ddb521d5ffeb8ec664201a1c" "%out%\bootstrap-hash.txt" >nul
if errorlevel 1 goto hash_error
mkdir "%out%\python-3.14.0" || exit /b 1
"%SystemRoot%\System32\tar.exe" -xf "%pythonZip%" -C "%out%\python-3.14.0"
if errorlevel 1 exit /b 1
"%out%\python-3.14.0\python.exe" -I -B "%~dp0prepare.py" "%out%" --bootstrapped
exit /b %errorlevel%

:usage
echo Usage: prepare.cmd NEW_TOOL_DIRECTORY 1>&2
exit /b 2
:invalid
echo Choose a fresh ordinary tool directory outside the source checkout. 1>&2
exit /b 2
:hash_error
echo Bundled Python differs from its locked SHA-256. 1>&2
exit /b 1
