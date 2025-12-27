#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

extensions_dir="$HOME/.antigravity/extensions"
target_extension="$extensions_dir/Plnderer.misfitsanctuary-art-ui"

echo "Installing MisfitSanctuary.Art UI..."

mkdir -p "$extensions_dir"
if [ "$root" != "$target_extension" ]; then
  mkdir -p "$target_extension"
  cp -R "$root"/* "$target_extension"/
fi

logo_path="$root/assets/Misfit Logo.png"
if [ ! -f "$logo_path" ]; then
  echo "Logo file not found: $logo_path" >&2
  exit 1
fi

logo_base64=$(base64 "$logo_path" | tr -d '\n')

preset="${1:-}"
if [ -z "$preset" ]; then
  read -r -p "Preset (F/L): " choice
  if [[ "$choice" =~ ^[lL] ]]; then
    preset="Lite"
  else
    preset="Full"
  fi
fi

workbench_overlay_path="$root/overlays/workbench.overlay.css"
jetski_overlay_path="$root/overlays/jetski.overlay.css"
if [ "$preset" = "Lite" ]; then
  workbench_overlay_path="$root/overlays/workbench.overlay.lite.css"
  jetski_overlay_path="$root/overlays/jetski.overlay.lite.css"
fi

workbench_overlay_tmp=$(mktemp)
perl -0777 -pe "s#__MISFIT_LOGO_DATA__#${logo_base64}#g" "$workbench_overlay_path" > "$workbench_overlay_tmp"

app_root=""
if [ -d "/Applications/Antigravity.app" ]; then
  app_root="/Applications/Antigravity.app"
elif [ -d "$HOME/Applications/Antigravity.app" ]; then
  app_root="$HOME/Applications/Antigravity.app"
fi

if [ -z "$app_root" ]; then
  echo "Antigravity.app not found in /Applications or ~/Applications." >&2
  echo "Edit this script and set app_root to your install path." >&2
  exit 1
fi

workbench_css="$app_root/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.css"
jetski_css="$app_root/Contents/Resources/app/out/jetskiMain.tailwind.css"

write_file() {
  local src="$1"
  local dest="$2"

  if [ -w "$dest" ]; then
    cat "$src" > "$dest"
  else
    sudo tee "$dest" < "$src" > /dev/null
  fi
}

update_file_block() {
  local path="$1"
  local start_marker="$2"
  local end_marker="$3"
  local block_file="$4"

  if [ ! -f "$path" ]; then
    echo "Missing file: $path" >&2
    return 1
  fi

  local tmp
  tmp=$(mktemp)
  export START_MARKER="$start_marker"
  export END_MARKER="$end_marker"
  export BLOCK_FILE="$block_file"

  if grep -qF "$start_marker" "$path"; then
    perl -0777 -pe 'BEGIN{local $/; open my $fh,"<",$ENV{BLOCK_FILE} or die $!; $block=<$fh>;} s/\Q$ENV{START_MARKER}\E.*?\Q$ENV{END_MARKER}\E/$block/s' "$path" > "$tmp"
  else
    cat "$path" > "$tmp"
    printf "\n" >> "$tmp"
    cat "$block_file" >> "$tmp"
    printf "\n" >> "$tmp"
  fi

  write_file "$tmp" "$path"
  rm -f "$tmp"
  echo "Patched: $path"
}

update_file_block "$workbench_css" "/* MisfitSanctuary.Art UI START */" "/* MisfitSanctuary.Art UI END */" "$workbench_overlay_tmp"
update_file_block "$jetski_css" "/* MisfitSanctuary.Art UI JETSKI START */" "/* MisfitSanctuary.Art UI JETSKI END */" "$jetski_overlay_path"

rm -f "$workbench_overlay_tmp"

settings_path="$HOME/Library/Application Support/Antigravity/User/settings.json"
if [ -f "$settings_path" ]; then
  settings=$(cat "$settings_path")
else
  settings="{}"
fi

replace_or_add_value() {
  local key="$1"
  local value="$2"
  if echo "$settings" | grep -q "\"$key\"[[:space:]]*:"; then
    settings=$(printf "%s" "$settings" | perl -0777 -pe "s/\"$key\"\s*:\s*\"[^\"]*\"/\"$key\": \"$value\"/g")
  else
    if echo "$settings" | grep -q "\"[^\"]\+\"[[:space:]]*:"; then
      settings=$(printf "%s" "$settings" | perl -0777 -pe "s/\}\s*$/,  \"$key\": \"$value\"\n}/")
    else
      settings=$(printf "{\n  \"%s\": \"%s\"\n}" "$key" "$value")
    fi
  fi
}

replace_or_add_value "workbench.colorTheme" "MisfitSanctuary.Art UI"
replace_or_add_value "workbench.iconTheme" "misfit-glass"
replace_or_add_value "workbench.productIconTheme" "misfit-carbon"

color_block=$(cat <<'JSON'
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
JSON
)

if echo "$settings" | grep -q "\"workbench.colorCustomizations\"[[:space:]]*:"; then
  settings=$(printf "%s" "$settings" | perl -0777 -pe "s/\"workbench\.colorCustomizations\"\s*:\s*\{.*?\}/$color_block/s")
else
  if echo "$settings" | grep -q "\"[^\"]\+\"[[:space:]]*:"; then
    settings=$(printf "%s" "$settings" | perl -0777 -pe "s/\}\s*$/,  $color_block\n}/")
  else
    settings=$(printf "{\n  %s\n}" "$color_block")
  fi
fi

mkdir -p "$(dirname "$settings_path")"
printf "%s" "$settings" > "$settings_path"

printf "\nDone. Restart Antigravity to apply changes.\n"
read -r -p "Press Enter to close..." _
