// drivers/traits.rs
// El contrato que TODOS los drivers deben cumplir.
// Si agregas un nuevo motor de DB, implementas este trait — nada más.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Configuración de conexión genérica para cualquier motor de DB
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl: bool,
    pub ssh_tunnel: Option<SshTunnelConfig>,
}

/// Configuración opcional de SSH tunnel para conectarse a servidores remotos
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub key_path: String,
}

/// Resultado de cualquier query ejecutado
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub rows_affected: u64,
    pub execution_time_ms: u64,
}

/// Metadata de una columna en el resultado
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
}

/// Representación de una tabla en el schema (usada para el ERD)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableSchema {
    pub name: String,
    pub schema: String,
    pub columns: Vec<ColumnSchema>,
}

/// Detalle de una columna dentro de una tabla
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnSchema {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub references_table: Option<String>,
    pub references_column: Option<String>,
}

/// El trait principal — cualquier driver nuevo debe implementar estos métodos
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    /// Abre la conexión a la base de datos
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), String>;

    /// Cierra la conexión limpiamente
    async fn disconnect(&mut self) -> Result<(), String>;

    /// Ejecuta un query SQL y devuelve los resultados
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String>;

    /// Lista todas las bases de datos disponibles en el servidor
    async fn list_databases(&self) -> Result<Vec<String>, String>;

    /// Lista los schemas disponibles en la DB activa
    async fn get_schemas(&self) -> Result<Vec<String>, String>;

    /// Lista las tablas de un schema con sus columnas (para el ERD)
    async fn get_tables(&self, schema: &str) -> Result<Vec<TableSchema>, String>;

    /// Nombre del motor — "PostgreSQL", "MySQL", etc.
    fn driver_name(&self) -> &str;

    /// Estado de la conexión
    fn is_connected(&self) -> bool;
}
