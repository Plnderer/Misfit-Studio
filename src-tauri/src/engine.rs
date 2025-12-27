use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::fs;
use anyhow::{Context, Result, anyhow};
use std::process::Command;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallManifest {
    pub app_name: String,
    pub version: String,
    pub publisher: String,
    pub description: String,
    pub logo_path: Option<String>,
    pub advanced_mode: Option<bool>,
    pub targets: Vec<String>,
    pub payload_dir: String,
    pub install_steps: Vec<InstallStep>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InstallStep {
    Copy { src: String, dest: String },
    PatchBlock { 
        file: String, 
        #[serde(rename = "startMarker")]
        start_marker: String, 
        #[serde(rename = "endMarker")]
        end_marker: String, 
        #[serde(rename = "contentFile")]
        content_file: Option<String>, 
        replacements: Option<std::collections::HashMap<String, String>> 
    },
    SetJsonValue { 
        file: String, 
        #[serde(rename = "keyPath")]
        key_path: String, 
        value: serde_json::Value 
    },
    RunCommand { command: String, args: Vec<String> },
    Base64Embed { 
        file: String, 
        placeholder: String, 
        #[serde(rename = "inputFile")]
        input_file: String 
    },
}

pub fn load_manifest(path: &Path) -> Result<InstallManifest> {
    let content = fs::read_to_string(path).context(format!("Failed to read manifest file at {:?}", path))?;
    
    // Strip BOM if present
    let content = content.strip_prefix("\u{feff}").unwrap_or(&content);

    let manifest: InstallManifest = serde_json::from_str(content)
        .map_err(|e| anyhow!("Failed to parse manifest: {}. Content snippet: {:.50}...", e, content))?;
    Ok(manifest)
}

fn sanitize_component_name(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() { "_".to_string() } else { out }
}

fn backup_rel_path(path: &Path) -> Result<PathBuf> {
    let abs_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut rel = PathBuf::new();
    rel.push("abs");

    for component in abs_path.components() {
        match component {
            Component::Prefix(prefix) => {
                let prefix_str = prefix.as_os_str().to_string_lossy();
                rel.push(sanitize_component_name(&prefix_str));
            }
            Component::RootDir => {},
            Component::CurDir => {},
            Component::ParentDir => {},
            Component::Normal(os) => rel.push(os),
        }
    }

    if rel.as_os_str().is_empty() {
        return Err(anyhow!("Failed to build backup path"));
    }
    Ok(rel)
}

pub fn backup_files(paths: &[String], backup_root: &Path) -> Result<PathBuf> {
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_dir = backup_root.join(format!("backup_{}", timestamp));
    fs::create_dir_all(&backup_dir).context("Failed to create backup directory")?;

    let mut restore_map: HashMap<String, String> = HashMap::new();

    for path_str in paths {
        let path = Path::new(path_str);
        if path.exists() {
            let backup_rel = backup_rel_path(path)?;
            let dest = backup_dir.join(&backup_rel);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            if path.is_dir() {
                copy_recursively(path, &dest)?;
            } else {
                fs::copy(path, &dest)?;
            }
            // Store absolute path in map
            let abs_path = fs::canonicalize(path).unwrap_or(path.to_path_buf());
            restore_map.insert(backup_rel.to_string_lossy().to_string(), abs_path.to_string_lossy().to_string());
        }
    }
    
    // Save restore map
    let map_json = serde_json::to_string_pretty(&restore_map)?;
    fs::write(backup_dir.join("restore_map.json"), map_json)?;

    Ok(backup_dir)
}

pub fn restore_latest_backup(backup_root: &Path) -> Result<String> {
    // Find latest backup dir
    let entries = fs::read_dir(backup_root).context("Backup root not found")?;
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.path())
        .filter(|p| p.file_name().unwrap_or_default().to_string_lossy().starts_with("backup_"))
        .collect();
    
    dirs.sort(); // Lexicographical sort works for YYYYMMDD_HHMMSS
    
    let latest = dirs.last().ok_or(anyhow!("No backups found"))?;
    
    // Load map
    let map_path = latest.join("restore_map.json");
    if !map_path.exists() {
        return Err(anyhow!("Restore map not found in latest backup"));
    }
    
    let map_content = fs::read_to_string(&map_path)?;
    let restore_map: HashMap<String, String> = serde_json::from_str(&map_content)?;
    
    for (backup_rel, target_path_str) in restore_map {
        let src = latest.join(&backup_rel);
        let dest = PathBuf::from(&target_path_str);
        
        if src.exists() {
             if src.is_dir() {
                 copy_recursively(&src, &dest)?;
             } else {
                 if let Some(parent) = dest.parent() {
                     fs::create_dir_all(parent)?;
                 }
                 fs::copy(&src, &dest)?;
             }
        }
    }
    
    Ok(latest.to_string_lossy().to_string())
}

pub fn copy_payload(src: &Path, dest: &Path) -> Result<()> {
    if src.is_dir() {
        copy_recursively(src, dest)?;
    } else {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dest)?;
    }
    Ok(())
}

fn copy_recursively(source: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let filetype = entry.file_type()?;
        if filetype.is_dir() {
            copy_recursively(&entry.path(), &destination.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), destination.join(entry.file_name()))?;
        }
    }
    Ok(())
}

pub fn patch_file(target: &Path, start_marker: &str, end_marker: &str, content: &str, strip_markers: bool) -> Result<()> {
    let file_content = fs::read_to_string(target).context("Failed to read target file for patching")?;
    let start_idx = file_content.find(start_marker).ok_or_else(|| anyhow!("Start marker not found"))?;
    let search_start = start_idx + start_marker.len();
    let end_rel = file_content[search_start..].find(end_marker).ok_or_else(|| anyhow!("End marker not found"))?;
    let end_idx = search_start + end_rel;

    let mut new_content = String::new();
    if strip_markers {
        new_content.push_str(&file_content[..start_idx]);
    } else {
        new_content.push_str(&file_content[..search_start]);
    }
    new_content.push_str(content);
    if strip_markers {
        new_content.push_str(&file_content[end_idx + end_marker.len()..]);
    } else {
        new_content.push_str(&file_content[end_idx..]);
    }

    fs::write(target, new_content).context("Failed to write patched file")?;
    Ok(())
}

pub fn set_json_value(target: &Path, key_path: &str, value: &serde_json::Value) -> Result<()> {
    let content = if target.exists() {
        fs::read_to_string(target).context("Failed to read JSON file")?
    } else {
        "{}".to_string()
    };
    let mut json_val: serde_json::Value = serde_json::from_str(&content).context("Failed to parse JSON")?;

    let parts = split_key_path(key_path)?;
    let mut current = &mut json_val;

    for (i, part) in parts.iter().enumerate() {
        if i == parts.len() - 1 {
            if let Some(obj) = current.as_object_mut() {
                obj.insert(part.to_string(), value.clone());
            } else {
                return Err(anyhow!("Target path is not an object"));
            }
        } else {
            if !current.is_object() {
                 return Err(anyhow!("Path traversal failed, not an object"));
            }
            if current.get(part).is_none() {
                 if let Some(obj) = current.as_object_mut() {
                    obj.insert(part.to_string(), serde_json::json!({}));
                 }
            }
            current = current.get_mut(part).unwrap();
        }
    }

    let new_content = serde_json::to_string_pretty(&json_val)?;
    fs::write(target, new_content)?;
    Ok(())
}

fn split_key_path(key_path: &str) -> Result<Vec<String>> {
    let trimmed = key_path.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("Key path cannot be empty"));
    }

    let mut parts = Vec::new();
    let mut current = String::new();
    let mut escaped = false;

    for ch in trimmed.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '.' {
            if current.is_empty() {
                return Err(anyhow!("Key path contains an empty segment"));
            }
            parts.push(current);
            current = String::new();
            continue;
        }
        current.push(ch);
    }

    if escaped {
        return Err(anyhow!("Key path ends with an escape character"));
    }
    if current.is_empty() {
        return Err(anyhow!("Key path contains an empty segment"));
    }
    parts.push(current);

    Ok(parts)
}

pub fn run_command(cmd: &str, args: &[String]) -> Result<()> {
    let status = Command::new(cmd)
        .args(args)
        .status()
        .context(format!("Failed to execute command: {}", cmd))?;

    if !status.success() {
        return Err(anyhow!("Command exited with failure status"));
    }
    Ok(())
}

pub fn base64_embed(target: &Path, placeholder: &str, input_file: &Path) -> Result<()> {
    let input_bytes = fs::read(input_file).context("Failed to read input file for embedding")?;
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(input_bytes);

    let target_content = fs::read_to_string(target).context("Failed to read target file for embedding")?;
    let new_content = target_content.replace(placeholder, &encoded);

    fs::write(target, new_content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::split_key_path;

    #[test]
    fn split_key_path_basic() {
        let parts = split_key_path("theme.colors.primary").expect("valid path");
        assert_eq!(parts, vec!["theme", "colors", "primary"]);
    }

    #[test]
    fn split_key_path_escaped_dot() {
        let parts = split_key_path("workbench\\.colorTheme").expect("valid path");
        assert_eq!(parts, vec!["workbench.colorTheme"]);
    }

    #[test]
    fn split_key_path_mixed_escape() {
        let parts = split_key_path("workbench\\.colorTheme.ui").expect("valid path");
        assert_eq!(parts, vec!["workbench.colorTheme", "ui"]);
    }

    #[test]
    fn split_key_path_trailing_escape_is_error() {
        let err = split_key_path("workbench\\.colorTheme\\").unwrap_err();
        assert!(err.to_string().contains("escape"));
    }

    #[test]
    fn split_key_path_empty_segment_is_error() {
        let err = split_key_path("workbench..colorTheme").unwrap_err();
        assert!(err.to_string().contains("empty segment"));
    }
}
