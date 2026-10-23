param(
    [Parameter(Mandatory)][string]$Emsdk,
    [Parameter(Mandatory)][string]$GlxLibrary,
    [Parameter(Mandatory)][string]$ContextPatch,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [switch]$Build
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Validate every external input before creating output or invoking a compiler.
$sdkPath = (Resolve-Path -LiteralPath $Emsdk).Path
$libraryPath = (Resolve-Path -LiteralPath $GlxLibrary).Path
$patchPath = (Resolve-Path -LiteralPath $ContextPatch).Path
$emcc = Join-Path $sdkPath 'upstream/emscripten/em++.py'
$python = Join-Path $sdkPath 'python/3.13.3_64bit/python.exe'
$node = Join-Path $sdkPath 'node/24.19.0_64bit/node.exe'
$configPath = Join-Path $sdkPath '.emscripten'
$expectedLibrary = 'c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a'
$expectedPatch = '7f08edb7d3e7f3badc6c8b520b12c7424a9e52b223407ded92ae8f700bc01a0e'
if ((Get-FileHash -LiteralPath $libraryPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedLibrary) { throw 'GLX library SHA256 mismatch' }
if ((Get-FileHash -LiteralPath $patchPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedPatch) { throw 'Context patch SHA256 mismatch' }
if (!(Test-Path -LiteralPath $emcc) -or !(Test-Path -LiteralPath $configPath) -or !(Test-Path -LiteralPath $python) -or !(Test-Path -LiteralPath $node)) { throw 'Explicit SDK is incomplete' }
$versionFile = Join-Path $sdkPath 'upstream/emscripten/emscripten-version.txt'
if ((Get-Content -LiteralPath $versionFile -Raw).Trim().Trim('"') -ne '4.0.10') { throw 'Requires Emscripten 4.0.10' }
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $outputPath) { throw 'Output directory already exists; choose a fresh path' }
New-Item -ItemType Directory -Path $outputPath | Out-Null
$sourcePath = Join-Path $PSScriptRoot 'main.cpp'
# Freeze a copied cache so a missing library fails instead of building system libraries.
# The SDK cache is read only; the full-engine build uses its separate EM_CACHE.
$cachePath = Join-Path $outputPath 'cache'
$tempPath = Join-Path $outputPath 'tmp'
$privateConfig = Join-Path $outputPath 'emscripten.config'
$sdkForPython = $sdkPath.Replace('\', '/')
$privateConfigText = @"
NODE_JS = '$sdkForPython/node/24.19.0_64bit/node.exe'
LLVM_ROOT = '$sdkForPython/upstream/bin'
BINARYEN_ROOT = '$sdkForPython/upstream'
EMSCRIPTEN_ROOT = '$sdkForPython/upstream/emscripten'
FROZEN_CACHE = True
"@
[IO.File]::WriteAllText($privateConfig, $privateConfigText, [Text.UTF8Encoding]::new($false))
$argsList = @(
    $sourcePath, $libraryPath, '-O2', '-std=c++17', '-fexceptions',
    '-sSUPPORT_LONGJMP=emscripten', '-sCHECK_NULL_WRITES=0',
    '-sMIN_WEBGL_VERSION=2', '-sMAX_WEBGL_VERSION=2', '-sOFFSCREEN_FRAMEBUFFER=0',
    '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432',
    '-sEXPORTED_FUNCTIONS=["_main","_malloc","_free","_glxInit","_glxInitBufferDataAndGlState","_glxUpdateContextId","_glxCommandBufferFlush"]',
    '-sEXPORTED_RUNTIME_METHODS=["ccall","cwrap","stringToUTF8","lengthBytesUTF8"]',
    '--post-js', $patchPath, '--post-js', (Join-Path $PSScriptRoot 'strict-post.js'),
    '-o', (Join-Path $outputPath 'triangle.js')
)
$manifest = [ordered]@{
    status = 'recipe-only'; emscripten = '4.0.10'; glxVersionLabel = '0.1.11';
    sdk = $sdkPath; library = $libraryPath; librarySha256 = $expectedLibrary;
    contextPatch = $patchPath; contextPatchSha256 = $expectedPatch;
    sourceSha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant();
    strictPostSha256 = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'strict-post.js') -Algorithm SHA256).Hash.ToLowerInvariant();
    interpreter = $python; interpreterArguments = @('-B', '-E'); compiler = $emcc; arguments = $argsList; cache = $cachePath;
    wxHostAdaptation = 'NOT_IMPLEMENTED'; deviceValidation = 'NOT_RUN'
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputPath 'BUILD.json') -Encoding utf8
if (!$Build) { Write-Output "Validated pinned inputs; recipe saved in $outputPath/BUILD.json. No compilation requested."; return }
Copy-Item -LiteralPath (Join-Path $sdkPath 'upstream/emscripten/cache') -Destination $cachePath -Recurse
New-Item -ItemType Directory -Path $tempPath | Out-Null
$configOverrides = @('EM_FROZEN_CACHE', 'EM_LLVM_ROOT', 'EM_BINARYEN_ROOT', 'EM_NODE_JS', 'EM_LLVM_ADD_VERSION', 'EM_CLANG_ADD_VERSION', 'EM_COMPILER_WRAPPER', 'EM_PORTS')
$names = @('EM_CONFIG', 'EM_CACHE', 'EMCC_TEMP_DIR', 'TEMP', 'TMP', 'PYTHONDONTWRITEBYTECODE', 'EMCC_CORES', 'BINARYEN_CORES') + $configOverrides
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    # Emscripten gives these variables priority over the private config.
    foreach ($name in $configOverrides) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    $env:EM_CONFIG = $privateConfig; $env:EM_CACHE = $cachePath
    $env:EMCC_TEMP_DIR = $tempPath; $env:TEMP = $tempPath; $env:TMP = $tempPath
    $env:PYTHONDONTWRITEBYTECODE = '1'; $env:EMCC_CORES = '1'; $env:BINARYEN_CORES = '1'
    # em++.bat uses Python -E, which ignores PYTHONDONTWRITEBYTECODE and
    # selects Python through ambient state. Pin it and disable bytecode explicitly.
    $versionOutput = & $python -B -E $emcc --version 2>&1
    $versionOutput | Set-Content -LiteralPath (Join-Path $outputPath 'compiler-version.txt')
    if ($LASTEXITCODE -ne 0 -or ($versionOutput -join "`n") -notmatch 'emcc.*4\.0\.10') { throw 'Compiler version check failed' }
    & $python -B -E $emcc @argsList 2>&1 | Tee-Object -FilePath (Join-Path $outputPath 'compile.log')
    if ($LASTEXITCODE -ne 0) { throw 'Compile/link failed; retain output and logs' }
    $manifest.status = 'compiled-not-run'
    $manifest.outputs = @(Get-ChildItem -LiteralPath $outputPath -File | Where-Object { $_.Extension -in '.js', '.wasm' } | ForEach-Object {
        @{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
    })
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputPath 'BUILD.json') -Encoding utf8
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
}
