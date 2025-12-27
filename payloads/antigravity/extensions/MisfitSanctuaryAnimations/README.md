# MisfitSanctuary Animations Extension

Adds two animated flourishes that match the MisfitSanctuary.Art brand:

1. **Glowing status bar badge** – a $(flame) icon cycles through neon jade + ember gold tones so the brand mark lives in the VS Code chrome.
2. **Misfit Portal panel** – renders a procedural Earth-like planet built with custom GLSL noise shaders (terrain, oceans, city lights, atmosphere, clouds) plus a living galaxy backdrop and GUI sliders for sea level, mountain height, colors, and atmosphere density. Drag to rotate, scroll to zoom.

## Run it locally

1. Open `MisfitSanctuaryAnimations` in VS Code.
2. If prompted, run `npm install` to pull dev deps (only needed for linting/intellisense).
3. Press `F5` (or use the `Run MisfitSanctuary Theme` config from the Run view) to open an Extension Development Host.
4. The status bar glow appears automatically.
5. Press `Ctrl/Cmd + Shift + P`, run `MisfitSanctuary: Show Animated Panel` to open the portal.
6. Interact: drag to rotate, scroll to zoom, tweak parameters in the lil-gui control panel, and watch the galaxy swirl while the full globe renders cleanly on both day and night sides.

## Packaging later

Same as any extension: `vsce package` creates a `.vsix` you can side-load, or `vsce publish` shares it publicly.

Tweak `colors` array in `src/extension.js` to change glow cadence, or edit the webview HTML to add logos/videos.
