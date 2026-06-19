// commands/keychain.rs
// Guarda y recupera contraseñas del keychain del SO:
//   macOS  → Keychain Access
//   Windows → Credential Manager
//   Linux  → libsecret / KWallet

const SERVICE: &str = "datum";

#[tauri::command]
pub fn save_password(connection_id: String, password: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &connection_id)
        .map_err(|e| e.to_string())?;
    entry.set_password(&password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_password(connection_id: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE, &connection_id)
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pwd)                          => Ok(Some(pwd)),
        Err(keyring::Error::NoEntry)     => Ok(None),
        Err(e)                           => Err(e.to_string()),
    }
}

/// Carga TODAS las contraseñas de una vez en un solo bloqueo del keychain.
/// Evita que macOS muestre N diálogos de autorización al arrancar.
#[tauri::command]
pub fn load_all_passwords(connection_ids: Vec<String>) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for id in connection_ids {
        let Ok(entry) = keyring::Entry::new(SERVICE, &id) else { continue };
        if let Ok(pwd) = entry.get_password() {
            map.insert(id, pwd);
        }
    }
    map
}

#[tauri::command]
pub fn delete_password(connection_id: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, &connection_id)
        .map_err(|e| e.to_string())?;
    match entry.delete_password() {
        Ok(_)                            => Ok(()),
        Err(keyring::Error::NoEntry)     => Ok(()),
        Err(e)                           => Err(e.to_string()),
    }
}
