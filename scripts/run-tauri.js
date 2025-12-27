const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const tauriRoot = join(__dirname, "..", "src-tauri");
const localBin = join(
  __dirname,
  "..",
  "installer-ui",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri"
);

const args = process.argv.slice(2);

const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { stdio: "inherit", cwd: tauriRoot });

const tryRun = (cmd, cmdArgs) => {
  const result = run(cmd, cmdArgs);
  if (result.error && result.error.code === "ENOENT") {
    return null;
  }
  return result;
};

let result = null;

if (existsSync(localBin)) {
  result = run(localBin, args);
} else {
  result = tryRun(process.platform === "win32" ? "cargo-tauri.exe" : "cargo-tauri", args);
  if (!result) {
    result = tryRun("tauri", args);
  }
  if (!result) {
    result = tryRun("cargo", ["tauri", ...args]);
  }
}

if (!result) {
  console.error("Failed to find Tauri CLI. Install @tauri-apps/cli or tauri-cli.");
  process.exit(1);
}

process.exit(result.status ?? 1);
