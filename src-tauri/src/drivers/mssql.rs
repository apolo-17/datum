// drivers/mssql.rs
use async_trait::async_trait;
use crate::drivers::traits::*;

pub struct MssqlDriver {
    connected: bool,
}

impl MssqlDriver {
    pub fn new() -> Self {
        Self { connected: false }
    }
}

#[async_trait]
impl DatabaseDriver for MssqlDriver {
    async fn connect(&mut self, _config: &ConnectionConfig) -> Result<(), String> {
        self.connected = true;
        Ok(())
    }
    async fn disconnect(&mut self) -> Result<(), String> {
        self.connected = false;
        Ok(())
    }
    async fn execute_query(&self, _sql: &str) -> Result<QueryResult, String> {
        Err("SQL Server driver en construcción".to_string())
    }
    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Err("SQL Server driver en construcción".to_string())
    }
    async fn get_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec!["dbo".to_string()])
    }
    async fn get_tables(&self, _schema: &str) -> Result<Vec<TableSchema>, String> {
        Ok(vec![])
    }
    fn driver_name(&self) -> &str { "SQL Server" }
    fn is_connected(&self) -> bool { self.connected }
}
