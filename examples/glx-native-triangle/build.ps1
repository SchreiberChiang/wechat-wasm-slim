param(
    [Parameter(Mandatory)][string]$Emsdk,
    [Parameter(Mandatory)][string]$GlxLibrary,
    [Parameter(Mandatory)][string]$ContextPatch,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$SourceFile,
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
$sourcePath = if ($SourceFile) { (Resolve-Path -LiteralPath $SourceFile).Path } else { Join-Path $PSScriptRoot 'main.cpp' }
if (!(Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw 'C++ source file is missing' }
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $outputPath) { throw 'Output directory already exists; choose a fresh path' }
New-Item -ItemType Directory -Path $outputPath | Out-Null
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
    # Match the audited full baseline's size optimization/thin LTO library variant.
    $sourcePath, $libraryPath, '-Os', '-flto=thin', '-Wl,--thinlto-jobs=1', '-std=c++17', '-fexceptions',
    '-sSUPPORT_LONGJMP=emscripten', '-sCHECK_NULL_WRITES=0',
    '-sMIN_WEBGL_VERSION=2', '-sMAX_WEBGL_VERSION=2', '-sOFFSCREEN_FRAMEBUFFER=0',
    # Matches the full baseline's detect.py:352 and provenance tmp0ro2obs8.lnk.
    # main.cpp/strict-post.js do not use emscripten_webgl_get_proc_address.
    '-sGL_ENABLE_GET_PROC_ADDRESS=0',
    # Match Godot detect.py:441 / audited tmp0ro2obs8.lnk. The Safari shim
    # references browser WebGLRenderingContext, absent in the WeChat GLX host.
    '-sGL_WORKAROUND_SAFARI_GETCONTEXT_BUG=0',
    # The baseline uses EXIT_RUNTIME=1; main keeps the runtime alive with its
    # emscripten_set_main_loop(..., true), rather than relying on a natural return.
    '-sEXIT_RUNTIME=1', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432',
    '-sEXPORTED_FUNCTIONS=["_main","_malloc","_free","_glxInit","_glxInitBufferDataAndGlState","_glxUpdateContextId","_glxCommandBufferFlush"]',
    '-sEXPORTED_RUNTIME_METHODS=["ccall","cwrap","stringToUTF8","lengthBytesUTF8"]',
    '--post-js', $patchPath, '--post-js', (Join-Path $PSScriptRoot 'strict-post.js'),
    '-o', (Join-Path $outputPath 'triangle.js')
)
$manifest = [ordered]@{
    status = 'recipe-only'; emscripten = '4.0.10'; glxVersionLabel = '0.1.11';
    sdk = $sdkPath; library = $libraryPath; librarySha256 = $expectedLibrary;
    contextPatch = $patchPath; contextPatchSha256 = $expectedPatch;
    recipeSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant();
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
function Invoke-IsolatedCompiler([string[]]$CompilerArguments) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $python
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in (@('-B', '-E', $emcc) + $CompilerArguments)) { $start.ArgumentList.Add($argument) }
    # Remove child keys explicitly: PowerShell/.NET null assignments may leave empty
    # environment entries, which Emscripten 4.0.10 cannot validate as paths.
    foreach ($name in $configOverrides) { [void]$start.Environment.Remove($name) }
    $start.Environment['EM_CONFIG'] = $privateConfig
    $start.Environment['EM_CACHE'] = $cachePath
    $start.Environment['EMCC_TEMP_DIR'] = $tempPath
    $start.Environment['TEMP'] = $tempPath
    $start.Environment['TMP'] = $tempPath
    $start.Environment['PYTHONDONTWRITEBYTECODE'] = '1'
    $start.Environment['EMCC_CORES'] = '1'
    $start.Environment['BINARYEN_CORES'] = '1'
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        [void]$process.Start()
        # Drain both pipes concurrently to avoid deadlock on compiler diagnostics.
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        return @{ ExitCode = $process.ExitCode; Output = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult() }
    } finally { $process.Dispose() }
}
# em++.bat uses Python -E, which ignores PYTHONDONTWRITEBYTECODE and
# selects Python through ambient state. Pin it and disable bytecode explicitly.
$version = Invoke-IsolatedCompiler -CompilerArguments @('--version')
$version.Output | Set-Content -LiteralPath (Join-Path $outputPath 'compiler-version.txt')
if ($version.ExitCode -ne 0 -or $version.Output -notmatch 'emcc.*4\.0\.10') { throw 'Compiler version check failed' }
$compiled = Invoke-IsolatedCompiler -CompilerArguments $argsList
$compiled.Output | Tee-Object -FilePath (Join-Path $outputPath 'compile.log')
if ($compiled.ExitCode -ne 0) { throw 'Compile/link failed; retain output and logs' }
$manifest.status = 'compiled-not-run'
$manifest.outputs = @(Get-ChildItem -LiteralPath $outputPath -File | Where-Object { $_.Extension -in '.js', '.wasm' } | ForEach-Object {
    @{ name = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
})
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $outputPath 'BUILD.json') -Encoding utf8
