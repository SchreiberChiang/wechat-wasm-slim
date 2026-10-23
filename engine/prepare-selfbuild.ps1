[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WorkDirectory,
    [Parameter(Mandatory)][string]$Emsdk,
    [Parameter(Mandatory)][string]$SconsVenv,
    [string]$SdkNodeRelativePath,
    [string]$SdkPythonRelativePath,
    [string]$SourceRepository = 'https://github.com/citizenll/godot.git',
    [string]$LibraryArchive
)
$ErrorActionPreference = 'Stop'
$pin = 'df3cdd9bc9941a20cb5575d781cde6f937637bcb'
$archiveSha = '7e6dd0b69e097575985265835fdf567895224f8e09c2fe29ba41f987d66bdb5c'
$librarySha = 'c70b6255285aa4e5b987f18cf24d59d56227c67d44d60b734755f33f6a8ab33a'
$url = 'https://game.weixin.qq.com/cgi-bin/gamewxagwasmsplitwap/getunityplugininfo?download=1&biz_id=1&version=0.1.11'
$work = [IO.Path]::GetFullPath($WorkDirectory)
if (Test-Path -LiteralPath $work) { throw 'Preparation requires a new directory; existing evidence is never overwritten.' }
$sdkSource = (Resolve-Path -LiteralPath $Emsdk).Path
$venvSource = (Resolve-Path -LiteralPath $SconsVenv).Path
if ((Get-Content -LiteralPath (Join-Path $sdkSource 'upstream/emscripten/emscripten-version.txt') -Raw).Trim().Trim('"') -ne '4.0.10') { throw 'This recipe requires Emscripten 4.0.10.' }
New-Item -ItemType Directory -Path $work | Out-Null
function Hash([string]$file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
function Git([string[]]$Arguments) { & git.exe @Arguments; if ($LASTEXITCODE -ne 0) { throw 'Git operation failed; retain preparation directory.' } }
$archive = Join-Path $work 'libs_emscriptenglx-0.1.11.zip'
if ($LibraryArchive) { Copy-Item -LiteralPath $LibraryArchive -Destination $archive }
else { Invoke-WebRequest -Uri $url -OutFile $archive }
if ((Hash $archive) -ne $archiveSha) { throw 'Official archive bytes differ from lock; do not continue.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$libraryDir = Join-Path $work 'vendor'
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $prefix = [IO.Path]::GetFullPath($libraryDir) + [IO.Path]::DirectorySeparatorChar
    foreach ($entry in $zip.Entries) {
        $target = [IO.Path]::GetFullPath((Join-Path $libraryDir $entry.FullName))
        if (!$target.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or $entry.FullName -match '(^/|^[A-Za-z]:|\\|:)' -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'Unsafe archive entry.' }
    }
    [IO.Compression.ZipFile]::ExtractToDirectory($archive,$libraryDir)
} finally { $zip.Dispose() }
$libs = @(Get-ChildItem -LiteralPath $libraryDir -Recurse -File -Filter 'libemscriptenglx_4.0.10.a')
if ($libs.Count -ne 1 -or (Hash $libs[0].FullName) -ne $librarySha) { throw 'Pinned library missing or hash mismatch.' }
$source = Join-Path $work 'source'
Git @('init', $source)
Git @('-C', $source, 'config', 'core.autocrlf', 'false')
Git @('-C', $source, 'remote', 'add', 'origin', $SourceRepository)
Git @('-C', $source, 'fetch', '--depth', '1', 'origin', $pin)
Git @('-C', $source, 'checkout', '--detach', 'FETCH_HEAD')
Write-Output 'Copying SDK and SCons environment; original installations remain untouched.'
Copy-Item -LiteralPath $sdkSource -Destination (Join-Path $work 'emsdk') -Recurse
Copy-Item -LiteralPath $venvSource -Destination (Join-Path $work 'venv') -Recurse
# Resolve a single runtime or an explicit relative path; never choose among several installed versions.
$sdk = Join-Path $work 'emsdk'
function RuntimePath([string]$category, [string]$exe, [string]$requested) {
    if ($requested) {
        if ([IO.Path]::IsPathRooted($requested)) { throw 'SDK runtime must be relative to the copied SDK.' }
        $resolved = [IO.Path]::GetFullPath((Join-Path $sdk $requested))
        if (!$resolved.StartsWith($sdk + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'SDK runtime escapes the copied SDK.' }
        $relative = [IO.Path]::GetRelativePath($sdk,$resolved).Replace('\','/')
    } else {
        $candidates = @(Get-ChildItem -LiteralPath (Join-Path $sdk $category) -Directory | ForEach-Object { Join-Path $_.FullName $exe; Join-Path $_.FullName ('bin/' + $exe) } | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
        if ($candidates.Count -ne 1) { throw "Specify the exact $category runtime relative path; found $($candidates.Count) candidates." }
        $relative = [IO.Path]::GetRelativePath($sdk,$candidates[0]).Replace('\','/')
    }
    if (!(Test-Path -LiteralPath (Join-Path $sdk $relative) -PathType Leaf)) { throw "Missing SDK runtime: $relative" }
    return $relative
}
$nodeRelative = RuntimePath 'node' 'node.exe' $SdkNodeRelativePath
$pythonRelative = RuntimePath 'python' 'python.exe' $SdkPythonRelativePath
foreach ($relative in @('upstream/bin/clang.exe','upstream/bin/wasm-ld.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $sdk $relative))) { throw "Missing pinned SDK component: $relative" }
}
$nodeLiteral = ('/' + $nodeRelative) | ConvertTo-Json -Compress
$pythonLiteral = ('/' + $pythonRelative) | ConvertTo-Json -Compress
$config = @"
import os
emsdk_path = os.path.dirname(os.getenv('EM_CONFIG')).replace('\\', '/')
NODE_JS = emsdk_path + $nodeLiteral
PYTHON = emsdk_path + $pythonLiteral
LLVM_ROOT = emsdk_path + '/upstream/bin'
BINARYEN_ROOT = emsdk_path + '/upstream'
EMSCRIPTEN_ROOT = emsdk_path + '/upstream/emscripten'
FROZEN_CACHE = True
"@
[IO.File]::WriteAllText((Join-Path $sdk '.emscripten'),$config,[Text.UTF8Encoding]::new($false))
$toolchain = @{engineSource=$source;pin=$pin;emsdk=$sdk;python=(Join-Path $work 'venv/Scripts/python.exe');patches=@();cppdefines='';lto='thin';glxLibrary=$libs[0].FullName;glxLibrarySha256=$librarySha}
$toolchain | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $work 'toolchain.private.json') -Encoding utf8NoBOM
@{type='build_profile';disabled_classes=@();disabled_build_options=@{}} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $work 'full.gdbuild') -Encoding utf8NoBOM
$inputs = @(foreach ($relative in @('.emscripten','upstream/emscripten/emscripten-version.txt','upstream/emscripten/emcc.py','upstream/bin/clang.exe','upstream/bin/wasm-ld.exe',$nodeRelative,$pythonRelative)) { @{path=$relative;sha256=(Hash (Join-Path $sdk $relative))} })
@{schema='wxslim-selfbuild-preparation-v1';sourceUrl='https://github.com/citizenll/godot.git';sourcePin=$pin;sourceAcquisition=$SourceRepository;library=@{url=$url;archiveSha256=$archiveSha;sha256=$librarySha};sdkInputs=$inputs;startupPatches=@();startupDefines=@();frozenSdkCache=$true;status='prepared-not-built';note='Vendor static library is linked, not rebuilt; this is a compatibility candidate, not a proven black-screen fix.'} | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $work 'PREPARATION.json') -Encoding utf8NoBOM
Write-Output "Prepared $work. Build with the documented trim build command; no phone operation was performed."
