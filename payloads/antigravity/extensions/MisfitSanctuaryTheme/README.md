# MisfitSanctuary.Art VS Code Theme

This theme captures the MisfitSanctuary.Art neon jade + ember gold palette taken from your invoice:

- **Neon jade** `#7DFB39` for keywords, highlights, and UI focus accents.
- **Ember gold** `#F6A526` for functions, status badges, and cursor contrast.
- **Charcoal night** `#050505` background to keep the bright accents punchy.
- Neutral bone/grays for base text so code stays legible.

## Try it locally

1. Open this folder in VS Code (`File` → `Open Folder...` → `MisfitSanctuaryTheme`).
2. Press `F5`. This launches a new *Extension Development Host* window with the theme pre-selected.
3. In the dev host, hit `Ctrl/Cmd + K` then `Ctrl/Cmd + T` to confirm "MisfitSanctuary.Art" is active.

## Install manually (without publishing)

1. Copy the folder somewhere persistent, e.g.
   - Windows: `%USERPROFILE%\.vscode\extensions\misfitsanctuary-theme`
   - macOS/Linux: `~/.vscode/extensions/misfitsanctuary-theme`
2. Restart VS Code (or reload with `Developer: Reload Window`).
3. Open the Command Palette → `Preferences: Color Theme` → select **MisfitSanctuary.Art**.

## Publishing later

If you want to list it on the marketplace:

```bash
npm install -g @vscode/vsce
cd MisfitSanctuaryTheme
vsce package       # creates .vsix
vsce publish       # publishes under your Marketplace publisher name
```

Let me know if you want variations (light mode, higher contrast, syntax tweaks, etc.).
