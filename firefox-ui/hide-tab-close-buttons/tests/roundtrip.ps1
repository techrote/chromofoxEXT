# Run on Windows PowerShell 5.1 and PowerShell 7. Verifies exact pre-existing CSS bytes.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$helper = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\manage-tab-close-buttons.ps1')).Path
$root = Join-Path ([System.IO.Path]::GetTempPath()) ("chromofox-tests-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
$utf8bom = [System.Text.UTF8Encoding]::new($true)
$utf16 = [System.Text.UnicodeEncoding]::new($false, $true)
$cases = @(
    @{ Name = 'no-css'; Data = $null },
    @{ Name = 'utf8-no-final-newline'; Data = $utf8.GetBytes('/* existing rule */') },
    @{ Name = 'utf8-lf'; Data = $utf8.GetBytes("/* existing */" + [char]10 + ".other { color: red; }" + [char]10) },
    @{ Name = 'utf8-crlf'; Data = $utf8.GetBytes("/* existing */" + [char]13 + [char]10 + ".other { color: red; }" + [char]13 + [char]10) },
    @{ Name = 'utf8-bom'; Data = [byte[]]($utf8bom.GetPreamble() + $utf8bom.GetBytes("/* café */" + [char]10)) },
    @{ Name = 'utf16-le-bom'; Data = [byte[]]($utf16.GetPreamble() + $utf16.GetBytes("/* existing */" + [char]13 + [char]10)) }
)
try {
    foreach ($case in $cases) {
        $profile = Join-Path $root $case.Name
        $chromeDir = Join-Path $profile 'chrome'
        $css = Join-Path $chromeDir 'userChrome.css'
        New-Item -ItemType Directory -Path $chromeDir -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $profile 'prefs.js'), '', $utf8)
        if ($null -ne $case.Data) {
            [System.IO.File]::WriteAllBytes($css, [byte[]]$case.Data)
        }
        & $helper -Action Install -ProfilePath $profile | Out-Null
        if (-not (Test-Path -LiteralPath $css)) { throw "Install failed: $($case.Name)" }
        $installed = [System.IO.File]::ReadAllBytes($css)
        & $helper -Action Install -ProfilePath $profile | Out-Null
        $installedAgain = [System.IO.File]::ReadAllBytes($css)
        if ([Convert]::ToBase64String($installed) -cne [Convert]::ToBase64String($installedAgain)) {
            throw "Second install changed CSS: $($case.Name)"
        }
        & $helper -Action Remove -ProfilePath $profile | Out-Null
        if ($null -eq $case.Data) {
            if (Test-Path -LiteralPath $css) { throw 'Remove did not delete helper-created CSS' }
        } else {
            $restored = [System.IO.File]::ReadAllBytes($css)
            if ([Convert]::ToBase64String([byte[]]$case.Data) -cne [Convert]::ToBase64String($restored)) {
                throw "Round-trip was not byte-exact: $($case.Name)"
            }
        }
        & $helper -Action Remove -ProfilePath $profile | Out-Null
        if ($null -ne $case.Data) {
            $again = [System.IO.File]::ReadAllBytes($css)
            if ([Convert]::ToBase64String([byte[]]$case.Data) -cne [Convert]::ToBase64String($again)) {
                throw "Second removal changed CSS: $($case.Name)"
            }
            $backups = @(Get-ChildItem -LiteralPath $chromeDir -Filter 'userChrome.css.chromofox-backup-*')
            if ($backups.Count -lt 2) { throw "Missing pre-write backups: $($case.Name)" }
        }
        Write-Host "PASS: $($case.Name)"
    }

    # If the user adds CSS after our block, uninstall must keep that new rule.
    $profile = Join-Path $root 'edited-after-install'
    $chromeDir = Join-Path $profile 'chrome'
    New-Item -ItemType Directory -Path $chromeDir -Force | Out-Null
    $css = Join-Path $chromeDir 'userChrome.css'
    [System.IO.File]::WriteAllText((Join-Path $profile 'prefs.js'), '', $utf8)
    [System.IO.File]::WriteAllText($css, '/* existing */', $utf8)
    & $helper -Action Install -ProfilePath $profile | Out-Null
    [System.IO.File]::AppendAllText($css, ".later { color: blue; }" + [Environment]::NewLine, $utf8)
    & $helper -Action Remove -ProfilePath $profile | Out-Null
    $after = [System.IO.File]::ReadAllText($css, $utf8)
    if (-not ($after.StartsWith('/* existing */') -and $after.Contains('.later { color: blue; }') -and
               $after.Contains([Environment]::NewLine))) {
        throw 'Later user CSS lost or concatenated'
    }
    Write-Host 'PASS: preserve CSS added after installation'

    $profile = Join-Path $root 'malformed'
    New-Item -ItemType Directory -Path (Join-Path $profile 'chrome') -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $profile 'prefs.js'), '', $utf8)
    $css = Join-Path $profile 'chrome\userChrome.css'
    [System.IO.File]::WriteAllText($css, '/* chromofoxEXT hide-tab-close-buttons BEGIN */', $utf8)
    $failed = $false
    try { & $helper -Action Remove -ProfilePath $profile | Out-Null } catch { $failed = $true }
    if (-not $failed -or [System.IO.File]::ReadAllText($css) -cne '/* chromofoxEXT hide-tab-close-buttons BEGIN */') {
        throw 'Malformed block not rejected safely'
    }
    Write-Host 'PASS: malformed block rejected without mutation'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host 'PASS: Firefox tab-X CSS reversible-helper regression suite'
