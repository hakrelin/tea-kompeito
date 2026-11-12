param(
  [Parameter(Mandatory=$true)][string]$Command,
  [int]$Timeout = 120,
  [int]$Retries = 5,
  [string]$Instance = $env:ALIYUN_INSTANCE_ID,
  [string]$Region  = $env:ALIYUN_REGION
)
$w = "$env:LOCALAPPDATA\Programs\workbench\workbench.exe"
for ($i = 1; $i -le $Retries; $i++) {
  $out = & $w exec -r $Region -i $Instance --timeout $Timeout -c $Command 2>&1 | Out-String
  $bad = ($out -match 'ClientNotRunning|session resolve:|SDKError') -or ($out.Trim().Length -eq 0)
  if (-not $bad) { $out; exit 0 }
  $msg = $out.Trim(); if ($msg.Length -gt 160) { $msg = $msg.Substring(0,160) }
  Write-Output "[retry $i/$Retries] $msg"
  Start-Sleep -Seconds 8
}
Write-Output "ALL_RETRIES_FAILED"
exit 1
