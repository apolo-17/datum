// models/connection.rs
// Modelo de una conexión guardada por el usuario

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,           // "prod-postgres", "local-dev"
    pub driver: DriverType,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub use_ssl: bool,
    pub use_ssh: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DriverType {
    PostgreSQL,
    MySQL,
    SQLite,
    SqlServer,
}

impl DriverType {
    pub fn default_port(&self) -> u16 {
        match self {
            DriverType::PostgreSQL => 5432,
            DriverType::MySQL     => 3306,
            DriverType::SQLite    => 0,
            DriverType::SqlServer => 1433,
        }
    }
}
