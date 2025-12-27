# How to Reuse Misfit Installer Kit

This kit is designed to be easily adapted for any "Misfit" style deployment (copying files, patching CSS/JSON, embedding logos).

## 1. Directory Structure

- `manifests/`: Place your `install.manifest.json` here.
- `payloads/`: Place your payload files (CSS, images, etc.) here.
- `installer-ui/`: The source code for the installer UI.
- `src-tauri/`: The core logic (Rust).

## 2. Customizing the Installer

### Step A: Update the Manifest
Edit `manifests/install.manifest.json`. ensuring you define:
- `appName`, `version`, `publisher`.
- `logoPath`: Path to a logo image (relative to `manifests` or `payloads`).
- `advancedMode` (optional): When true, Studio can output to an absolute path and patching strips markers (one-shot).
- `installSteps`: The actions to perform.

Supported steps:
- `copy`: Copy a file/folder from payload to target.
- `patchBlock`: Replace content between markers in a target file.
- `setJsonValue`: Update a specific key in a JSON file (escape dots for literal keys, e.g. `workbench\\.colorTheme`).
- `base64Embed`: Read a file and inject its base64 string into a target placeholder.
- `runCommand`: Execute a shell command.

Relative paths in `file`/`dest` are resolved relative to the manifest folder. Payload paths are resolved relative to `payloadDir`, which is relative to the project root (the folder that contains `manifests/`).

### Step B: Build the Payload
Example structure:
```
payloads/
  theme/
    styles.css
    logo.png
  config/
    defaults.json
```
Reference these files in your manifest `installSteps` (e.g., `file: "theme/styles.css"`).

### Step C: Branding
To change the installer's look, edit `installer-ui/src/App.css`. You can verify changes by running `npm run tauri dev`.

## 3. Building for Release

- **Misfit Studio (builder app)**: `npm run build:studio`
- **Misfit Vibe Installer (bundled manifest + payloads)**: `npm run build:vibe`

These produce installers in `src-tauri/target/release/bundle/` (NSIS on Windows, `.app/.dmg` on macOS).

For dev runs:
- `npm run dev:studio`
- `npm run dev:vibe`

## 3a. Forcing Studio vs Installer Mode

If you bundle a manifest, the app defaults to Installer mode. To force Studio mode:
- Run `Misfit Studio.exe --studio`
- Or set `MISFIT_MODE=studio`
- Or set `MISFIT_STUDIO=1`

To force Installer mode: `Misfit Studio.exe --installer` or `MISFIT_MODE=installer`.

When Advanced Mode is enabled and you enter an absolute output path, the build requires a `.misfit-studio` marker file inside that output folder before it will overwrite it.

## 4. Updates
To update the core engine, modify `src-tauri/src/engine.rs`.
To update the UI features, modify `installer-ui/src/components/Dashboard.tsx` and `installer-ui/src/components/Installer.tsx`.

