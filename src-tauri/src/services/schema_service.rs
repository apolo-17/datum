// services/schema_service.rs
// Extrae el schema de la DB para poblar el sidebar y el ERD

use crate::drivers::traits::TableSchema;
use crate::services::connection_service::ConnectionService;

pub struct SchemaService;

impl SchemaService {
    /// Devuelve todas las tablas de un schema — input para el ERD
    pub async fn get_tables(
        conn_service: &ConnectionService,
        connection_id: &str,
        schema: &str,
    ) -> Result<Vec<TableSchema>, String> {
        let driver = conn_service
            .get(connection_id)
            .ok_or_else(|| format!("Conexión '{}' no está activa", connection_id))?;

        driver.get_tables(schema).await
    }

    /// Lista los schemas disponibles en la conexión
    pub async fn get_schemas(
        conn_service: &ConnectionService,
        connection_id: &str,
    ) -> Result<Vec<String>, String> {
        let driver = conn_service
            .get(connection_id)
            .ok_or_else(|| format!("Conexión '{}' no está activa", connection_id))?;

        driver.get_schemas().await
    }
}
