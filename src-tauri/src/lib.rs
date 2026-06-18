mod commands;
mod drivers;
mod models;
mod services;

use tokio::sync::Mutex;
use services::connection_service::ConnectionService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(Mutex::new(ConnectionService::new()))
        .invoke_handler(tauri::generate_handler![
            commands::connection::open_connection,
            commands::connection::close_connection,
            commands::connection::list_databases,
            commands::connection::get_schemas,
            commands::connection::get_tables,
            commands::query::execute_query,
            commands::keychain::save_password,
            commands::keychain::load_password,
            commands::keychain::delete_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running datum");
}
