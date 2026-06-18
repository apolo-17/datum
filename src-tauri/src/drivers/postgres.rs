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

        let url = format!(
            "postgresql://{}:{}@{}:{}/{}{}",
            config.username,
            config.password,
            config.host,
            config.port,
            db,
            if config.ssl { "?sslmode=require" } else { "?sslmode=disable" }
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

        // Obtener tablas del schema
        let table_rows = sqlx::query(
            "SELECT table_name FROM information_schema.tables
             WHERE table_schema = $1 AND table_type = 'BASE TABLE'
             ORDER BY table_name"
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

        let mut tables = Vec::new();

        for table_row in &table_rows {
            let table_name: String = table_row.get(0);

            // Obtener columnas con PKs y FKs
            let col_rows = sqlx::query(
                "SELECT
                    c.column_name,
                    c.data_type,
                    c.is_nullable,
                    CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk,
                    CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END AS is_fk,
                    fk.foreign_table_name,
                    fk.foreign_column_name
                FROM information_schema.columns c
                LEFT JOIN (
                    SELECT kcu.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                        AND tc.table_schema = kcu.table_schema
                    WHERE tc.constraint_type = 'PRIMARY KEY'
                      AND tc.table_name = $1
                      AND tc.table_schema = $2
                ) pk ON c.column_name = pk.column_name
                LEFT JOIN (
                    SELECT
                        kcu.column_name,
                        ccu.table_name AS foreign_table_name,
                        ccu.column_name AS foreign_column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                    JOIN information_schema.constraint_column_usage ccu
                        ON tc.constraint_name = ccu.constraint_name
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                      AND tc.table_name = $1
                      AND tc.table_schema = $2
                ) fk ON c.column_name = fk.column_name
                WHERE c.table_name = $1 AND c.table_schema = $2
                ORDER BY c.ordinal_position"
            )
            .bind(&table_name)
            .bind(schema)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            let columns: Vec<ColumnSchema> = col_rows.iter().map(|r| ColumnSchema {
                name:              r.get::<String, _>(0),
                data_type:         r.get::<String, _>(1),
                nullable:          r.get::<String, _>(2) == "YES",
                is_primary_key:    r.get::<bool, _>(3),
                is_foreign_key:    r.get::<bool, _>(4),
                references_table:  r.try_get::<String, _>(5).ok(),
                references_column: r.try_get::<String, _>(6).ok(),
            }).collect();

            tables.push(TableSchema {
                name: table_name,
                schema: schema.to_string(),
                columns,
            });
        }

        Ok(tables)
    }

    fn driver_name(&self) -> &str {
        "PostgreSQL"
    }

    fn is_connected(&self) -> bool {
        self.pool.as_ref().map(|p| !p.is_closed()).unwrap_or(false)
    }
}
