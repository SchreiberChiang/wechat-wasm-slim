$ErrorActionPreference = 'Stop'
$mem = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
$cpu = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
[ordered]@{
  cpuPercent = [double]$cpu.PercentProcessorTime
  availableBytes = [double]$mem.AvailableMBytes * 1048576
  commitBytes = [double]$mem.CommittedBytes
  commitLimitBytes = [double]$mem.CommitLimit
  commitHeadroomBytes = [double]$mem.CommitLimit - [double]$mem.CommittedBytes
  pagesInputPerSecond = [double]$mem.PagesInputPersec
} | ConvertTo-Json -Compress
