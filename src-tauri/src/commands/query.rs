// commands/query.rs
// Comandos Tauri para ejecutar queries desde la UI

use tauri::State;
use tokio::sync::Mutex;
use crate::services::connection_service::ConnectionService;
use crate::services::query_service::QueryService;
use crate::drivers::traits::QueryResult;

/// La UI llama a este comando cuando el usuario presiona "Run"
#[tauri::command]
pub async fn execute_query(
    connection_id: String,
    sql: String,
    state: State<'_, Mutex<ConnectionService>>,
) -> Result<QueryResult, String> {
    let service = state.lock().await;
    QueryService::execute(&service, &connection_id, &sql).await
}
