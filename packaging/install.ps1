# 双击「双击安装.cmd」运行：选游戏文件夹，自动找 Godot 4.7.2，安装或升级插件并启用。
# 命令行测试：install.ps1 -Game 游戏目录 -Godot 编辑器 -Quiet
param([string]$Game = '', [string]$Godot = '', [switch]$Quiet)
$ErrorActionPreference = 'Stop'
$release = $PSScriptRoot
$title = '微信导出插件安装'
Add-Type -AssemblyName System.Windows.Forms

function Say([string]$text, [string]$kind = 'Information') {
  if ($Quiet) { Write-Output $text; return }
  [void][System.Windows.Forms.MessageBox]::Show($text, $title, 'OK', $kind)
}
function Ask([string]$text) {
  if ($Quiet) { return $true }
  return [System.Windows.Forms.MessageBox]::Show($text, $title, 'YesNo', 'Question') -eq 'Yes'
}
function Stop-With([string]$text, [int]$code = 1) { Say $text 'Warning'; exit $code }

# 1. Node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Stop-With "没有找到 Node.js。请先安装 Node.js 24（https://nodejs.org），装好后重新双击安装。" }

# 2. 游戏文件夹
if (-not $Game) {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = '选择 Godot 游戏工程文件夹（里面有 project.godot）'
  while ($true) {
    if ($dialog.ShowDialog() -ne 'OK') { exit 0 }
    if (Test-Path -LiteralPath (Join-Path $dialog.SelectedPath 'project.godot')) { $Game = $dialog.SelectedPath; break }
    Say "这个文件夹里没有 project.godot，请选 Godot 游戏工程的根目录。" 'Warning'
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $Game 'project.godot'))) { Stop-With "不是 Godot 游戏工程：$Game" }

# 3. Godot 4.7.2 编辑器
$remember = Join-Path $env:LOCALAPPDATA 'Godot\WxSlim\godot-editor.txt'
function Test-Godot([string]$exe) {
  if (-not $exe -or -not (Test-Path -LiteralPath $exe -PathType Leaf)) { return $false }
  try { return ((& $exe --version 2>$null | Out-String) -match '(?m)^4\.7\.2\.') } catch { return $false }
}
if (-not $Godot) {
  $candidates = [System.Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $remember) { $candidates.Add((Get-Content -LiteralPath $remember -Raw).Trim()) }
  $pointer = Join-Path $Game '.godot\wxslim\state.path'
  if (Test-Path -LiteralPath $pointer) {
    $cfg = Join-Path ((Get-Content -LiteralPath $pointer -Raw).Trim()) 'local-config.json'
    if (Test-Path -LiteralPath $cfg) { try { $candidates.Add((Get-Content -LiteralPath $cfg -Raw -Encoding UTF8 | ConvertFrom-Json).editorExecutable) } catch {} }
  }
  $steamRoots = @("${env:ProgramFiles(x86)}\Steam", "$env:ProgramFiles\Steam")
  foreach ($root in $steamRoots) {
    $vdf = Join-Path $root 'steamapps\libraryfolders.vdf'
    $libs = @($root)
    if (Test-Path -LiteralPath $vdf) { $libs += (Select-String -LiteralPath $vdf -Pattern '"path"\s+"([^"]+)"' -AllMatches).Matches | ForEach-Object { $_.Groups[1].Value -replace '\\\\', '\' } }
    foreach ($lib in $libs) { $candidates.Add((Join-Path $lib 'steamapps\common\Godot Engine\godot.windows.opt.tools.64.exe')) }
  }
  foreach ($drive in (Get-PSDrive -PSProvider FileSystem).Root) {
    $candidates.Add((Join-Path $drive 'SteamLibrary\steamapps\common\Godot Engine\godot.windows.opt.tools.64.exe'))
  }
  Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\GodotEngine*\*.exe') -ErrorAction SilentlyContinue | ForEach-Object { $candidates.Add($_.FullName) }
  $Godot = $candidates | Where-Object { $_ } | Select-Object -Unique | Where-Object { Test-Godot $_ } | Select-Object -First 1
  if (-not $Godot -and -not $Quiet) {
    Say "没有自动找到 Godot 4.7.2，请手动选择 Godot 编辑器程序（.exe）。"
    $open = New-Object System.Windows.Forms.OpenFileDialog
    $open.Filter = 'Godot 编辑器 (*.exe)|*.exe'
    $open.Title = '选择 Godot 4.7.2 编辑器'
    while ($true) {
      if ($open.ShowDialog() -ne 'OK') { exit 0 }
      if (Test-Godot $open.FileName) { $Godot = $open.FileName; break }
      Say "这个程序不是 Godot 4.7.2，请重新选择。" 'Warning'
    }
  }
}
if (-not (Test-Godot $Godot)) { Stop-With "需要 Godot 4.7.2 编辑器，没有找到可用的：$Godot" }

# 4. Godot 正在运行时，编辑器可能会覆盖安装写入的工程设置
if (Get-Process -Name 'godot*' -ErrorAction SilentlyContinue) {
  if (-not (Ask "检测到 Godot 正在运行。请先关闭正在编辑这个游戏的 Godot 窗口，再点「是」继续安装。`n点「否」取消。")) { exit 0 }
}

# 5. 安装或升级，并启用插件
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$output = & $node.Source (Join-Path $release 'install.mjs') $Game $Godot '--update' 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  if ($output -match 'Existing addon differs') {
    Stop-With "游戏里已有一份不是由安装程序装的插件（addons\wxslim_readonly），或者被手动改过。`n请先把这个文件夹删掉或移走，再重新安装。" 2
  }
  Stop-With "安装失败：`n`n$($output.Trim())" 2
}
New-Item -ItemType Directory -Force -Path (Split-Path $remember) | Out-Null
Set-Content -LiteralPath $remember -Value $Godot -Encoding UTF8
$result = ($output.Trim() -split "`r?`n")[-1] | ConvertFrom-Json
$what = if ($result.alreadyInstalled) { '插件已经是这个版本，无需更新。' } elseif ($result.previousAddon) { '插件已升级到新版本，旧版已备份。' } else { '插件已安装。' }
Say "$what`n`n游戏：$Game`nGodot：$Godot`n`n插件已自动启用。用 Godot 打开这个游戏，右侧会出现「微信导出」面板。"
exit 0
