@echo off
setlocal EnableExtensions DisableDelayedExpansion
if not "%~1"=="" exit /b 2
if /i not "%~dp0"=="C:\GLXSource\offline\" goto invalid
if not exist "C:\GLXEvidence\host-canaries.json" goto invalid
if not exist "C:\GLXScratch\." goto invalid
for /f "delims=" %%F in ('dir /a /b "C:\GLXScratch" 2^>nul') do goto invalid
if exist "C:\GLXEvidence\bootstrap.stdout" goto invalid
if exist "C:\GLXEvidence\bootstrap.stderr" goto invalid
call "%~dp0prepare.cmd" "C:\GLXScratch\tools" 1>"C:\GLXEvidence\bootstrap.stdout" 2>"C:\GLXEvidence\bootstrap.stderr"
if errorlevel 1 exit /b 1
"C:\GLXScratch\tools\node.exe" "%~dp0verify-guest.mjs"
exit /b %errorlevel%
:invalid
echo This command needs the isolated guest source, host canary list and an empty guest scratch directory. 1>&2
exit /b 2
