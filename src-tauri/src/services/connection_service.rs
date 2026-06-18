// services/connection_service.rs
// Maneja el ciclo de vida de las conexiones activas

use crate::models::connection::{SavedConnection, DriverType};
use crate::drivers::traits::{DatabaseDriver, ConnectionConfig};
use crate::drivers::{postgres::PostgresDriver, mysql::MySqlDriver, sqlite::SqliteDriver, mssql::MssqlDriver};
use std::collections::HashMap;

pub struct ConnectionService {
    // Conexiones activas en memoria: id -> driver
    active: HashMap<String, Box<dyn DatabaseDriver>>,
}

impl ConnectionService {
    pub fn new() -> Self {
        Self { active: HashMap::new() }
    }

    /// Abre una conexión y la mantiene activa para queries posteriores
    pub async fn open(&mut self, conn: &SavedConnection, password: &str) -> Result<(), String> {
        let config = ConnectionConfig {
            host: conn.host.clone(),
            port: conn.port,
            database: conn.database.clone(),
            username: conn.username.clone(),
            password: password.to_string(),
            ssl: conn.use_ssl,
            ssh_tunnel: None,
        };

        let mut driver: Box<dyn DatabaseDriver> = match conn.driver {
            DriverType::PostgreSQL => Box::new(PostgresDriver::new()),
            DriverType::MySQL      => Box::new(MySqlDriver::new()),
            DriverType::SQLite     => Box::new(SqliteDriver::new()),
            DriverType::SqlServer  => Box::new(MssqlDriver::new()),
        };

        driver.connect(&config).await?;
        self.active.insert(conn.id.clone(), driver);
        Ok(())
    }

    /// Cierra una conexión activa
    pub async fn close(&mut self, id: &str) -> Result<(), String> {
        if let Some(driver) = self.active.get_mut(id) {
            driver.disconnect().await?;
            self.active.remove(id);
        }
        Ok(())
    }

    /// Devuelve referencia al driver activo para ejecutar queries
    pub fn get(&self, id: &str) -> Option<&Box<dyn DatabaseDriver>> {
        self.active.get(id)
    }
}
