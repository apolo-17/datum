// drivers/mssql.rs — driver real de SQL Server usando tiberius

use async_trait::async_trait;
use tiberius::{AuthMethod, Client, Config, Query, QueryItem, Row};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::{TokioAsyncWriteCompatExt, Compat};
use serde_json::{json, Value};
use std::time::Instant;
use futures::TryStreamExt;

use crate::drivers::traits::*;

type MssqlClient = Client<Compat<TcpStream>>;

pub struct MssqlDriver {
    client: Mutex<Option<MssqlClient>>,
}

// Client<Compat<TcpStream>> es Send con tokio TcpStream
unsafe impl Send for MssqlDriver {}
unsafe impl Sync for MssqlDriver {}

impl MssqlDriver {
    pub fn new() -> Self {
        Self { client: Mutex::new(None) }
    }

    /// Extrae valor de una celda probando cada tipo en cascada
    fn extract_value(row: &Row, idx: usize) -> Value {
        if let Ok(Some(v)) = row.try_get::<bool, _>(idx) { return json!(v); }
        if let Ok(Some(v)) = row.try_get::<i32,  _>(idx) { return json!(v); }
        if let Ok(Some(v)) = row.try_get::<i64,  _>(idx) { return json!(v); }
        if let Ok(Some(v)) = row.try_get::<f32,  _>(idx) { return json!(v); }
        if let Ok(Some(v)) = row.try_get::<f64,  _>(idx) { return json!(v); }
        if let Ok(Some(v)) = row.try_get::<&str, _>(idx) { return json!(v.to_string()); }
        Value::Null
    }

    fn get_str(row: &Row, idx: usize) -> Option<String> {
        row.try_get::<&str, _>(idx).ok().flatten().map(|s| s.to_string())
    }
}

#[async_trait]
impl DatabaseDriver for MssqlDriver {
    async fn connect(&mut self, config: &ConnectionConfig) -> Result<(), String> {
        let mut cfg = Config::new();
        cfg.host(&config.host);
        cfg.port(config.port);
        cfg.authentication(AuthMethod::sql_server(&config.username, &config.password));
        cfg.trust_cert();
        if !config.database.is_empty() { cfg.database(&config.database); }

        let tcp = TcpStream::connect(cfg.get_addr()).await
            .map_err(|e| format!("TCP error: {}", e))?;
        tcp.set_nodelay(true).map_err(|e| format!("nodelay: {}", e))?;

        let client = Client::connect(cfg, tcp.compat_write()).await
            .map_err(|e| format!("Auth error: {}", e))?;

        *self.client.lock().await = Some(client);
        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), String> {
        *self.client.lock().await = None;
        Ok(())
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let mut guard = self.client.lock().await;
        let client = guard.as_mut().ok_or("Sin conexión activa")?;
        let start = Instant::now();

        // Stream único — un solo borrow de client, no hay conflicto
        let mut stream = Query::new(sql).query(client).await
            .map_err(|e| format!("Query error: {}", e))?;

        let mut columns: Vec<ColumnMeta> = vec![];
        let mut result_rows: Vec<Vec<Value>> = vec![];

        while let Some(item) = stream.try_next().await
            .map_err(|e| format!("Stream error: {}", e))?
        {
            match item {
                QueryItem::Metadata(meta) => {
                    columns = meta.columns().iter().map(|c| ColumnMeta {
                        name:      c.name().to_string(),
                        data_type: format!("{:?}", c.column_type()).to_lowercase(),
                    }).collect();
                }
                QueryItem::Row(row) => {
                    let values: Vec<Value> = (0..columns.len())
                        .map(|i| Self::extract_value(&row, i))
                        .collect();
                    result_rows.push(values);
                }
            }
        }

        let elapsed = start.elapsed().as_millis() as u64;
        Ok(QueryResult {
            columns,
            rows: result_rows.clone(),
            rows_affected: result_rows.len() as u64,
            execution_time_ms: elapsed,
        })
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let mut guard = self.client.lock().await;
        let client = guard.as_mut().ok_or("Sin conexión activa")?;

        // into_first_result() consume el stream → libera el borrow de client
        let rows = Query::new(
            "SELECT name FROM sys.databases
             WHERE name NOT IN ('master','tempdb','model','msdb')
               AND state_desc = 'ONLINE'
             ORDER BY name"
        )
        .query(client).await.map_err(|e| e.to_string())?
        .into_first_result().await.map_err(|e| e.to_string())?;

        Ok(rows.iter().filter_map(|r| Self::get_str(r, 0)).collect())
    }

    async fn get_schemas(&self) -> Result<Vec<String>, String> {
        let mut guard = self.client.lock().await;
        let client = guard.as_mut().ok_or("Sin conexión activa")?;

        let rows = Query::new(
            "SELECT schema_name FROM information_schema.schemata
             WHERE schema_name NOT IN (
                 'sys','INFORMATION_SCHEMA','guest','db_owner',
                 'db_accessadmin','db_securityadmin','db_ddladmin',
                 'db_backupoperator','db_datareader','db_datawriter',
                 'db_denydatareader','db_denydatawriter'
             )
             ORDER BY schema_name"
        )
        .query(client).await.map_err(|e| e.to_string())?
        .into_first_result().await.map_err(|e| e.to_string())?;

        Ok(rows.iter().filter_map(|r| Self::get_str(r, 0)).collect())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableSchema>, String> {
        let mut guard = self.client.lock().await;
        let client = guard.as_mut().ok_or("Sin conexión activa")?;

        // ── 1: nombres de tablas ─────────────────────────────────────────────
        // into_first_result() consume el stream antes del siguiente query
        let mut q1 = Query::new(
            "SELECT table_name FROM information_schema.tables
             WHERE table_schema = @P1 AND table_type = 'BASE TABLE'
             ORDER BY table_name"
        );
        q1.bind(schema);
        let table_rows = q1.query(client).await.map_err(|e| e.to_string())?
            .into_first_result().await.map_err(|e| e.to_string())?;

        let table_names: Vec<String> = table_rows.iter()
            .filter_map(|r| Self::get_str(r, 0)).collect();
        if table_names.is_empty() { return Ok(vec![]); }

        // ── 2: columnas ──────────────────────────────────────────────────────
        let mut q2 = Query::new(
            "SELECT table_name, column_name, data_type, is_nullable
             FROM information_schema.columns
             WHERE table_schema = @P1
             ORDER BY table_name, ordinal_position"
        );
        q2.bind(schema);
        let col_rows = q2.query(client).await.map_err(|e| e.to_string())?
            .into_first_result().await.map_err(|e| e.to_string())?;

        let cols_raw: Vec<(String, String, String, bool)> = col_rows.iter().map(|r| {
            let tname    = Self::get_str(r, 0).unwrap_or_default();
            let cname    = Self::get_str(r, 1).unwrap_or_default();
            let dtype    = Self::get_str(r, 2).unwrap_or_default();
            let nullable = Self::get_str(r, 3).map(|s| s == "YES").unwrap_or(true);
            (tname, cname, dtype, nullable)
        }).collect();

        // ── 3: PKs ───────────────────────────────────────────────────────────
        let mut q3 = Query::new(
            "SELECT kcu.table_name, kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema   = kcu.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema    = @P1"
        );
        q3.bind(schema);
        let pk_rows = q3.query(client).await.map_err(|e| e.to_string())?
            .into_first_result().await.map_err(|e| e.to_string())?;

        use std::collections::{HashMap, HashSet};
        let pk_set: HashSet<(String, String)> = pk_rows.iter().filter_map(|r| {
            Some((Self::get_str(r, 0)?, Self::get_str(r, 1)?))
        }).collect();

        // ── 4: FKs ───────────────────────────────────────────────────────────
        let mut q4 = Query::new(
            "SELECT
                 kcu.table_name,  kcu.column_name,
                 kcu2.table_name  AS ref_table,
                 kcu2.column_name AS ref_col
             FROM information_schema.referential_constraints rc
             JOIN information_schema.key_column_usage kcu
                 ON rc.constraint_name = kcu.constraint_name
                AND kcu.table_schema   = @P1
             JOIN information_schema.key_column_usage kcu2
                 ON rc.unique_constraint_name = kcu2.constraint_name
                AND kcu.ordinal_position      = kcu2.ordinal_position"
        );
        q4.bind(schema);
        let fk_rows = q4.query(client).await.map_err(|e| e.to_string())?
            .into_first_result().await.map_err(|e| e.to_string())?;

        let fk_map: HashMap<(String, String), (String, String)> = fk_rows.iter().filter_map(|r| {
            let t  = Self::get_str(r, 0)?;
            let c  = Self::get_str(r, 1)?;
            let rt = Self::get_str(r, 2)?;
            let rc = Self::get_str(r, 3)?;
            Some(((t, c), (rt, rc)))
        }).collect();

        // ── Armar resultado ──────────────────────────────────────────────────
        let mut cols_map: HashMap<String, Vec<ColumnSchema>> = HashMap::new();
        for (tname, cname, dtype, nullable) in cols_raw {
            let key = (tname.clone(), cname.clone());
            let (ref_table, ref_col) = fk_map.get(&key)
                .map(|(t, c)| (Some(t.clone()), Some(c.clone())))
                .unwrap_or((None, None));
            cols_map.entry(tname).or_default().push(ColumnSchema {
                name: cname,
                data_type: dtype,
                nullable,
                is_primary_key: pk_set.contains(&key),
                is_foreign_key: fk_map.contains_key(&key),
                references_table: ref_table,
                references_column: ref_col,
            });
        }

        Ok(table_names.into_iter().map(|name| {
            let columns = cols_map.remove(&name).unwrap_or_default();
            TableSchema { name, schema: schema.to_string(), columns }
        }).collect())
    }

    fn driver_name(&self) -> &str { "SQL Server" }

    fn is_connected(&self) -> bool {
        self.client.try_lock().map(|g| g.is_some()).unwrap_or(true)
    }
}
