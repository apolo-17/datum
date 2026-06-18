// commands/index.ts
// Capa de Comandos en el frontend — wrappers tipados sobre invoke() de Tauri
// El resto de la UI importa de aquí, nunca llama invoke() directamente

import { invoke } from "@tauri-apps/api/core";
import type { SavedConnection, QueryResult, TableSchema } from "../types";

/** Abre una conexión a una base de datos */
export async function openConnection(
  connection: SavedConnection,
  password: string
): Promise<string> {
  return invoke("open_connection", { connection, password });
}

/** Cierra una conexión activa */
export async function closeConnection(connectionId: string): Promise<void> {
  return invoke("close_connection", { connectionId });
}

/** Ejecuta un query SQL y devuelve los resultados */
export async function executeQuery(
  connectionId: string,
  sql: string
): Promise<QueryResult> {
  return invoke("execute_query", { connectionId, sql });
}

/** Obtiene las tablas de un schema (para el ERD y el sidebar) */
export async function getTables(
  connectionId: string,
  schema: string
): Promise<TableSchema[]> {
  return invoke("get_tables", { connectionId, schema });
}

/** Lista los schemas disponibles en una conexión */
export async function getSchemas(connectionId: string): Promise<string[]> {
  return invoke("get_schemas", { connectionId });
}
