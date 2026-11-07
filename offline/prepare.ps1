[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'prepare.cmd') $Directory
if ($LASTEXITCODE -ne 0) { throw "Offline preparation failed with exit code $LASTEXITCODE." }
