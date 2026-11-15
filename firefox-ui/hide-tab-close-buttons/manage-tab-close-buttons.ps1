# chromofoxEXT: reversible Firefox tab-X toggle for one explicitly selected profile.
# The helper changes only a delimited CSS block; it never edits Firefox preferences.
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
$exists = Test-Path -LiteralPath $target -PathType Leaf

# Preserve the pre-existing CSS encoding and BOM, including UTF-16 profiles.
$encoding = [System.Text.UTF8Encoding]::new($false, $true)
$offset = 0
$original = ''
if ($exists) {
    $bytes = [System.IO.File]::ReadAllBytes($target)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
        $encoding = [System.Text.UTF8Encoding]::new($true, $true)
        $offset = 3
    } elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) {
        $encoding = [System.Text.UnicodeEncoding]::new($false, $true, $true)
        $offset = 2
    } elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) {
        $encoding = [System.Text.UnicodeEncoding]::new($true, $true, $true)
        $offset = 2
    }
    $original = $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
}

$crlf = ([string][char]13) + ([string][char]10)
$lf = [string][char]10
$eol = if ($original.Contains($crlf)) { $crlf } elseif ($original.Contains($lf)) { $lf } else { [Environment]::NewLine }
$startIndex = $original.IndexOf($begin, [System.StringComparison]::Ordinal)
$endIndex = $original.IndexOf($end, [System.StringComparison]::Ordinal)

if (($startIndex -ge 0) -ne ($endIndex -ge 0)) {
    throw "Incomplete managed CSS block in $target; no changes made."
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
        return
    }
    $insertedSeparator = if ($original.Length -gt 0 -and -not $original.EndsWith($lf)) { 1 } else { 0 }
    $prefix = if ($insertedSeparator -eq 1) { $eol } else { '' }
    $createdFile = if ($exists) { 0 } else { 1 }
    $block = @(
        $begin,
        "/* chromofoxEXT inserted-separator: $insertedSeparator */",
        "/* chromofoxEXT created-file: $createdFile */",
        '#tabbrowser-tabs .tab-close-button {',
        '    display: none !important;',
        '}',
        $end
    ) -join $eol
    $updated = $original + $prefix + $block + $eol
} else {
    if ($startIndex -lt 0) {
        Write-Host 'Not installed. No file changes made.'
        return
    }
    $managed = $original.Substring($startIndex, $endIndex + $end.Length - $startIndex)
    $separatorTag = [regex]::Match($managed, '/\* chromofoxEXT inserted-separator: ([01]) \*/')
    $createdTag = [regex]::Match($managed, '/\* chromofoxEXT created-file: ([01]) \*/')
    $removeStart = $startIndex
    $removeEnd = $endIndex + $end.Length
    if ($original.Substring($removeEnd).StartsWith($eol, [System.StringComparison]::Ordinal)) {
        $removeEnd += $eol.Length
    } elseif ($original.Substring($removeEnd).StartsWith($lf, [System.StringComparison]::Ordinal)) {
        $removeEnd += $lf.Length
    }
    if ($separatorTag.Success -and $separatorTag.Groups[1].Value -eq '1') {
        if ($startIndex -lt $eol.Length -or $original.Substring($startIndex - $eol.Length, $eol.Length) -cne $eol) {
            throw 'Expected managed block separator is missing; no changes made.'
        }
        # Undo only our separator if nothing was appended after our block;
        # otherwise keep it to separate the original CSS from later user rules.
        if ($removeEnd -eq $original.Length) {
            $removeStart -= $eol.Length
        }
    }
    $updated = $original.Substring(0, $removeStart) + $original.Substring($removeEnd)
}

# Keep a byte-for-byte backup whenever an existing CSS file will be modified.
if ($exists) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fffffff'
    $backup = "$target.chromofox-backup-$stamp"
    Copy-Item -LiteralPath $target -Destination $backup -ErrorAction Stop
    Write-Host "Original CSS backed up to: $backup"
}
if ($Action -eq 'Remove' -and $createdTag.Success -and
    $createdTag.Groups[1].Value -eq '1' -and $updated.Length -eq 0) {
    Remove-Item -LiteralPath $target -ErrorAction Stop
    Write-Host "Removed helper-created CSS file: $target"
} else {
    if (-not $exists) {
        New-Item -ItemType Directory -Path $chromeDir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($target, $updated, $encoding)
    Write-Host "CSS updated: $target"
}
if ($Action -eq 'Install') {
    Write-Host 'NEXT: about:config => toolkit.legacyUserProfileCustomizations.stylesheets = true'
}
Write-Host 'Fully exit and restart Firefox to apply the change.'
