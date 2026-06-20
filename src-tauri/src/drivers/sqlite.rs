// drivers/sqlite.rs — driver real de SQLite usando sqlx

use async_trait::async_trait;
use sqlx::{sqlite::SqlitePoolOptions, Column, Row, SqlitePool, TypeInfo};
use serde_json::{json, Value};
use std::time::Instant;

use crate::drivers::traits::*;

pub struct SqliteDriver {
    pool: Option<SqlitePool>,
}

impl SqliteDriver {
    pub fn new() -> Self {
        Self { pool: None }
    }

    fn decode_cell(row: &sqlx::sqlite::SqliteRow, idx: usize) -> Value {
        let type_name = row.column(idx).type_info().name().to_uppercase();
        match type_name.as_str() {
            "INTEGER" | "INT" =>
                row.try_get::<i64, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "REAL" | "FLOAT" | "DOUBLE" =>
                row.try_get::<f64, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "BOOLEAN" =>
                row.try_get::<bool, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "BLOB" =>
                row.try_get::<Vec<u8>, _>(idx)
                    .map(|v| json!(format!("<blob {} bytes>", v.len())))
                    .unwrap_or(Value::Null),
            _ =>
                row.try_get::<String, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
        }
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), String> {
        // Para SQLite, el "host" o "database" es la ruta al archivo .db
        let path = if !config.database.is_empty() {
            config.database.clone()
        } else if !config.host.is_empty() {
            config.host.clone()
        } else {
            return Err("SQLite requiere la ruta al archivo .db".to_string());
        };

        // Rutas absolutas necesitan sqlite:///ruta (3 slashes = protocolo + path absoluto)
        let url = if path.starts_with('/') || path.starts_with('\\') {
            format!("sqlite://{}", path)   // sqlite:// + /ruta = sqlite:///ruta
        } else {
            format!("sqlite:{}", path)
        };
        eprintln!("[SQLite] path='{}' url='{}'", path, url);

        let pool = SqlitePoolOptions::new()
            .max_connections(1)   // SQLite es single-writer
            .connect(&url)
            .await
            .map_err(|e| format!("No se pudo abrir SQLite: {}", e))?;

        self.pool = Some(pool);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), String> {
        if let Some(pool) = self.pool.take() {
            pool.close().await;
        }
        Ok(())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let pool = self.pool.as_ref().ok_or("Sin conexión activa")?;
        let start = Instant::now();

        let rows = sqlx::query(sql)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Error en query: {}", e))?;

        let elapsed = start.elapsed().as_millis() as u64;

        if rows.is_empty() {
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: 0,
                execution_time_ms: elapsed,
            });
        }

        let columns: Vec<ColumnMeta> = rows[0]
            .columns()
            .iter()
            .map(|col| ColumnMeta {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_lowercase(),
            })
            .collect();

        let result_rows: Vec<Vec<Value>> = rows
            .iter()
            .map(|row| {
                (0..row.columns().len())
                    .map(|i| Self::decode_cell(row, i))
                    .collect()
            })
            .collect();

        let rows_affected = result_rows.len() as u64;

        Ok(QueryResult {
            columns,
            rows: result_rows,
            rows_affected,
            execution_time_ms: elapsed,
        })
    }

    // SQLite no tiene múltiples databases; devolvemos "main" como convención
    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(vec!["main".to_string()])
    }

    // SQLite no tiene schemas; devolvemos "main"
    async fn get_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec!["main".to_string()])
    }

    async fn get_tables(&self, _schema: &str) -> Result<Vec<TableSchema>, String> {
        let pool = self.pool.as_ref().ok_or("Sin conexión activa")?;

        // Lista de tablas (excluye tablas internas de SQLite)
        let table_rows = sqlx::query(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name"
        )
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        let table_names: Vec<String> = table_rows.iter().map(|r| r.get(0)).collect();
        if table_names.is_empty() { return Ok(vec![]); }

        let mut tables = Vec::new();

        for table_name in &table_names {
            // PRAGMA table_info devuelve: cid, name, type, notnull, dflt_value, pk
            let pragma_sql = format!("PRAGMA table_info(\"{}\")", table_name);
            let col_rows = sqlx::query(&pragma_sql)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;

            // PRAGMA foreign_key_list devuelve: id, seq, table, from, to, ...
            let fk_sql = format!("PRAGMA foreign_key_list(\"{}\")", table_name);
            let fk_rows = sqlx::query(&fk_sql)
                .fetch_all(pool)
                .await
                .unwrap_or_default();

            // fk_map: col_name → (ref_table, ref_col)
            use std::collections::HashMap;
            let fk_map: HashMap<String, (String, String)> = fk_rows.iter()
                .map(|r| {
                    let from_col: String = r.get(3);
                    let ref_table: String = r.get(2);
                    let ref_col: String = r.get(4);
                    (from_col, (ref_table, ref_col))
                })
                .collect();

            let columns: Vec<ColumnSchema> = col_rows.iter().map(|r| {
                let name: String = r.get(1);
                let data_type: String = r.get(2);
                let not_null: i32 = r.get(3);
                let pk: i32 = r.get(5);
                let is_fk = fk_map.contains_key(&name);
                let (ref_table, ref_col) = fk_map.get(&name)
                    .map(|(t, c)| (Some(t.clone()), Some(c.clone())))
                    .unwrap_or((None, None));

                ColumnSchema {
                    name,
                    data_type: data_type.to_lowercase(),
                    nullable: not_null == 0,
                    is_primary_key: pk > 0,
                    is_foreign_key: is_fk,
                    references_table: ref_table,
                    references_column: ref_col,
                }
            }).collect();

            tables.push(TableSchema {
                name: table_name.clone(),
                schema: "main".to_string(),
                columns,
            });
        }

        Ok(tables)
    }

    fn driver_name(&self) -> &str { "SQLite" }

    fn is_connected(&self) -> bool {
        self.pool.as_ref().map(|p| !p.is_closed()).unwrap_or(false)
    }
}
