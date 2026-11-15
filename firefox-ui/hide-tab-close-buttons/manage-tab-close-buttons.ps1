# chromofoxEXT: profile-level Firefox tab-X toggle.
# Reversible: changes only a delimited CSS block; never edits Firefox preferences.
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Remove')]
    [string]$Action = 'Install',
    [string]$ProfilePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProfilePath)) {
    Write-Host 'In Firefox open about:profiles and copy the Root Directory of the profile in use.'
    $ProfilePath = Read-Host 'Paste the full Firefox profile directory path'
}
if ([string]::IsNullOrWhiteSpace($ProfilePath)) {
    throw 'No profile directory supplied; no changes made.'
}
$profile = (Resolve-Path -LiteralPath $ProfilePath -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath (Join-Path $profile 'prefs.js') -PathType Leaf)) {
    throw "Not a recognised Firefox profile (prefs.js missing): $profile. No changes made."
}

$chromeDir = Join-Path $profile 'chrome'
$target = Join-Path $chromeDir 'userChrome.css'
$begin = '/* chromofoxEXT hide-tab-close-buttons BEGIN */'
$end = '/* chromofoxEXT hide-tab-close-buttons END */'
$block = @"
$begin
#tabbrowser-tabs .tab-close-button {
    display: none !important;
}
$end
"@

$exists = Test-Path -LiteralPath $target -PathType Leaf
$original = if ($exists) { [System.IO.File]::ReadAllText($target) } else { '' }
$startIndex = $original.IndexOf($begin, [System.StringComparison]::Ordinal)
$endIndex = $original.IndexOf($end, [System.StringComparison]::Ordinal)

if (($startIndex -ge 0) -ne ($endIndex -ge 0)) {
    throw "Incomplete managed CSS block in $target; inspect it manually. No changes made."
}
if ($startIndex -ge 0 -and (
    $endIndex -lt $startIndex -or
    $original.IndexOf($begin, $startIndex + $begin.Length, [System.StringComparison]::Ordinal) -ge 0 -or
    $original.IndexOf($end, $endIndex + $end.Length, [System.StringComparison]::Ordinal) -ge 0
)) {
    throw "Duplicate/malformed managed blocks in $target; no changes made."
}

if ($Action -eq 'Install') {
    if ($startIndex -ge 0) {
        Write-Host 'Already installed. No file changes made.'
        exit 0
    }
    $prefix = if ($original.Length -eq 0 -or $original.EndsWith([string][char]10)) {
        ''
    } else {
        [Environment]::NewLine
    }
    $updated = $original + $prefix + $block + [Environment]::NewLine
} else {
    if ($startIndex -lt 0) {
        Write-Host 'Not installed. No file changes made.'
        exit 0
    }
    $afterIndex = $endIndex + $end.Length
    $suffix = $original.Substring($afterIndex)
    if ($suffix.StartsWith([Environment]::NewLine)) {
        $suffix = $suffix.Substring([Environment]::NewLine.Length)
    } elseif ($suffix.StartsWith([string][char]10)) {
        $suffix = $suffix.Substring(1)
    }
    $updated = $original.Substring(0, $startIndex) + $suffix
}

if ($exists) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fffffff'
    $backup = "$target.chromofox-backup-$stamp"
    Copy-Item -LiteralPath $target -Destination $backup -ErrorAction Stop
    Write-Host "Original CSS backed up to: $backup"
} else {
    New-Item -ItemType Directory -Path $chromeDir -Force | Out-Null
}
[System.IO.File]::WriteAllText($target, $updated, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "CSS updated: $target"
if ($Action -eq 'Install') {
    Write-Host 'NEXT: about:config => toolkit.legacyUserProfileCustomizations.stylesheets = true'
} 
Write-Host 'Fully exit and restart Firefox to apply the change.'
