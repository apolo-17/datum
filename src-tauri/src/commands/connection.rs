// commands/connection.rs

use tauri::State;
use tokio::sync::Mutex;
use crate::services::connection_service::ConnectionService;
use crate::models::connection::SavedConnection;
use crate::drivers::traits::{TableSchema};

#[tauri::command]
pub async fn open_connection(
    connection: SavedConnection,
    password: String,
    state: State<'_, Mutex<ConnectionService>>,
) -> Result<String, String> {
    let mut service = state.lock().await;
    service.open(&connection, &password).await?;
    Ok(format!("Conectado a {}", connection.name))
}

#[tauri::command]
pub async fn close_connection(
    connection_id: String,
    state: State<'_, Mutex<ConnectionService>>,
) -> Result<(), String> {
    let mut service = state.lock().await;
    service.close(&connection_id).await
}

#[tauri::command]
pub async fn list_databases(
    connection_id: String,
    state: State<'_, Mutex<ConnectionService>>,
) -> Result<Vec<String>, String> {
    let service = state.lock().await;
    let driver = service.get(&connection_id)
        .ok_or_else(|| format!("Conexión '{}' no activa", connection_id))?;
    driver.list_databases().await
}

#[tauri::command]
pub async fn get_schemas(
    connection_id: String,
    state: State<'_, Mutex<ConnectionService>>,
) -> Result<Vec<String>, String> {
    let service = state.lock().await;
    crate::services::schema_service::SchemaService::get_schemas(&service, &connection_id).await
}

#[tauri::command]
pub async fn get_tables(
    connection_id: String,
    schema: String,
    state: State<'_, Mutex<ConnectionService>>,
) -> Result<Vec<TableSchema>, String> {
    let service = state.lock().await;
    crate::services::schema_service::SchemaService::get_tables(&service, &connection_id, &schema).await
}
