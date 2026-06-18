// services/query_service.rs
// Ejecuta queries en la conexión correcta y guarda el historial

use crate::drivers::traits::QueryResult;
use crate::services::connection_service::ConnectionService;

pub struct QueryService;

impl QueryService {
    /// Ejecuta un query SQL en una conexión activa por id
    pub async fn execute(
        conn_service: &ConnectionService,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResult, String> {
        let driver = conn_service
            .get(connection_id)
            .ok_or_else(|| format!("Conexión '{}' no está activa", connection_id))?;

        driver.execute_query(sql).await
    }
}
