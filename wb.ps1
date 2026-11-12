param(
  [Parameter(Mandatory=$true)][string]$Command,
  [int]$Timeout = 120,
  [int]$Retries = 4
)
$w   = "$env:LOCALAPPDATA\Programs\workbench\workbench.exe"
$iid = $env:ALIYUN_INSTANCE_ID   # 例：i-xxxxxxxxxxxxxxxxxxxxx
for ($i = 1; $i -le $Retries; $i++) {
  $out = & $w exec -i $iid --timeout $Timeout -c $Command 2>&1 | Out-String
  $bad = ($out -match 'ClientNotRunning|session resolve:|SDKError|ALL_RETRIES') -or ($out.Trim().Length -eq 0)
  if (-not $bad) {
    $out
    exit 0
  }
  $msg = $out.Trim()
  if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) }
  Write-Output "[retry $i/$Retries] $msg"
  Start-Sleep -Seconds 10
}
Write-Output "ALL_RETRIES_FAILED"
exit 1
