use crate::error::AppError;
use crate::models::fs_types::{DirEntry, DriveInfo};
use std::path::Path;

const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "ico", "svg",
];

pub fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[cfg(windows)]
pub fn list_drives() -> Result<Vec<DriveInfo>, AppError> {
    use windows::Win32::Storage::FileSystem::GetLogicalDriveStringsW;

    let mut buffer = [0u16; 256];
    let len = unsafe { GetLogicalDriveStringsW(Some(&mut buffer)) };

    if len == 0 {
        return Err("Failed to list drives".into());
    }

    let mut drives = Vec::new();
    let mut start = 0;

    for i in 0..len as usize {
        if buffer[i] == 0 {
            if i > start {
                let drive_str = String::from_utf16_lossy(&buffer[start..i]);
                let name = drive_str.trim_end_matches('\\').to_string();
                drives.push(DriveInfo {
                    name: name.clone(),
                    path: drive_str,
                });
            }
            start = i + 1;
        }
    }

    Ok(drives)
}

#[cfg(not(windows))]
pub fn list_drives() -> Result<Vec<DriveInfo>, AppError> {
    Ok(vec![DriveInfo {
        name: "/".to_string(),
        path: "/".to_string(),
    }])
}

pub fn list_directory(path: &str) -> Result<Vec<DirEntry>, AppError> {
    let dir_path = Path::new(path);
    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path).into());
    }

    let mut entries = Vec::new();

    let read_dir = std::fs::read_dir(dir_path).map_err(|e| AppError {
        message: format!("Cannot read directory {}: {}", path, e),
    })?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/folders
        if name.starts_with('.') {
            continue;
        }

        let entry_path = entry.path().to_string_lossy().to_string();

        if file_type.is_dir() {
            entries.push(DirEntry {
                name,
                path: entry_path,
                is_dir: true,
            });
        }
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

pub fn list_image_files(path: &str) -> Result<Vec<std::path::PathBuf>, AppError> {
    Ok(list_image_files_with_meta(path)?
        .into_iter()
        .map(|(p, _, _)| p)
        .collect())
}

/// List image files with metadata (size, modified timestamp).
/// Uses DirEntry::file_type() and DirEntry::metadata() which are free on Windows
/// (no extra syscall — data comes from FindNextFile).
pub fn list_image_files_with_meta(path: &str) -> Result<Vec<(std::path::PathBuf, u64, i64)>, AppError> {
    let dir_path = Path::new(path);
    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path).into());
    }

    let mut images = Vec::new();

    let read_dir = std::fs::read_dir(dir_path).map_err(|e| AppError {
        message: format!("Cannot read directory {}: {}", path, e),
    })?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        if !ft.is_file() {
            continue;
        }

        let path = entry.path();
        if !is_image_file(&path) {
            continue;
        }

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let size = meta.len();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0) as i64;

        images.push((path, size, modified));
    }

    images.sort_by(|a, b| {
        a.0.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
            .cmp(
                &b.0
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase(),
            )
    });

    Ok(images)
}

pub fn path_exists(path: &str) -> bool {
    Path::new(path).is_dir()
}

pub fn autocomplete_path(partial: &str) -> Result<Vec<String>, AppError> {
    let path = Path::new(partial);
    let (parent, prefix) = if partial.ends_with(std::path::MAIN_SEPARATOR) || partial.ends_with('/') {
        (path, "")
    } else {
        match path.parent() {
            Some(p) => {
                // If parent is empty, it might be a relative path or just a name.
                // But for absolute paths on Windows (e.g. "C:"), parent might be empty string or behaving oddly.
                // If partial is "C:", parent is likely "" or matching behavior.
                // Let's rely on standard logic: if it has no parent, we might be at root or relative.
                // If p is empty, and we are not at root, maybe we should try current dir?
                // But we usually want absolute paths.
                (p, path.file_name().and_then(|s| s.to_str()).unwrap_or(""))
            }
            None => return Ok(Vec::new()),
        }
    };

    // If parent is empty string, we can't really list it unless we assume current dir,
    // but for a file explorer we usually start with drives or absolute paths.
    // However, if the user types "C", parent is empty? No, "C" file_name is "C".
    // If user types "C:", parent might be... let's check.
    // "C:" join "" -> "C:".
    // On Windows, listing "" or "." might be valid.
    
    // Safety check: if parent doesn't exist, return empty
    if !parent.exists() {
        return Ok(Vec::new());
    }

    let read_dir = std::fs::read_dir(parent).map_err(|e| AppError {
        message: format!("Cannot read directory {}: {}", parent.display(), e),
    })?;

    let mut matches = Vec::new();
    let prefix_lower = prefix.to_lowercase();

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.path().is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        if name.to_lowercase().starts_with(&prefix_lower) {
            matches.push(entry.path().to_string_lossy().to_string());
        }
    }

    matches.truncate(10);
    matches.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    
    Ok(matches)
}
