MisfitSanctuary.Art UI

This package bundles the MisfitSanctuary.Art UI theme, Misfit Glass icons, Misfit Carbon product icons, and the glass + fog overlays (including the Misfit logo watermark in the editor).

Install (Windows)
- Double-click `Install MisfitSanctuary.Art-UI.bat`
- Or run: powershell -ExecutionPolicy Bypass -File .\scripts\apply.ps1 -Preset Full
- Restart Antigravity.

Install (macOS)
- Double-click `Install MisfitSanctuary.Art-UI.command`
- If macOS blocks it, run once in Terminal:
  chmod +x "Install MisfitSanctuary.Art-UI.command" "scripts/apply-macos.sh"
  ./Install\ MisfitSanctuary.Art-UI.command
- Restart Antigravity.

Presets
- Full: fog + glass + animated glow (current look)
- Lite: reduced blur/animation for lower memory/GPU use
- To force Lite: run `.\scripts\apply.ps1 -Preset Lite` (Windows) or `./scripts/apply-macos.sh Lite` (macOS)

Build a Windows .exe installer (recommended)
- Install Inno Setup.
- Open `installer\MisfitSanctuary.Art-UI.iss`.
- Click Compile.
- The installer appears as `installer\MisfitSanctuary.Art-UI-Setup.exe`.

Notes
- The overlay patch edits Antigravity app CSS directly. Re-run the script after Antigravity updates.
- macOS script targets `/Applications/Antigravity.app` or `~/Applications/Antigravity.app`. If your install path is different, edit `scripts/apply-macos.sh` and set `app_root`.
- macOS patch may prompt for your password if Antigravity is in `/Applications`.
- Uninstall does not automatically revert the CSS patches.

Share
- Zip the entire MisfitSanctuary.Art-UI folder and send it.
- Recipients just run the install file for their OS.
