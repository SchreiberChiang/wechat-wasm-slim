[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$state = [IO.Path]::GetFullPath($Directory)
$source = [IO.Directory]::GetParent($PSScriptRoot).FullName
if ($state.StartsWith($source.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or $state -eq $source) {
    throw 'Choose a fresh working directory outside the source checkout.'
}
if (Test-Path -LiteralPath $state) { throw 'Offline tool directory must be fresh.' }
$null = New-Item -ItemType Directory -Path $state
$platform = Get-Content -Encoding UTF8 -Raw -LiteralPath (Join-Path $PSScriptRoot 'platform/platform.json') | ConvertFrom-Json
$inputs = Get-Content -Encoding UTF8 -Raw -LiteralPath (Join-Path $PSScriptRoot 'inputs.json') | ConvertFrom-Json
function Assert-File($File, $Pin) {
    if ((Get-Item -LiteralPath $File).Length -ne $Pin.bytes -or (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Pin.sha256) {
        throw "File differs from its source manifest: $File"
    }
}
foreach ($item in $inputs.files.PSObject.Properties) {
    Assert-File (Join-Path $PSScriptRoot $item.Name) $item.Value
}
foreach ($item in $platform.PSObject.Properties) {
    $file = Join-Path $PSScriptRoot ('platform/' + $item.Name)
    Assert-File $file $item.Value
    [IO.Compression.ZipFile]::ExtractToDirectory($file,(Join-Path $state ([IO.Path]::GetFileNameWithoutExtension($item.Name))))
}
$nodeZip = Join-Path $PSScriptRoot 'downloads/node-v24.18.0-win-x64.zip'
$zip = [IO.Compression.ZipFile]::OpenRead($nodeZip)
try {
    $entry = $zip.GetEntry('node-v24.18.0-win-x64/node.exe')
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $state 'node.exe'))
} finally { $zip.Dispose() }
$python = Join-Path $state 'python-3.14.0/python.exe'
$git = Join-Path $state 'git-windows/mingw64/bin/git.exe'
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_CONFIG_GLOBAL = 'NUL'
$env:PYTHONDONTWRITEBYTECODE = '1'
& $python -I -B -m venv --without-pip (Join-Path $state 'venv')
if ($LASTEXITCODE) { throw 'Portable Python venv creation failed.' }
function Initialize-SourcePack($Name, $Commit, $PackId) {
    $repo = Join-Path $state ($Name + '.git')
    & $git init --bare --initial-branch=main $repo
    if ($LASTEXITCODE) { throw "Could not initialize $Name." }
    $pack = Join-Path $repo ("objects/pack/pack-$PackId.pack")
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot ("upstream/$Name.pack")) -Destination $pack
    & $git -C $repo index-pack $pack
    if ($LASTEXITCODE) { throw "Invalid source pack for $Name." }
    [IO.File]::WriteAllText((Join-Path $repo 'shallow'),$Commit + [char]10,[Text.Encoding]::ASCII)
    & $git -C $repo update-ref refs/heads/main $Commit
    if ($LASTEXITCODE) { throw "Pinned $Name commit missing." }
    & $git -C $repo fsck --full --strict
    if ($LASTEXITCODE) { throw "Incomplete source objects for $Name." }
}
Initialize-SourcePack 'c050' 'c050c09b105c3715e1caa57a7109cd752047fd89' 'd4e5a39168f7a49bf54a67fafa6ad2ae58b44c1d'
Initialize-SourcePack 'df3' 'df3cdd9bc9941a20cb5575d781cde6f937637bcb' 'a465e77ddd3bb290a6749b57e6d75e75a2c866ea'
$request = @{gitExecutable=$git;upstreamSource=(Join-Path $PSScriptRoot 'upstream/library_godot_memfs.js')}
[IO.File]::WriteAllText((Join-Path $state 'source-request.json'),($request | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Write-Output "Offline tools and verified Godot source are ready in $state."
