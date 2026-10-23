[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Destination,
    [string]$BootstrapPython = 'C:/Users/赵江/AppData/Local/Python/pythoncore-3.14-64/python.exe',
    [switch]$ResumeFromActivation,
    [switch]$ResumeFromCache,
    [switch]$ValidateFrozenOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$pin = '62a853cd3b3134398ce85cde8bb5cbb2ef0194cb'
$release = '8103ffedfb0c42d231c6af6859a5a1a832260b43'
$root = [IO.Path]::GetFullPath($Destination)
if ($ResumeFromActivation -or $ResumeFromCache) { throw 'Legacy resume disabled: no pre-failure installed-file fingerprint exists. Preserve evidence and use a NEW destination.' }
$resume = $ValidateFrozenOnly
if ((Test-Path -LiteralPath $root) -and !$resume) { throw 'Destination must be NEW; use ValidateFrozenOnly only for a completed frozen baseline.' }
if ($resume -and !(Test-Path -LiteralPath $root)) { throw 'Validation requires an existing completed destination.' }
if (!(Test-Path -LiteralPath $BootstrapPython -PathType Leaf)) { throw 'Explicit bootstrap Python missing.' }
$requirements = Join-Path $PSScriptRoot 'requirements-scons.lock'
if ((Get-Content $requirements -Raw).Trim() -ne 'SCons==4.11.1 --hash=sha256:454cef364348053422696e3d2ecb4fa593c96a624f955842eaaea64f95c8d11d') { throw 'Unexpected SCons lock.' }
if (!$resume) { New-Item -ItemType Directory -Path $root | Out-Null }
$output = if ($ValidateFrozenOnly) { (New-Item -ItemType Directory -Path (Join-Path $root ('attempts/validate-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')))).FullName } else { $root }
$logs = New-Item -ItemType Directory -Path (Join-Path $output 'logs')
$sdk = Join-Path $root 'emsdk'
$venv = Join-Path $root 'venv'
function Sha([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Run([string]$Label, [string]$Exe, [string[]]$Arguments, [int]$TimeoutSeconds = 1800) {
    Write-Output "Running $Label; logs: $($logs.FullName)"
    # ProcessStartInfo.ArgumentList preserves spaces and Unicode without shell expansion.
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Exe
    $info.WorkingDirectory = $root
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($arg in $Arguments) { $info.ArgumentList.Add($arg) }
    foreach ($key in @($info.Environment.Keys)) {
        if ($key -match '^(EM_|EMCC_|EMSDK|EMMAKEN_|BINARYEN_|PYTHONHOME$|PYTHONPATH$|NODE_OPTIONS$|NODE_PATH$)') { $info.Environment.Remove($key) | Out-Null }
    }
    $info.Environment['EMSDK_KEEP_DOWNLOADS'] = '1'
    $info.Environment['EMSDK_NOTTY'] = '1'
    $info.Environment['EMCC_CORES'] = '2'
    $info.Environment['EMSDK_NUM_CORES'] = '2'
    $info.Environment['EMSDK_PYTHON'] = Join-Path $sdk 'python/3.13.3_64bit/python.exe'
    $info.Environment['EMSDK_NODE'] = Join-Path $sdk 'node/22.16.0_64bit/bin/node.exe'
    $info.Environment['EM_CONFIG'] = Join-Path $sdk '.emscripten'
    $info.Environment['EM_CACHE'] = Join-Path $sdk 'upstream/emscripten/cache'
    $info.Environment['PYTHONNOUSERSITE'] = '1'
    $info.Environment['PYTHONUTF8'] = '1'
    $info.Environment['PYTHONDONTWRITEBYTECODE'] = '1'
    $proc = [Diagnostics.Process]::new()
    $proc.StartInfo = $info
    if (!$proc.Start()) { throw "Could not start $Label" }
    $outTask = $proc.StandardOutput.ReadToEndAsync()
    $errTask = $proc.StandardError.ReadToEndAsync()
    $finished = $proc.WaitForExit($TimeoutSeconds * 1000)
    if (!$finished) { $proc.Kill($true); $proc.WaitForExit() }
    [IO.File]::WriteAllText((Join-Path $logs "$Label.stdout.log"),$outTask.GetAwaiter().GetResult())
    [IO.File]::WriteAllText((Join-Path $logs "$Label.stderr.log"),$errTask.GetAwaiter().GetResult())
    if (!$finished -or $proc.ExitCode -ne 0) { throw "$Label failed or timed out; preserve destination and inspect logs." }
}
$currentStatus = Join-Path $root 'CURRENT-STATUS.json'
function RecordStatus([hashtable]$Record) {
    $json = $Record | ConvertTo-Json
    $json | Set-Content (Join-Path $output 'STATUS.json') -Encoding utf8NoBOM
    $json | Set-Content $currentStatus -Encoding utf8NoBOM
}
RecordStatus @{status='in-progress';attemptDirectory=$output;startedUtc=[DateTime]::UtcNow.ToString('o')}
try {
if (!$resume) {
Run 'git-init' 'git.exe' @('init',$sdk)
Run 'git-remote' 'git.exe' @('-C',$sdk,'remote','add','origin','https://github.com/emscripten-core/emsdk.git')
Run 'git-fetch' 'git.exe' @('-C',$sdk,'fetch','--depth','1','origin',$pin) 300
Run 'git-checkout' 'git.exe' @('-C',$sdk,'checkout','--detach','FETCH_HEAD')
} else {
    Run 'resume-git-pin' 'git.exe' @('-C',$sdk,'rev-parse','HEAD')
    if ((Get-Content (Join-Path $logs 'resume-git-pin.stdout.log') -Raw).Trim() -ne $pin) { throw 'Resume SDK commit mismatch.' }
    if ((Get-Content (Join-Path $sdk 'upstream/emscripten/emscripten-version.txt') -Raw).Trim().Trim('"') -ne '4.0.10') { throw 'Resume installed SDK version mismatch.' }
    Run 'tracked-sdk-status' 'git.exe' @('-C',$sdk,'status','--porcelain','--untracked-files=no')
    if (![string]::IsNullOrWhiteSpace([IO.File]::ReadAllText((Join-Path $logs 'tracked-sdk-status.stdout.log')))) { throw 'SDK tracked files are not clean.' }
    $baseline = Get-Content (Join-Path $root 'TOOLCHAIN.json') -Raw | ConvertFrom-Json
    if ($baseline.status -ne 'frozen-probe-link-pass' -or !$baseline.frozenCache) { throw 'Validation requires completed frozen baseline.' }
    if ($baseline.emsdkCommit -ne $pin -or $baseline.release -ne $release -or $baseline.sdkInputs.Count -ne 10 -or $baseline.thinLtoCache.Count -ne 10) { throw 'Completed baseline does not match this pinned recipe.' }
    foreach ($entry in $baseline.sdkInputs) { if ((Sha (Join-Path $sdk $entry.path)) -ne $entry.sha256) { throw "Installed SDK baseline changed: $($entry.path)" } }
    $cacheDirectory = Join-Path $sdk 'upstream/emscripten/cache/sysroot/lib/wasm32-emscripten/thinlto'
    if (@(Get-ChildItem $cacheDirectory -Filter '*.a').Count -ne $baseline.thinLtoCache.Count) { throw 'Cache archive set differs from baseline.' }
    foreach ($entry in $baseline.thinLtoCache) { if ((Sha (Join-Path $cacheDirectory $entry.file)) -ne $entry.sha256) { throw "Cache baseline changed: $($entry.file)" } }
    if ((Sha (Join-Path $root 'probe.wasm')) -ne $baseline.probeWasmSha256) { throw 'Original probe differs from baseline.' }
    $snapshot = New-Item -ItemType Directory -Path (Join-Path $output 'prior-success-snapshot')
    foreach ($name in @('probe.cpp','probe.js','probe.wasm','TOOLCHAIN.json','DOWNLOADS.lock.json')) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $snapshot.FullName }
    Copy-Item -LiteralPath (Join-Path $sdk '.emscripten') -Destination (Join-Path $snapshot '.emscripten')
    @{previousMetadataSha256=(Sha (Join-Path $root 'TOOLCHAIN.json'));previousProbeWasmSha256=$baseline.probeWasmSha256;snapshot=$snapshot.FullName} | ConvertTo-Json | Set-Content (Join-Path $output 'PREVIOUS.json') -Encoding utf8NoBOM
}
$tags = Get-Content (Join-Path $sdk 'emscripten-releases-tags.json') -Raw | ConvertFrom-Json
if ($tags.releases.'4.0.10' -ne $release) { throw 'Pinned release mapping mismatch.' }
# Pre-download exactly the three official SDK archives with finite network timeouts.
# KEEP_DOWNLOADS makes emsdk reuse and retain these archives for hash evidence.
$downloads = if ($resume) { Get-Item (Join-Path $sdk 'downloads') } else { New-Item -ItemType Directory -Path (Join-Path $sdk 'downloads') }
$sources = @(
    @{file='python-3.13.3-0-win-amd64.zip';url='https://storage.googleapis.com/webassembly/emscripten-releases-builds/deps/python-3.13.3-0-win-amd64.zip';expectedSha256='6fe7a540c6b8b185780467cf7495e884ee62316ec4abb19e1c735b8a77c62465'},
    @{file='node-v22.16.0-win-x64.zip';url='https://storage.googleapis.com/webassembly/emscripten-releases-builds/deps/node-v22.16.0-win-x64.zip';expectedSha256='c2d6eb9645ffaa3d95665a3cfad49ab206e3cac26099ec23f5d17738abd01c40'},
    @{file="$release-wasm-binaries.zip";url="https://storage.googleapis.com/webassembly/emscripten-releases-builds/win/$release/wasm-binaries.zip";expectedSha256='1a66825e85fda039f57d39c98ae2bdb96a18e53745159e9599f69679be18439f'}
)
foreach ($item in $sources) {
    $path = Join-Path $downloads $item.file
    if (!$resume) {
        Write-Output "Downloading official archive $($item.file)"
        Invoke-WebRequest -Uri $item.url -OutFile $path -TimeoutSec 1200 -MaximumRetryCount 1
    }
    $item.sha256 = Sha $path
    $item.bytes = (Get-Item $path).Length
    if ($item.sha256 -ne $item.expectedSha256) { throw "SDK archive differs from recorded acquisition lock: $($item.file)" }
}
if (!$resume) {
    $sources | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'DOWNLOADS.lock.json') -Encoding utf8NoBOM
    Run 'emsdk-install' $BootstrapPython @((Join-Path $sdk 'emsdk.py'),'install','4.0.10')
}
$python = Join-Path $sdk 'python/3.13.3_64bit/python.exe'
$node = Join-Path $sdk 'node/22.16.0_64bit/bin/node.exe'
$venvPython = Join-Path $venv 'Scripts/python.exe'
if (!$ValidateFrozenOnly) {
Run 'emsdk-activate' $BootstrapPython @((Join-Path $sdk 'emsdk.py'),'activate','4.0.10')
Run 'create-venv' $python @('-m','venv',$venv)
$wheels = New-Item -ItemType Directory -Path (Join-Path $root 'wheels')
Copy-Item -LiteralPath $requirements -Destination (Join-Path $root 'requirements-scons.lock')
Run 'scons-download' $venvPython @('-m','pip','download','--index-url','https://pypi.org/simple','--timeout','120','--retries','1','--only-binary=:all:','--no-deps','--require-hashes','-r',$requirements,'-d',$wheels.FullName) 300
Run 'scons-install' $venvPython @('-m','pip','install','--no-index','--find-links',$wheels.FullName,'--no-deps','--require-hashes','-r',$requirements)
} else {
    $wheel = @(Get-ChildItem (Join-Path $root 'wheels') -Filter '*.whl')
    if ($wheel.Count -ne 1 -or (Sha $wheel[0].FullName) -ne '454cef364348053422696e3d2ecb4fa593c96a624f955842eaaea64f95c8d11d') { throw 'Resume SCons wheel lock mismatch.' }
    Run 'resume-venv-base' $venvPython @('-c',"import sys; assert sys.base_prefix.lower() == r'$([IO.Path]::GetDirectoryName($python))'.lower(); import SCons; assert SCons.__version__ == '4.11.1'")
}
function Configure([bool]$Frozen) {
    $literal = if ($Frozen) { 'True' } else { 'False' }
    $config = @"
import os
emsdk_path = os.path.dirname(os.environ['EM_CONFIG']).replace('\\', '/')
NODE_JS = emsdk_path + '/node/22.16.0_64bit/bin/node.exe'
PYTHON = emsdk_path + '/python/3.13.3_64bit/python.exe'
LLVM_ROOT = emsdk_path + '/upstream/bin'
BINARYEN_ROOT = emsdk_path + '/upstream'
EMSCRIPTEN_ROOT = emsdk_path + '/upstream/emscripten'
FROZEN_CACHE = $literal
"@
    [IO.File]::WriteAllText((Join-Path $sdk '.emscripten'),$config,[Text.UTF8Encoding]::new($false))
}
$emscripten = Join-Path $sdk 'upstream/emscripten'
$targets = @('libal','libc','libc++','libc++abi','libcompiler_rt','libdlmalloc','libGL-webgl2','libhtml5','libsockets','libstubs')
if (!$ValidateFrozenOnly) {
Configure $false
Run 'embuilder-help' $python @((Join-Path $emscripten 'embuilder.py'),'--help')
$help = Get-Content (Join-Path $logs 'embuilder-help.stdout.log') -Raw
foreach ($target in $targets) { if ($help -notmatch ('(?m)^\s+' + [regex]::Escape($target) + '\s*$')) { throw "Target absent from embuilder help: $target" } }
Run 'embuilder-thin' $python (@((Join-Path $emscripten 'embuilder.py'),'--lto=thin','build') + $targets)
Configure $true
} elseif ((Get-Content (Join-Path $sdk '.emscripten') -Raw) -notmatch '(?m)^FROZEN_CACHE = True\s*$') { throw 'Validation requires an already frozen config.' }
$probe = Join-Path $output 'probe.cpp'
@'
#include <vector>
#include <stdexcept>
#include <GLES3/gl3.h>
#include <AL/al.h>
#include <emscripten/html5.h>
#include <sys/socket.h>
int main(int argc, char**) {
  std::vector<int> values(2, argc);
  try { if (argc > 100) throw std::runtime_error("probe"); } catch (...) { return 2; }
  if (argc > 50) { glClear(GL_COLOR_BUFFER_BIT); alGetError(); emscripten_get_now(); socket(AF_INET, SOCK_STREAM, 0); }
  return values[0];
}
'@ | Set-Content $probe -Encoding utf8NoBOM
Run 'frozen-probe-link' $python @((Join-Path $emscripten 'em++.py'),$probe,'-O2','-flto=thin','-fexceptions','-sMAX_WEBGL_VERSION=2','-sGL_ENABLE_GET_PROC_ADDRESS=0','-sINITIAL_MEMORY=33554432','-sSTACK_SIZE=5242880','-sEXIT_RUNTIME=1','-o',(Join-Path $output 'probe.js'))
Run 'emcc-version' $python @((Join-Path $emscripten 'emcc.py'),'--version')
Run 'node-version' $node @('--version')
Run 'python-version' $python @('--version')
Run 'scons-version' $venvPython @('-m','SCons','--version')
$keys = @('emsdk.py','emsdk_manifest.json','emscripten-releases-tags.json','.emscripten','upstream/emscripten/emscripten-version.txt','upstream/emscripten/emcc.py','upstream/bin/clang.exe','upstream/bin/wasm-ld.exe','node/22.16.0_64bit/bin/node.exe','python/3.13.3_64bit/python.exe')
$inputs = @(foreach ($relative in $keys) { @{path=$relative;sha256=(Sha (Join-Path $sdk $relative))} })
$cache = @(Get-ChildItem (Join-Path $emscripten 'cache/sysroot/lib/wasm32-emscripten/thinlto') -Filter '*.a' | ForEach-Object { @{file=$_.Name;sha256=(Sha $_.FullName)} })
if ($ValidateFrozenOnly) {
    if (@(Get-ChildItem $cacheDirectory -Filter '*.a').Count -ne $baseline.thinLtoCache.Count) { throw 'Cache archive set changed during frozen validation.' }
    foreach ($entry in $baseline.sdkInputs) { if ((Sha (Join-Path $sdk $entry.path)) -ne $entry.sha256) { throw 'SDK changed during frozen validation.' } }
    foreach ($entry in $baseline.thinLtoCache) { if ((Sha (Join-Path $cacheDirectory $entry.file)) -ne $entry.sha256) { throw 'Cache changed during frozen validation.' } }
}
@{schema='wxslim-public-toolchain-v1';emsdkRepository='https://github.com/emscripten-core/emsdk.git';emsdkCommit=$pin;emscriptenVersion='4.0.10';release=$release;downloads=$sources;sdkInputs=$inputs;thinLtoCache=$cache;cacheTargets=$targets;frozenCache=$true;probeStackSizeBytes=5242880;probeInitialMemoryBytes=33554432;probeExitRuntime=1;probeWasmSha256=(Sha (Join-Path $output 'probe.wasm'));probeExecuted=$false;sconsWheelSha256='454cef364348053422696e3d2ecb4fa593c96a624f955842eaaea64f95c8d11d';venvBase=$python;status='frozen-probe-link-pass';previousMetadata=$(if ($ValidateFrozenOnly) { Join-Path $output 'PREVIOUS.json' } else { $null })} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $output 'TOOLCHAIN.json') -Encoding utf8NoBOM
RecordStatus @{status='frozen-probe-link-pass';attemptDirectory=$output;metadata=(Join-Path $output 'TOOLCHAIN.json');metadataSha256=(Sha (Join-Path $output 'TOOLCHAIN.json'));completedUtc=[DateTime]::UtcNow.ToString('o')}
Write-Output "Fresh public toolchain verified: $output. Probe linked only; no WASM execution or engine/phone acceptance."
} catch {
    RecordStatus @{status='failed';attemptDirectory=$output;failedUtc=[DateTime]::UtcNow.ToString('o');message=$_.Exception.Message}
    throw
}
