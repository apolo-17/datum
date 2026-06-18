// drivers/sqlite.rs
use async_trait::async_trait;
use crate::drivers::traits::*;

pub struct SqliteDriver {
    connected: bool,
}

impl SqliteDriver {
    pub fn new() -> Self {
        Self { connected: false }
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    async fn connect(&mut self, _config: &ConnectionConfig) -> Result<(), String> {
        self.connected = true;
        Ok(())
    }
    async fn disconnect(&mut self) -> Result<(), String> {
        self.connected = false;
        Ok(())
    }
    async fn execute_query(&self, _sql: &str) -> Result<QueryResult, String> {
        Err("SQLite driver en construcción".to_string())
    }
    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(vec!["main".to_string()])
    }
    async fn get_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec!["main".to_string()])
    }
    async fn get_tables(&self, _schema: &str) -> Result<Vec<TableSchema>, String> {
        Ok(vec![])
    }
    fn driver_name(&self) -> &str { "SQLite" }
    fn is_connected(&self) -> bool { self.connected }
}
