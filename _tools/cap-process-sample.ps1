param([Parameter(Mandatory=$true)][string]$ProfilePath)
$ErrorActionPreference = 'Stop'
# Select only this throwaway Electron profile, never all processes by name.
# Command lines are used locally to identify the root and are not recorded.
$capRoots = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object {
  $_.CommandLine.Contains($ProfilePath) -and $_.CommandLine -notmatch '--type='
})
if ($capRoots.Count -ne 1) { throw "Expected one profile root; got $($capRoots.Count)" }
$capProcesses = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name,WorkingSetSize,UserModeTime,KernelModeTime)
$capIds = [System.Collections.Generic.HashSet[uint32]]::new()
[void]$capIds.Add([uint32]$capRoots[0].ProcessId)
do {
  $capChanged = $false
  foreach ($capProcess in $capProcesses) {
    if ($capIds.Contains([uint32]$capProcess.ParentProcessId) -and $capIds.Add([uint32]$capProcess.ProcessId)) { $capChanged = $true }
  }
} while ($capChanged)
$capOS = Get-CimInstance Win32_OperatingSystem
$capMachine = Get-CimInstance Win32_ComputerSystem
[pscustomobject]@{
  atMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  rootPid = [int]$capRoots[0].ProcessId
  cores = [int]$capMachine.NumberOfLogicalProcessors
  totalBytes = [double]$capMachine.TotalPhysicalMemory
  freeBytes = [double]$capOS.FreePhysicalMemory * 1024
  processes = @($capProcesses | Where-Object { $capIds.Contains([uint32]$_.ProcessId) } | ForEach-Object {
    [pscustomobject]@{
      pid = [int]$_.ProcessId; parent = [int]$_.ParentProcessId
      created = $_.CreationDate.ToUniversalTime().ToString('o'); name = $_.Name
      rssBytes = [double]$_.WorkingSetSize
      cpuMs = ([double]$_.UserModeTime + [double]$_.KernelModeTime) / 10000
    }
  })
} | ConvertTo-Json -Depth 5 -Compress
