# Misfit Installer Kit

Misfit Installer Kit is a Tauri-based desktop app that ships in two modes:

- **Studio**: a builder that lets you compose install manifests and payloads.
- **Installer**: a bundled runtime that applies a manifest and payloads on a target machine.

## Repo layout

- `installer-ui/`: React UI for Studio and Installer.
- `src-tauri/`: Rust engine and Tauri app wiring.
- `manifests/`: Bundled manifest(s) for Installer builds.
- `payloads/`: Bundled payload assets used by manifests.

## Quick start

Install UI dependencies first:

```powershell
cd installer-ui
npm install
```

Run Studio (builder):

```powershell
cd ..
npm run dev:studio
```

Run bundled Installer mode:

```powershell
npm run dev:vibe
```

Build bundles:

```powershell
npm run build:studio
npm run build:vibe
```

## Manifest basics

The manifest lives at `manifests/install.manifest.json` and is consumed by the Installer.

Supported steps:

- `copy`: copy a file/folder from `payloadDir` to a destination.
- `patchBlock`: replace content between markers.
- `setJsonValue`: update a key in a JSON file.
- `base64Embed`: base64‑encode a file and replace a placeholder.
- `runCommand`: execute a shell command.

Notes:

- `payloadDir` is relative to the project root or bundle root.
- Relative target paths resolve from the manifest folder.
- For literal JSON keys that contain dots, escape them with `\\.` (example: `workbench\\.colorTheme`).

## Backups and restore

Installer runs create backups before modifying files. Backups are stored under:

```
Documents/MisfitBackups/<appName>/backup_YYYYMMDD_HHMMSS
```

Restore uses the latest backup for the current `appName`. If no app‑specific backup exists,
it falls back to the legacy `Documents/MisfitBackups` root.

## Forcing Studio vs Installer

The app auto‑detects its mode, but you can force it:

- `Misfit Studio.exe --studio` or `MISFIT_MODE=studio`
- `Misfit Studio.exe --installer` or `MISFIT_MODE=installer`

## Cleanup tips

These folders are build artifacts and are safe to remove:

- `installer-ui/dist/`
- `src-tauri/target/`
- `dist/` (Studio output)
