// types/index.ts
// Tipos compartidos en todo el frontend — espejo de los modelos Rust

export type DriverType = "PostgreSQL" | "MySQL" | "SQLite" | "SqlServer";

export interface SavedConnection {
  id: string;
  name: string;
  driver: DriverType;
  host: string;
  port: number;
  database: string;
  username: string;
  use_ssl: boolean;
  use_ssh: boolean;
}

export interface ColumnMeta {
  name: string;
  data_type: string;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: unknown[][];
  rows_affected: number;
  execution_time_ms: number;
}

export interface ColumnSchema {
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  references_table: string | null;
  references_column: string | null;
}

export interface TableSchema {
  name: string;
  schema: string;
  columns: ColumnSchema[];
}
