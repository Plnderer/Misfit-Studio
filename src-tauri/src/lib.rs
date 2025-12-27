pub mod engine;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use std::env;
use std::path::{Component, Path, PathBuf};
use std::collections::HashSet;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
enum AppMode {
    Installer,
    Studio,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildRequest {
    project_name: String,
    manifest: engine::InstallManifest,
    // List of (source_path, relative_dest_path) for payloads
    payload_files: Vec<(String, String)>,
    force_overwrite: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildTargetInfo {
    path: String,
    exists: bool,
    has_marker: bool,
    is_absolute: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanEntry {
    name: String,
    path: String,
}

fn resolve_manifest_info(app_handle: &tauri::AppHandle) -> Option<(PathBuf, PathBuf)> {
    // 1. Try resource path (bundled)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let resource_manifest = resource_dir.join("manifests/install.manifest.json");
        if resource_manifest.exists() {
            return Some((resource_manifest, resource_dir));
        }
        let root_manifest = resource_dir.join("install.manifest.json");
        if root_manifest.exists() {
            return Some((root_manifest, resource_dir));
        }
    }

    // 2. Try relative to executable (portable mode)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let relative_manifest = exe_dir.join("manifests/install.manifest.json");
            if relative_manifest.exists() {
                return Some((relative_manifest, exe_dir.to_path_buf()));
            }
            let root_manifest = exe_dir.join("install.manifest.json");
            if root_manifest.exists() {
                return Some((root_manifest, exe_dir.to_path_buf()));
            }
        }
    }

    None
}

fn resolve_manifest_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    resolve_manifest_info(app_handle).map(|(path, _)| path)
}

fn normalize_rel_path(path_str: &str, allow_current: bool) -> Result<PathBuf, String> {
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return if allow_current {
            Ok(PathBuf::from("."))
        } else {
            Err("Path cannot be empty".to_string())
        };
    }

    let path = Path::new(trimmed);
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(os) => normalized.push(os),
            Component::CurDir => {},
            Component::ParentDir => return Err("Path cannot contain '..'".to_string()),
            Component::RootDir | Component::Prefix(_) => return Err("Path must be relative".to_string()),
        }
    }

    if normalized.as_os_str().is_empty() {
        if allow_current {
            Ok(PathBuf::from("."))
        } else {
            Err("Path cannot be '.'".to_string())
        }
    } else {
        Ok(normalized)
    }
}

fn validate_project_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }

    let path = Path::new(trimmed);
    let mut components = path.components();
    let first = components.next().ok_or("Project name cannot be empty".to_string())?;
    if components.next().is_some() {
        return Err("Project name must be a single folder name".to_string());
    }

    match first {
        Component::Normal(os) => Ok(os.to_string_lossy().to_string()),
        Component::CurDir => Err("Project name cannot be '.'".to_string()),
        Component::ParentDir => Err("Project name cannot be '..'".to_string()),
        Component::RootDir | Component::Prefix(_) => Err("Project name must be a relative name".to_string()),
    }
}

fn can_write_dir(dir: &Path) -> bool {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let test_path = dir.join(format!(".misfit_write_test_{}", nanos));
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&test_path)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&test_path);
            true
        }
        Err(_) => false,
    }
}

fn resolve_dist_base(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let candidate = cwd.join("dist");
    if std::fs::create_dir_all(&candidate).is_ok() && can_write_dir(&candidate) {
        return Ok(candidate);
    }

    let doc_dir = app_handle.path().document_dir().map_err(|e| e.to_string())?;
    let fallback = doc_dir.join("MisfitStudio").join("dist");
    std::fs::create_dir_all(&fallback).map_err(|e| format!("Failed to create fallback dist at {}: {}", fallback.display(), e))?;
    if !can_write_dir(&fallback) {
        return Err(format!("Fallback dist not writable: {}", fallback.display()));
    }
    Ok(fallback)
}

fn resolve_payload_source(src: &str) -> PathBuf {
    let candidate = PathBuf::from(src);
    if candidate.is_absolute() {
        return candidate;
    }

    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        bases.push(cwd.clone());
        let mut cursor = cwd;
        for _ in 0..4 {
            if let Some(parent) = cursor.parent() {
                let parent = parent.to_path_buf();
                bases.push(parent.clone());
                cursor = parent;
            } else {
                break;
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let mut cursor = dir.to_path_buf();
            for _ in 0..4 {
                bases.push(cursor.clone());
                if let Some(parent) = cursor.parent() {
                    cursor = parent.to_path_buf();
                } else {
                    break;
                }
            }
        }
    }

    for base in bases {
        let joined = base.join(src);
        if joined.exists() {
            return joined;
        }
    }

    PathBuf::from(src)
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "target"
            | "dist"
            | ".cache"
            | "appdata"
            | "windows"
            | "program files"
            | "program files (x86)"
    )
}

fn find_payload_dir(base: &Path, payload_dir: &Path, depth: usize) -> Option<PathBuf> {
    let candidate = base.join(payload_dir);
    if candidate.exists() {
        return Some(candidate);
    }
    if depth == 0 {
        return None;
    }

    let entries = std::fs::read_dir(base).ok()?;
    for entry in entries {
        let entry = entry.ok()?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if should_skip_dir(&name) {
            continue;
        }
        if let Some(found) = find_payload_dir(&path, payload_dir, depth - 1) {
            return Some(found);
        }
    }
    None
}

#[tauri::command]
fn resolve_payload_root(payload_dir: String, app_handle: tauri::AppHandle) -> Option<String> {
    let payload_dir = normalize_rel_path(&payload_dir, true).ok()?;
    if payload_dir.as_os_str() == "." {
        return None;
    }

    let mut bases: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        bases.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            bases.push(dir.to_path_buf());
        }
    }
    if let Ok(docs) = app_handle.path().document_dir() {
        bases.push(docs);
    }
    if let Some(home) = home_dir() {
        bases.push(home);
    }
    if let Some(onedrive) = env::var_os("OneDrive") {
        bases.push(PathBuf::from(onedrive));
    }

    let mut seen = HashSet::new();
    for base in bases {
        let key = base.to_string_lossy().to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        if let Some(found) = find_payload_dir(&base, &payload_dir, 3) {
            return Some(found.to_string_lossy().to_string());
        }
    }

    None
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(PathBuf::from))
}

fn backup_namespace(app_name: &str) -> String {
    let trimmed = app_name.trim();
    if trimmed.is_empty() {
        return "default".to_string();
    }

    let mut out = String::new();
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else if ch.is_ascii_whitespace() {
            out.push('_');
        } else {
            out.push('_');
        }
    }

    if out.is_empty() {
        "default".to_string()
    } else {
        out
    }
}

fn expand_env_vars(input: &str) -> String {
    let mut output = String::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    if input.starts_with('~') {
        if chars.len() == 1 || chars.get(1) == Some(&'\\') || chars.get(1) == Some(&'/') {
            if let Some(home) = home_dir() {
                output.push_str(&home.to_string_lossy());
                i = 1;
            }
        }
    }

    while i < chars.len() {
        let ch = chars[i];
        if ch == '%' {
            if let Some(end) = chars[i + 1..].iter().position(|c| *c == '%') {
                let end_idx = i + 1 + end;
                let name: String = chars[i + 1..end_idx].iter().collect();
                if !name.is_empty() {
                    if let Ok(val) = env::var(&name) {
                        output.push_str(&val);
                    } else {
                        output.push('%');
                        output.push_str(&name);
                        output.push('%');
                    }
                    i = end_idx + 1;
                    continue;
                }
            }
        }

        if ch == '$' {
            if i + 1 < chars.len() && chars[i + 1] == '{' {
                if let Some(end) = chars[i + 2..].iter().position(|c| *c == '}') {
                    let end_idx = i + 2 + end;
                    let name: String = chars[i + 2..end_idx].iter().collect();
                    if !name.is_empty() {
                        if let Ok(val) = env::var(&name) {
                            output.push_str(&val);
                        } else {
                            output.push_str("${");
                            output.push_str(&name);
                            output.push('}');
                        }
                        i = end_idx + 1;
                        continue;
                    }
                }
            } else {
                let mut end_idx = i + 1;
                while end_idx < chars.len() {
                    let c = chars[end_idx];
                    if c.is_ascii_alphanumeric() || c == '_' {
                        end_idx += 1;
                    } else {
                        break;
                    }
                }
                if end_idx > i + 1 {
                    let name: String = chars[i + 1..end_idx].iter().collect();
                    if let Ok(val) = env::var(&name) {
                        output.push_str(&val);
                    } else {
                        output.push('$');
                        output.push_str(&name);
                    }
                    i = end_idx;
                    continue;
                }
            }
        }

        output.push(ch);
        i += 1;
    }

    output
}

fn resolve_path(base: &Path, path: &str) -> PathBuf {
    let expanded = expand_env_vars(path);
    let candidate = PathBuf::from(&expanded);
    if candidate.is_absolute() {
        candidate
    } else {
        base.join(candidate)
    }
}

fn forced_app_mode() -> Option<AppMode> {
    for arg in env::args().skip(1) {
        if arg.eq_ignore_ascii_case("--studio") {
            return Some(AppMode::Studio);
        }
        if arg.eq_ignore_ascii_case("--installer") {
            return Some(AppMode::Installer);
        }
    }

    if let Ok(mode) = env::var("MISFIT_MODE") {
        match mode.to_lowercase().as_str() {
            "studio" => return Some(AppMode::Studio),
            "installer" => return Some(AppMode::Installer),
            _ => {}
        }
    }

    if let Ok(value) = env::var("MISFIT_STUDIO") {
        if value == "1" || value.eq_ignore_ascii_case("true") {
            return Some(AppMode::Studio);
        }
    }

    None
}

#[tauri::command]
fn inspect_build_target(request: BuildRequest, app_handle: tauri::AppHandle) -> Result<BuildTargetInfo, String> {
    let advanced_mode = request.manifest.advanced_mode.unwrap_or(false);
    let is_absolute_output = advanced_mode && Path::new(&request.project_name).is_absolute();
    let dist_root = if is_absolute_output {
        PathBuf::from(&request.project_name)
    } else {
        let dist_base = resolve_dist_base(&app_handle)?;
        let project_name = validate_project_name(&request.project_name)?;
        dist_base.join(project_name)
    };

    let marker = dist_root.join(".misfit-studio");
    Ok(BuildTargetInfo {
        path: dist_root.to_string_lossy().to_string(),
        exists: dist_root.exists(),
        has_marker: marker.exists(),
        is_absolute: is_absolute_output,
    })
}

#[tauri::command]
fn get_app_mode(app_handle: tauri::AppHandle) -> AppMode {
    if let Some(forced) = forced_app_mode() {
        return forced;
    }
    if resolve_manifest_path(&app_handle).is_some() {
        AppMode::Installer
    } else {
        AppMode::Studio
    }
}

#[tauri::command]
fn get_manifest(app_handle: tauri::AppHandle) -> Result<engine::InstallManifest, String> {
    match resolve_manifest_path(&app_handle) {
        Some(path) => engine::load_manifest(&path).map_err(|e| e.to_string()),
        None => Err("Manifest not found. App should be in Studio Mode.".to_string()),
    }
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(file_path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn scan_extension_folders(root: String) -> Result<Vec<ScanEntry>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Err("Folder not found.".to_string());
    }
    if !root_path.is_dir() {
        return Err("Selected path is not a folder.".to_string());
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&root_path).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            entries.push(ScanEntry {
                name,
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
async fn build_project(request: BuildRequest, app_handle: tauri::AppHandle) -> Result<String, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let advanced_mode = request.manifest.advanced_mode.unwrap_or(false);
    let force_overwrite = request.force_overwrite.unwrap_or(false);
    let payload_dir = normalize_rel_path(&request.manifest.payload_dir, true)?;

    // Target dir: "dist/{project_name}"
    let is_absolute_output = advanced_mode && Path::new(&request.project_name).is_absolute();
    let (dist_root, project_name) = if is_absolute_output {
        let dist_root = PathBuf::from(&request.project_name);
        let project_name = dist_root
            .file_name()
            .ok_or("Absolute output path must include a folder name".to_string())?
            .to_string_lossy()
            .to_string();
        (dist_root, project_name)
    } else {
        let dist_base = resolve_dist_base(&app_handle)?;
        let project_name = validate_project_name(&request.project_name)?;
        let dist_root = dist_base.join(&project_name);
        if !dist_root.starts_with(&dist_base) {
            return Err("Resolved output path escaped dist/".to_string());
        }
        (dist_root, project_name)
    };
    
    // Clean/Create dist
    if dist_root.exists() {
        if is_absolute_output {
            let marker = dist_root.join(".misfit-studio");
            if !marker.exists() && !force_overwrite {
                return Err(format!(
                    "Refusing to overwrite {} (missing .misfit-studio marker). Create the folder and add .misfit-studio to confirm.",
                    dist_root.display()
                ));
            }
        }
        std::fs::remove_dir_all(&dist_root).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&dist_root).map_err(|e| e.to_string())?;
    if is_absolute_output {
        let marker = dist_root.join(".misfit-studio");
        let _ = std::fs::write(marker, "Misfit Studio output");
    }

    // 1. Copy Executable (Self-Replication)
    let dest_exe = dist_root.join(format!("{}.exe", project_name));
    std::fs::copy(&exe_path, &dest_exe).map_err(|e| format!("Failed to copy executable: {}", e))?;

    // 2. Write Manifest
    let manifest_dir = dist_root.join("manifests");
    std::fs::create_dir_all(&manifest_dir).map_err(|e| e.to_string())?;
    let manifest_path = manifest_dir.join("install.manifest.json");
    let manifest_json = serde_json::to_string_pretty(&request.manifest).map_err(|e| e.to_string())?;
    std::fs::write(&manifest_path, manifest_json).map_err(|e| e.to_string())?;

    // 3. Copy Payloads
    let payloads_dir = dist_root.join(&payload_dir); // e.g. "payloads" or "."
    std::fs::create_dir_all(&payloads_dir).map_err(|e| e.to_string())?;

    for (src, relative_dest) in request.payload_files {
        let src_path = resolve_payload_source(&src);
        let dest_rel = normalize_rel_path(&relative_dest, false)?;
        let dest_path = payloads_dir.join(dest_rel);
        if src_path.exists() {
             engine::copy_payload(&src_path, &dest_path).map_err(|e| format!("Failed to copy payload {}: {}", src_path.display(), e))?;
        } else {
             return Err(format!("Payload source not found: {:?}", src_path));
        }
    }

    let msg = format!("Project built successfully at: {}", dist_root.display());
    app_handle.emit("log", &msg).map_err(|e| e.to_string())?;
    
    Ok(dist_root.to_string_lossy().to_string())
}

#[tauri::command]
async fn restore_backup(app_name: Option<String>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let text_doc_dir = app_handle.path().document_dir().map_err(|e| e.to_string())?;
    let fallback_root = text_doc_dir.join("MisfitBackups");
    let backup_root = if let Some(name) = app_name.as_deref() {
        fallback_root.join(backup_namespace(name))
    } else {
        fallback_root.clone()
    };
    app_handle.emit("log", format!("Attempting restore from {:?}", backup_root)).map_err(|e| e.to_string())?;

    let restored_from = match engine::restore_latest_backup(&backup_root) {
        Ok(path) => path,
        Err(err) => {
            if app_name.is_some() && backup_root != fallback_root {
                let _ = app_handle.emit(
                    "log",
                    format!("No app-specific backups found, falling back to {:?}", fallback_root),
                );
                engine::restore_latest_backup(&fallback_root).map_err(|e| e.to_string())?
            } else {
                return Err(err.to_string());
            }
        }
    };
    
    app_handle.emit("log", format!("Restored successfully from {}", restored_from)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn run_install(manifest: engine::InstallManifest, app_handle: tauri::AppHandle) -> Result<(), String> {
    let (manifest_path, project_root) = resolve_manifest_info(&app_handle).ok_or("Manifest not found")?;
    let manifest_dir = manifest_path.parent().unwrap_or(Path::new(".")).to_path_buf();
    let payload_dir = normalize_rel_path(&manifest.payload_dir, true)?;
    let advanced_mode = manifest.advanced_mode.unwrap_or(false);

    let payload_source = project_root.join(&payload_dir);
    if !payload_source.exists() {
        return Err(format!("Payload directory not found: {}", payload_source.display()));
    }
    
    // Backup first
    let mut backup_paths = Vec::new();
    for step in &manifest.install_steps {
        match step {
            engine::InstallStep::PatchBlock { file, .. } => {
                let resolved = resolve_path(&manifest_dir, file);
                backup_paths.push(resolved.to_string_lossy().to_string());
            }
            engine::InstallStep::SetJsonValue { file, .. } => {
                let resolved = resolve_path(&manifest_dir, file);
                backup_paths.push(resolved.to_string_lossy().to_string());
            }
            engine::InstallStep::Base64Embed { file, .. } => {
                let resolved = resolve_path(&manifest_dir, file);
                backup_paths.push(resolved.to_string_lossy().to_string());
            }
            _ => {}
        }
    }
    backup_paths.sort();
    backup_paths.dedup();

    let text_doc_dir = app_handle.path().document_dir().map_err(|e| e.to_string())?;
    let backup_root = text_doc_dir
        .join("MisfitBackups")
        .join(backup_namespace(&manifest.app_name));
    
    if !backup_paths.is_empty() {
        let _backup_loc = engine::backup_files(&backup_paths, &backup_root).map_err(|e| e.to_string())?;
        app_handle.emit("log", format!("Backup created at {:?}", _backup_loc)).map_err(|e| e.to_string())?;
    }

    for step in manifest.install_steps {
        match step {
            engine::InstallStep::Copy { src, dest } => {
                let src_rel = normalize_rel_path(&src, false)?;
                let s = payload_source.join(src_rel);
                let d = resolve_path(&manifest_dir, &dest);
                app_handle.emit("log", format!("Copying {:?} to {:?}", s, d)).map_err(|e| e.to_string())?;
                engine::copy_payload(&s, &d).map_err(|e| e.to_string())?;
            },
            engine::InstallStep::PatchBlock { file, start_marker, end_marker, content_file, replacements } => {
                let target_path = resolve_path(&manifest_dir, &file);
                app_handle.emit("log", format!("Patching {}", target_path.display())).map_err(|e| e.to_string())?;
                let content_file = content_file.ok_or("PatchBlock requires contentFile".to_string())?;
                let content_rel = normalize_rel_path(&content_file, false)?;
                let content_path = payload_source.join(content_rel);
                let mut content = std::fs::read_to_string(&content_path)
                    .map_err(|e| format!("Failed to read patch content {}: {}", content_path.display(), e))?;
                if let Some(reps) = replacements {
                    for (k, v) in reps {
                        content = content.replace(&k, &v);
                    }
                }
                engine::patch_file(&target_path, &start_marker, &end_marker, &content, advanced_mode).map_err(|e| e.to_string())?;
            },
            engine::InstallStep::SetJsonValue { file, key_path, value } => {
                let target_path = resolve_path(&manifest_dir, &file);
                app_handle.emit("log", format!("Updating JSON {} key {}", target_path.display(), key_path)).map_err(|e| e.to_string())?;
                engine::set_json_value(&target_path, &key_path, &value).map_err(|e| e.to_string())?;
            },
             engine::InstallStep::RunCommand { command, args } => {
                app_handle.emit("log", format!("Running command: {} {:?}", command, args)).map_err(|e| e.to_string())?;
                engine::run_command(&command, &args).map_err(|e| e.to_string())?;
            },
            engine::InstallStep::Base64Embed { file, placeholder, input_file } => {
                 let target_path = resolve_path(&manifest_dir, &file);
                 app_handle.emit("log", format!("Embedding base64 into {}", target_path.display())).map_err(|e| e.to_string())?;
                 let input_rel = normalize_rel_path(&input_file, false)?;
                 let input_path = payload_source.join(input_rel);
                 engine::base64_embed(&target_path, &placeholder, &input_path).map_err(|e| e.to_string())?;
            }
        }
    }
    
    app_handle.emit("log", "Installation complete!".to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
        get_app_mode,
        get_manifest,
        inspect_build_target,
        resolve_payload_root,
        run_install,
        restore_backup,
        build_project,
        read_text_file,
        write_text_file,
        scan_extension_folders
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
