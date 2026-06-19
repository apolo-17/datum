/// Escribe contenido en la ruta exacta que elige el usuario (vía diálogo nativo).
#[tauri::command]
pub fn write_file_to_path(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

/// Fallback: escribe en ~/Downloads cuando no hay diálogo disponible.
#[tauri::command]
pub fn write_export_file(filename: String, content: String) -> Result<String, String> {
    let dir = downloads_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&filename);
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn downloads_dir() -> std::path::PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        let d = std::path::PathBuf::from(home).join("Downloads");
        if d.exists() { return d; }
    }
    if let Ok(up) = std::env::var("USERPROFILE") {
        let d = std::path::PathBuf::from(up).join("Downloads");
        if d.exists() { return d; }
    }
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
}
