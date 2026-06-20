// drivers/mysql.rs — driver real de MySQL usando sqlx

use async_trait::async_trait;
use sqlx::{mysql::MySqlPoolOptions, Column, MySqlPool, Row, TypeInfo};
use serde_json::{json, Value};
use std::time::Instant;

use crate::drivers::traits::*;

pub struct MySqlDriver {
    pool: Option<MySqlPool>,
}

impl MySqlDriver {
    pub fn new() -> Self {
        Self { pool: None }
    }

    fn decode_cell(row: &sqlx::mysql::MySqlRow, idx: usize) -> Value {
        let type_name = row.column(idx).type_info().name().to_uppercase();
        match type_name.as_str() {
            "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" =>
                row.try_get::<i32, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "BIGINT" =>
                row.try_get::<i64, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "FLOAT" =>
                row.try_get::<f32, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "DOUBLE" | "REAL" =>
                row.try_get::<f64, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "BOOLEAN" | "BOOL" =>
                row.try_get::<bool, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "DATE" =>
                row.try_get::<chrono::NaiveDate, _>(idx)
                    .map(|v| json!(v.to_string()))
                    .unwrap_or(Value::Null),
            "DATETIME" | "TIMESTAMP" =>
                row.try_get::<chrono::NaiveDateTime, _>(idx)
                    .map(|v| json!(v.format("%Y-%m-%d %H:%M:%S").to_string()))
                    .unwrap_or(Value::Null),
            "JSON" =>
                row.try_get::<Value, _>(idx).unwrap_or(Value::Null),
            _ =>
                row.try_get::<String, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
        }
    }
}

#[async_trait]
impl DatabaseDriver for MySqlDriver {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), String> {
        let db = if config.database.is_empty() { "information_schema" } else { &config.database };

        // ssl-mode=disabled evita el handshake caching_sha2_password de MySQL 8.0
        // sin SSL nativo. Para conexiones remotas con TLS agregar ssl-mode=required.
        let url = format!(
            "mysql://{}:{}@{}:{}/{}?ssl-mode=disabled",
            config.username, config.password, config.host, config.port, db
        );

        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(std::time::Duration::from_secs(10))
            .connect(&url)
            .await
            .map_err(|e| format!("No se pudo conectar a MySQL: {}", e))?;

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

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let pool = self.pool.as_ref().ok_or("Sin conexión activa")?;
        let rows = sqlx::query(
            "SELECT CAST(schema_name AS CHAR) FROM information_schema.schemata
             WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
             ORDER BY schema_name"
        )
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows.iter().map(|r| r.try_get::<String, _>(0).unwrap_or_default()).collect())
    }

    // En MySQL, schemas = databases. Devolvemos la DB activa como único schema.
    async fn get_schemas(&self) -> Result<Vec<String>, String> {
        let pool = self.pool.as_ref().ok_or("Sin conexión activa")?;
        let row = sqlx::query("SELECT CAST(DATABASE() AS CHAR)")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
        let db: Option<String> = row.try_get(0).ok();
        Ok(db.map(|d| vec![d]).unwrap_or_default())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableSchema>, String> {
        let pool = self.pool.as_ref().ok_or("Sin conexión activa")?;

        let table_rows = sqlx::query(
            "SELECT CAST(table_name AS CHAR) FROM information_schema.tables
             WHERE table_schema = ? AND table_type = 'BASE TABLE'
             ORDER BY table_name"
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        let table_names: Vec<String> = table_rows.iter()
            .map(|r| r.try_get::<String, _>(0).unwrap_or_default())
            .collect();
        if table_names.is_empty() { return Ok(vec![]); }

        let col_rows = sqlx::query(
            "SELECT CAST(table_name AS CHAR), CAST(column_name AS CHAR),
                    CAST(data_type AS CHAR), CAST(is_nullable AS CHAR), ordinal_position
             FROM information_schema.columns
             WHERE table_schema = ?
             ORDER BY table_name, ordinal_position"
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        let pk_rows = sqlx::query(
            "SELECT CAST(kcu.table_name AS CHAR), CAST(kcu.column_name AS CHAR)
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema   = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema    = ?"
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        let fk_rows = sqlx::query(
            "SELECT CAST(kcu.table_name AS CHAR), CAST(kcu.column_name AS CHAR),
                    CAST(kcu.referenced_table_name AS CHAR), CAST(kcu.referenced_column_name AS CHAR)
             FROM information_schema.key_column_usage kcu
             JOIN information_schema.table_constraints tc
                 ON kcu.constraint_name = tc.constraint_name
                 AND kcu.table_schema   = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND kcu.table_schema    = ?
               AND kcu.referenced_table_name IS NOT NULL"
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        use std::collections::{HashMap, HashSet};

        let pk_set: HashSet<(String, String)> = pk_rows.iter()
            .map(|r| (
                r.try_get::<String, _>(0).unwrap_or_default(),
                r.try_get::<String, _>(1).unwrap_or_default(),
            ))
            .collect();

        let fk_map: HashMap<(String, String), (String, String)> = fk_rows.iter()
            .map(|r| (
                (r.try_get::<String, _>(0).unwrap_or_default(), r.try_get::<String, _>(1).unwrap_or_default()),
                (r.try_get::<String, _>(2).unwrap_or_default(), r.try_get::<String, _>(3).unwrap_or_default()),
            ))
            .collect();

        let mut cols_map: HashMap<String, Vec<ColumnSchema>> = HashMap::new();
        for r in &col_rows {
            let tname: String = r.try_get::<String, _>(0).unwrap_or_default();
            let cname: String = r.try_get::<String, _>(1).unwrap_or_default();
            let key = (tname.clone(), cname.clone());
            let (ref_table, ref_col) = fk_map.get(&key)
                .map(|(t, c)| (Some(t.clone()), Some(c.clone())))
                .unwrap_or((None, None));

            cols_map.entry(tname).or_default().push(ColumnSchema {
                name:              cname,
                data_type:         r.try_get::<String, _>(2).unwrap_or_default(),
                nullable:          r.try_get::<String, _>(3).unwrap_or_default() == "YES",
                is_primary_key:    pk_set.contains(&key),
                is_foreign_key:    fk_map.contains_key(&key),
                references_table:  ref_table,
                references_column: ref_col,
            });
        }

        let tables = table_names.into_iter().map(|name| {
            let columns = cols_map.remove(&name).unwrap_or_default();
            TableSchema { name, schema: schema.to_string(), columns }
        }).collect();

        Ok(tables)
    }

    fn driver_name(&self) -> &str { "MySQL" }

    fn is_connected(&self) -> bool {
        self.pool.as_ref().map(|p| !p.is_closed()).unwrap_or(false)
    }
}
