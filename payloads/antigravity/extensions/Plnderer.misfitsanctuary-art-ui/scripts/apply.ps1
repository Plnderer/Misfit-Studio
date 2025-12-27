param(
  [ValidateSet("Full","Lite")]
  [string]$Preset = "Full"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$extensionsDir = Join-Path $env:USERPROFILE ".antigravity\extensions"
$targetExtension = Join-Path $extensionsDir "Plnderer.misfitsanctuary-art-ui"

Write-Host "Installing MisfitSanctuary.Art UI..."

if (-not (Test-Path $extensionsDir)) {
  New-Item -ItemType Directory -Force -Path $extensionsDir | Out-Null
}

if ($root -ne $targetExtension) {
  if (-not (Test-Path $targetExtension)) {
    New-Item -ItemType Directory -Force -Path $targetExtension | Out-Null
  }
  Copy-Item -Path (Join-Path $root "*") -Destination $targetExtension -Recurse -Force
}

$logoPath = Join-Path $root "assets\Misfit Logo.png"
if (-not (Test-Path $logoPath)) {
  throw "Logo file not found: $logoPath"
}

$logoBase64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($logoPath))

function Update-FileBlock {
  param(
    [string]$Path,
    [string]$StartMarker,
    [string]$EndMarker,
    [string]$BlockContent
  )

  if (-not (Test-Path $Path)) {
    Write-Warning "Missing file: $Path"
    return
  }

  $content = Get-Content -Raw -Path $Path
  $pattern = "(?s)$([regex]::Escape($StartMarker)).*?$([regex]::Escape($EndMarker))"

  if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $BlockContent })
  } else {
    $content = $content + "`r`n" + $BlockContent + "`r`n"
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $content, $utf8NoBom)
  Write-Host "Patched: $Path"
}

$presetValue = $Preset
if (-not $PSBoundParameters.ContainsKey("Preset")) {
  Write-Host "Select preset: [F]ull or [L]ite"
  $choice = Read-Host "Preset (F/L)"
  if ($choice -match "^[lL]") {
    $presetValue = "Lite"
  } else {
    $presetValue = "Full"
  }
}

$workbenchOverlayPath = Join-Path $root "overlays\workbench.overlay.css"
if ($presetValue -eq "Lite") {
  $workbenchOverlayPath = Join-Path $root "overlays\workbench.overlay.lite.css"
}
$workbenchOverlay = Get-Content -Raw -Path $workbenchOverlayPath
$workbenchOverlay = $workbenchOverlay.Replace("__MISFIT_LOGO_DATA__", $logoBase64)

$workbenchCss = Join-Path $env:LOCALAPPDATA "Programs\\Antigravity\\resources\\app\\out\\vs\\workbench\\workbench.desktop.main.css"
Update-FileBlock -Path $workbenchCss -StartMarker "/* MisfitSanctuary.Art UI START */" -EndMarker "/* MisfitSanctuary.Art UI END */" -BlockContent $workbenchOverlay

$jetskiOverlayPath = Join-Path $root "overlays\jetski.overlay.css"
if ($presetValue -eq "Lite") {
  $jetskiOverlayPath = Join-Path $root "overlays\jetski.overlay.lite.css"
}
$jetskiOverlay = Get-Content -Raw -Path $jetskiOverlayPath

$jetskiCss = Join-Path $env:LOCALAPPDATA "Programs\\Antigravity\\resources\\app\\out\\jetskiMain.tailwind.css"
Update-FileBlock -Path $jetskiCss -StartMarker "/* MisfitSanctuary.Art UI JETSKI START */" -EndMarker "/* MisfitSanctuary.Art UI JETSKI END */" -BlockContent $jetskiOverlay

$settingsPath = Join-Path $env:APPDATA "Antigravity\\User\\settings.json"
if (Test-Path $settingsPath) {
  $settings = Get-Content -Raw -Path $settingsPath

  function Replace-Or-AddValue {
    param(
      [string]$Content,
      [string]$Key,
      [string]$Value
    )
    $pattern = '(?m)"' + [regex]::Escape($Key) + '"\s*:\s*"[^"]*"'
    if ($Content -match $pattern) {
      return [regex]::Replace($Content, $pattern, '"' + $Key + '": "' + $Value + '"')
    }

    $insert = '"' + $Key + '": "' + $Value + '"'
    if ($Content -match '"[^"]+"\s*:') {
      return [regex]::Replace($Content, '\}\s*$', ",`r`n  $insert`r`n}")
    }

    return [regex]::Replace($Content, '\{\s*\}\s*$', "{`r`n  $insert`r`n}")
  }

  $settings = Replace-Or-AddValue -Content $settings -Key "workbench.colorTheme" -Value "MisfitSanctuary.Art UI"
  $settings = Replace-Or-AddValue -Content $settings -Key "workbench.iconTheme" -Value "misfit-glass"
  $settings = Replace-Or-AddValue -Content $settings -Key "workbench.productIconTheme" -Value "misfit-carbon"

  $colorBlock = @'
"workbench.colorCustomizations": {
    "editor.background": "#05050500",
    "terminal.background": "#05050500",
    "panel.background": "#05050500",
    "sideBar.background": "#05050500",
    "activityBar.background": "#05050500",
    "statusBar.background": "#05050500",
    "titleBar.activeBackground": "#05050500",
    "titleBar.inactiveBackground": "#05050500",
    "tab.activeBackground": "#05050540",
    "tab.inactiveBackground": "#05050520",
    "tab.unfocusedActiveBackground": "#05050530",
    "tab.unfocusedInactiveBackground": "#05050518",
    "tab.hoverBackground": "#0a120a33",
    "tab.border": "#7DFB3920",
    "tab.activeBorder": "#7DFB3940",
    "tab.activeBorderTop": "#7DFB3966",
    "tab.unfocusedActiveBorder": "#7DFB3933",
    "tab.unfocusedActiveBorderTop": "#7DFB3940"
  }
'@

  $colorPattern = '(?s)"workbench\.colorCustomizations"\s*:\s*\{.*?\}'
  if ($settings -match $colorPattern) {
    $settings = [regex]::Replace($settings, $colorPattern, $colorBlock)
  } else {
    if ($settings -match '"[^"]+"\s*:') {
      $settings = [regex]::Replace($settings, '\}\s*$', ",`r`n  $colorBlock`r`n}")
    } else {
      $settings = "{`r`n  $colorBlock`r`n}"
    }
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($settingsPath, $settings, $utf8NoBom)
  Write-Host "Updated: $settingsPath"
} else {
  Write-Warning "Settings file not found: $settingsPath"
}

Write-Host "Done. Restart Antigravity to apply changes."
