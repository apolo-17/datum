// drivers/mod.rs
// Capa de Drivers — un módulo por motor de base de datos

pub mod traits;
pub mod postgres;
pub mod mysql;
pub mod sqlite;
pub mod mssql;

#[allow(unused_imports)]
pub use traits::{DatabaseDriver, ConnectionConfig, QueryResult, ColumnMeta, TableSchema, ColumnSchema};
