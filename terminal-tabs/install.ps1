<#
.SYNOPSIS
Install, inspect or uninstall the per-user Firefox native messaging companion.
No administrator access, Windows service, or global network listener is used.
#>
[CmdletBinding()]
param(
  [ValidateSet('Install','Status','Uninstall')]
  [string]$Action = 'Install',
  [string]$SourceExe = (Join-Path $PSScriptRoot 'native\chromofox_terminal_host.exe')
)
$ErrorActionPreference = 'Stop'
$hostName = 'com.techrote.chromofox_terminal_tabs'
$extensionId = 'terminal-tabs@chromofoxext.local'
$location = Join-Path $env:LOCALAPPDATA 'chromofoxEXT\terminal-tabs'
$binary = Join-Path $location 'chromofox_terminal_host.exe'
$manifest = Join-Path $location ($hostName + '.json')
$registryPath = 'Software\Mozilla\NativeMessagingHosts\' + $hostName

$existingKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registryPath, $false)
try {
  $existing = if ($null -ne $existingKey) { [string]$existingKey.GetValue('', '') } else { '' }
} finally {
  if ($null -ne $existingKey) { $existingKey.Close() }
}

if ($existing -and -not [string]::Equals($existing, $manifest, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Another program owns $registryPath at '$existing'. Refusing to overwrite or remove it."
}

switch ($Action) {
  'Status' {
    Write-Host ('Host registry entry: ' + $(if ($existing) {$existing} else {'not installed'}))
    Write-Host ('Host executable exists: ' + (Test-Path -LiteralPath $binary))
    Write-Host ('Host manifest exists: ' + (Test-Path -LiteralPath $manifest))
    break
  }
  'Install' {
    if (-not (Test-Path -LiteralPath $SourceExe -PathType Leaf)) {
      throw "Native host executable not found at '$SourceExe'. Download the Windows bundle from the GitHub Actions artifact, not source ZIP."
    }
    $sourceFull = [IO.Path]::GetFullPath($SourceExe)
    if (-not [string]::Equals($sourceFull, $binary, [StringComparison]::OrdinalIgnoreCase)) {
      New-Item -Path $location -ItemType Directory -Force | Out-Null
      Copy-Item -LiteralPath $sourceFull -Destination $binary -Force
    }
    $configuration = [ordered]@{
      name = $hostName
      description = 'chromofoxEXT terminal tabs local ConPTY host'
      path = $binary
      type = 'stdio'
      allowed_extensions = @($extensionId)
    }
    $json = ConvertTo-Json -InputObject $configuration -Depth 4
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($manifest, $json, $utf8NoBom)
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registryPath)
    if ($null -eq $key) { throw 'Could not register native messaging host in HKCU' }
    try {
      $key.SetValue('', $manifest, [Microsoft.Win32.RegistryValueKind]::String)
    } finally {
      $key.Close()
    }
    Write-Host 'Installed per-user Firefox terminal companion.'
    Write-Host ('Manifest: ' + $manifest)
    Write-Host 'Next: open Firefox > about:debugging > This Firefox > Load Temporary Add-on.'
    Write-Host 'Select extension\manifest.json from the extracted Windows bundle.'
    break
  }
  'Uninstall' {
    if ($existing) {
      [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKey($registryPath, $false)
    }
    if (Test-Path -LiteralPath $manifest) { Remove-Item -LiteralPath $manifest -Force }
    if (Test-Path -LiteralPath $binary) { Remove-Item -LiteralPath $binary -Force }
    if (Test-Path -LiteralPath $location) {
      Remove-Item -LiteralPath $location -ErrorAction SilentlyContinue
    }
    Write-Host 'Unregistered and removed the terminal companion files owned by chromofoxEXT.'
    break
  }
}
