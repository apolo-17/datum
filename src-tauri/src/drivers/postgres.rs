// drivers/postgres.rs — driver real de PostgreSQL usando sqlx

use async_trait::async_trait;
use sqlx::{postgres::PgPoolOptions, Column, PgPool, Row, TypeInfo};
use serde_json::{json, Value};
use std::time::Instant;

use crate::drivers::traits::*;

pub struct PostgresDriver {
    pool: Option<PgPool>,
}

impl PostgresDriver {
    pub fn new() -> Self {
        Self { pool: None }
    }

    /// Convierte el valor de una celda al tipo JSON correcto
    fn decode_cell(row: &sqlx::postgres::PgRow, idx: usize) -> Value {
        let type_name = row.column(idx).type_info().name();
        match type_name {
            // Enteros
            "INT2" => row.try_get::<i16, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "INT4" => row.try_get::<i32, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "INT8" | "OID" => row.try_get::<i64, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            // Decimales
            "FLOAT4" => row.try_get::<f32, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "FLOAT8" => row.try_get::<f64, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            "NUMERIC" => row.try_get::<String, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            // Booleano
            "BOOL" => row.try_get::<bool, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
            // Fechas y timestamps
            "TIMESTAMP" => row
                .try_get::<chrono::NaiveDateTime, _>(idx)
                .map(|v| json!(v.format("%Y-%m-%d %H:%M:%S").to_string()))
                .unwrap_or(Value::Null),
            "TIMESTAMPTZ" => row
                .try_get::<chrono::DateTime<chrono::Utc>, _>(idx)
                .map(|v| json!(v.format("%Y-%m-%d %H:%M:%S UTC").to_string()))
                .unwrap_or(Value::Null),
            "DATE" => row
                .try_get::<chrono::NaiveDate, _>(idx)
                .map(|v| json!(v.to_string()))
                .unwrap_or(Value::Null),
            // JSON nativo
            "JSON" | "JSONB" => row
                .try_get::<Value, _>(idx)
                .unwrap_or(Value::Null),
            // Todo lo demás como String
            _ => row.try_get::<String, _>(idx).map(|v| json!(v)).unwrap_or(Value::Null),
        }
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), String> {
        // Si no especifica DB, conecta a "postgres" (la DB del sistema)
        // para poder listar todas las bases de datos disponibles
        let db = if config.database.is_empty() { "postgres" } else { &config.database };

        let ssl_mode = if config.ssl { "require" } else { "prefer" };
        let url = format!(
            "postgresql://{}:{}@{}:{}/{}?sslmode={}",
            config.username,
            config.password,
            config.host,
            config.port,
            db,
            ssl_mode
        );

        let pool = PgPoolOptions::new()
            .max_connections(5)           // máximo 5 conexiones en el pool
            .acquire_timeout(std::time::Duration::from_secs(10))
            .connect(&url)
            .await
            .map_err(|e| format!("No se pudo conectar a PostgreSQL: {}", e))?;

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

        // Extraer metadata de columnas de la primera fila
        let columns: Vec<ColumnMeta> = rows[0]
            .columns()
            .iter()
            .map(|col| ColumnMeta {
                name: col.name().to_string(),
                data_type: col.type_info().name().to_lowercase(),
            })
            .collect();

        // Convertir cada fila a Vec<Value>
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
            "SELECT datname FROM pg_database
             WHERE datistemplate = false
             ORDER BY datname"
        )
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows.iter().map(|r| r.get::<String, _>(0)).collect())
    }

    async fn get_schemas(&self) -> Result<Vec<String>, String> {
        let pool = self.pool.as_ref().ok_or("Sin conexión activa")?;

        let rows = sqlx::query(
            "SELECT schema_name FROM information_schema.schemata
             WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
             ORDER BY schema_name"
        )
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(rows.iter().map(|r| r.get::<String, _>(0)).collect())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableSchema>, String> {
        let pool = self.pool.as_ref().ok_or("Sin conexión activa")?;

        // ── 1 query: todas las tablas del schema ─────────────────────────────
        let table_rows = sqlx::query(
            "SELECT table_name FROM information_schema.tables
             WHERE table_schema = $1 AND table_type = 'BASE TABLE'
             ORDER BY table_name"
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        let table_names: Vec<String> = table_rows.iter().map(|r| r.get(0)).collect();
        if table_names.is_empty() { return Ok(vec![]); }

        // ── 2 query: todas las columnas del schema en una sola llamada ───────
        let col_rows = sqlx::query(
            "SELECT table_name, column_name, data_type, is_nullable, ordinal_position
             FROM information_schema.columns
             WHERE table_schema = $1
             ORDER BY table_name, ordinal_position"
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        // ── 3 query: PKs del schema ───────────────────────────────────────────
        let pk_rows = sqlx::query(
            "SELECT kcu.table_name, kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema   = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema    = $1"
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        // ── 4 query: FKs del schema (DISTINCT ON para evitar duplicados) ─────
        let fk_rows = sqlx::query(
            "SELECT DISTINCT ON (kcu.table_name, kcu.column_name)
                 kcu.table_name,
                 kcu.column_name,
                 ccu.table_name  AS foreign_table_name,
                 ccu.column_name AS foreign_column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name
             JOIN information_schema.constraint_column_usage ccu
                 ON tc.constraint_name = ccu.constraint_name
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_schema    = $1
             ORDER BY kcu.table_name, kcu.column_name"
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        // ── Construir índices en memoria ──────────────────────────────────────
        // pk_set: (table, col)
        use std::collections::{HashMap, HashSet};

        let pk_set: HashSet<(String, String)> = pk_rows.iter()
            .map(|r| (r.get::<String, _>(0), r.get::<String, _>(1)))
            .collect();

        // fk_map: (table, col) → (ref_table, ref_col)
        let fk_map: HashMap<(String, String), (String, String)> = fk_rows.iter()
            .map(|r| (
                (r.get::<String, _>(0), r.get::<String, _>(1)),
                (r.get::<String, _>(2), r.get::<String, _>(3)),
            ))
            .collect();

        // cols_map: table → Vec<ColumnSchema>
        let mut cols_map: HashMap<String, Vec<ColumnSchema>> = HashMap::new();
        for r in &col_rows {
            let tname: String = r.get(0);
            let cname: String = r.get(1);
            let key = (tname.clone(), cname.clone());
            let (ref_table, ref_col) = fk_map.get(&key)
                .map(|(t, c)| (Some(t.clone()), Some(c.clone())))
                .unwrap_or((None, None));

            cols_map.entry(tname).or_default().push(ColumnSchema {
                name:              cname.clone(),
                data_type:         r.get(2),
                nullable:          r.get::<String, _>(3) == "YES",
                is_primary_key:    pk_set.contains(&key),
                is_foreign_key:    fk_map.contains_key(&key),
                references_table:  ref_table,
                references_column: ref_col,
            });
        }

        // ── Armar resultado en orden ──────────────────────────────────────────
        let tables = table_names.into_iter().map(|name| {
            let columns = cols_map.remove(&name).unwrap_or_default();
            TableSchema { name, schema: schema.to_string(), columns }
        }).collect();

        Ok(tables)
    }

    fn driver_name(&self) -> &str {
        "PostgreSQL"
    }

    fn is_connected(&self) -> bool {
        self.pool.as_ref().map(|p| !p.is_closed()).unwrap_or(false)
    }
}
