import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load as loadStore } from "@tauri-apps/plugin-store";
import type { SavedConnection, DriverType, TableSchema } from "../../types";
import ConnectionModal from "../shared/ConnectionModal";

const STORE_FILE = "connections.json";
const STORE_KEY  = "saved_connections";


interface Props {
  activeConnection: SavedConnection | null;
  onSelectConnection: (conn: SavedConnection, password: string) => void;
  onTableOpen?: (schema: string, name: string) => void;
  onSchemaOpen?: (schema: string) => void;
  onSchemaErd?: (schema: string) => void;
  onTableErd?: (conn: SavedConnection, password: string, schema: string, tableName: string) => void;
}

interface CtxMenu {
  x: number;
  y: number;
  type: "schema" | "table";
  schema: string;
  tableName?: string;
  stored: StoredConn;
  dbName: string;
}

interface StoredConn {
  conn: SavedConnection;
  password: string;          // siempre disponible: viene del keychain
  passwordPending: boolean;  // true solo mientras carga del keychain
}

interface ConnTree {
  expanded: boolean;
  databases: string[];
  loading: boolean;
  error: string | null;
}
interface DbTree {
  expanded: boolean;
  schemas: string[];
  loading: boolean;
  error: string | null;
}
interface SchemaTree {
  expanded: boolean;
  tables: TableSchema[];
  loading: boolean;
}

const DRIVER_ICON: Record<DriverType, string> = {
  PostgreSQL: "🐘",
  MySQL:      "🐬",
  SQLite:     "🗄",
  SqlServer:  "🪟",
};

export default function Sidebar({ onSelectConnection, onTableOpen, onSchemaOpen, onSchemaErd, onTableErd }: Props) {
  const [connections, setConnections] = useState<StoredConn[]>([]);
  const [showModal, setShowModal]     = useState(false);

  const [connTree, setConnTree]       = useState<Record<string, ConnTree>>({});
  const [dbTree, setDbTree]           = useState<Record<string, DbTree>>({});
  const [schemaTree, setSchemaTree]   = useState<Record<string, SchemaTree>>({});
  const [activeDb, setActiveDb]       = useState<string | null>(null);
  const [ctxMenu, setCtxMenu]         = useState<CtxMenu | null>(null);
  const [hoveredRow, setHoveredRow]   = useState<string | null>(null);
  const ctxRef                        = useRef<HTMLDivElement>(null);

  // Cierra el ctx menu al hacer click fuera
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [!!ctxMenu]);

  // ── Al iniciar: carga metadata del store + contraseñas del keychain ────────
  useEffect(() => {
    (async () => {
      try {
        const store = await loadStore(STORE_FILE);
        const saved = await store.get<SavedConnection[]>(STORE_KEY);
        if (!saved || saved.length === 0) return;

        // Carga todas las contraseñas del keychain en paralelo
        const loaded = await Promise.all(
          saved.map(async (conn) => {
            try {
              const pwd = await invoke<string | null>("load_password", {
                connectionId: conn.id,
              });
              return { conn, password: pwd ?? "", passwordPending: false };
            } catch {
              return { conn, password: "", passwordPending: false };
            }
          })
        );
        setConnections(loaded);
      } catch (e) {
        console.error("Error cargando conexiones:", e);
      }
    })();
  }, []);

  // ── Persiste la lista de conexiones (sin contraseñas) ─────────────────────
  async function persistConnections(list: SavedConnection[]) {
    try {
      const store = await loadStore(STORE_FILE);
      await store.set(STORE_KEY, list);
      await store.save();
    } catch (e) {
      console.error("Error guardando conexiones:", e);
    }
  }

  // ── Nueva conexión: guarda metadata + contraseña en keychain ─────────────
  async function handleSave(conn: SavedConnection, password: string) {
    try {
      await invoke("save_password", { connectionId: conn.id, password });
    } catch (e) {
      console.error("Error guardando en keychain:", e);
    }
    const updated = [...connections, { conn, password, passwordPending: false }];
    setConnections(updated);
    setShowModal(false);
    await persistConnections(updated.map((s) => s.conn));
  }

  // ── Eliminar conexión: borra del store y del keychain ─────────────────────
  async function handleDelete(connId: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await invoke("delete_password", { connectionId: connId });
    } catch { /* si no existe, ok */ }
    const updated = connections.filter((s) => s.conn.id !== connId);
    setConnections(updated);
    await persistConnections(updated.map((s) => s.conn));
    setConnTree((s) => { const n = { ...s }; delete n[connId]; return n; });
  }

  // ── Nivel 1: click en la conexión ─────────────────────────────────────────
  async function handleConnClick(stored: StoredConn) {
    const { conn, password } = stored;
    const id = conn.id;
    const cur = connTree[id];

    if (cur?.expanded) {
      setConnTree((s) => ({ ...s, [id]: { ...s[id], expanded: false } }));
      return;
    }
    if (cur?.databases.length) {
      setConnTree((s) => ({ ...s, [id]: { ...s[id], expanded: true } }));
      return;
    }

    setConnTree((s) => ({
      ...s,
      [id]: { expanded: true, databases: [], loading: true, error: null },
    }));
    try {
      await invoke("open_connection", { connection: conn, password });
      const dbs = await invoke<string[]>("list_databases", { connectionId: id });
      setConnTree((s) => ({
        ...s,
        [id]: { expanded: true, databases: dbs, loading: false, error: null },
      }));
    } catch (e: unknown) {
      setConnTree((s) => ({
        ...s,
        [id]: { expanded: true, databases: [], loading: false, error: String(e) },
      }));
    }
  }

  // ── Nivel 2: click en una database ────────────────────────────────────────
  async function handleDbClick(stored: StoredConn, dbName: string) {
    const { conn, password } = stored;
    const key = `${conn.id}:${dbName}`;
    const cur = dbTree[key];

    const dbConn: SavedConnection = { ...conn, database: dbName, id: `${conn.id}:${dbName}` };
    setActiveDb(key);
    onSelectConnection(dbConn, password);

    if (cur?.expanded) {
      setDbTree((s) => ({ ...s, [key]: { ...s[key], expanded: false } }));
      return;
    }
    if (cur?.schemas.length) {
      setDbTree((s) => ({ ...s, [key]: { ...s[key], expanded: true } }));
      return;
    }

    setDbTree((s) => ({
      ...s,
      [key]: { expanded: true, schemas: [], loading: true, error: null },
    }));
    try {
      await invoke("open_connection", { connection: dbConn, password });
      const schemas = await invoke<string[]>("get_schemas", { connectionId: dbConn.id });
      setDbTree((s) => ({
        ...s,
        [key]: { expanded: true, schemas, loading: false, error: null },
      }));
    } catch (e: unknown) {
      setDbTree((s) => ({
        ...s,
        [key]: { expanded: true, schemas: [], loading: false, error: String(e) },
      }));
    }
  }

  // ── Nivel 3: click en un schema ───────────────────────────────────────────
  async function handleSchemaClick(stored: StoredConn, dbName: string, schemaName: string) {
    const { conn, password } = stored;
    const dbConnId = `${conn.id}:${dbName}`;
    const key = `${dbConnId}:${schemaName}`;
    const cur = schemaTree[key];

    if (cur?.expanded) {
      // Ya expandido: solo refresca el overview, NO colapsa
      onSchemaOpen?.(schemaName);
      return;
    }
    if (cur?.tables.length) {
      setSchemaTree((s) => ({ ...s, [key]: { ...s[key], expanded: true } }));
      onSchemaOpen?.(schemaName);
      return;
    }

    setSchemaTree((s) => ({ ...s, [key]: { expanded: true, tables: [], loading: true } }));
    try {
      const dbConn: SavedConnection = { ...conn, database: dbName, id: dbConnId };
      await invoke("open_connection", { connection: dbConn, password }).catch(() => {});
      const tables = await invoke<TableSchema[]>("get_tables", {
        connectionId: dbConnId,
        schema: schemaName,
      });
      setSchemaTree((s) => ({ ...s, [key]: { expanded: true, tables, loading: false } }));
    } catch {
      setSchemaTree((s) => ({ ...s, [key]: { expanded: true, tables: [], loading: false } }));
    }
    // Abre el overview del schema en el área principal
    onSchemaOpen?.(schemaName);
  }


  return (
    <>
      <div style={styles.sidebar}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>CONEXIONES</span>
          <button style={styles.addBtn} onClick={() => setShowModal(true)}>+</button>
        </div>

        <div style={styles.list}>
          {connections.length === 0 && (
            <p style={styles.emptyMsg}>
              Sin conexiones.{" "}
              <span style={styles.link} onClick={() => setShowModal(true)}>Agrega una</span>
            </p>
          )}

          {connections.map((stored) => {
            const { conn } = stored;
            const ct = connTree[conn.id];

            return (
              <div key={conn.id}>
                {/* ── Servidor ── */}
                <div
                  style={{ ...styles.row, background: hoveredRow === conn.id ? "rgba(255,255,255,0.04)" : "transparent" }}
                  onClick={() => handleConnClick(stored)}
                  onMouseEnter={() => setHoveredRow(conn.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <Chevron open={ct?.expanded} />
                  <span style={{ fontSize: 13 }}>{DRIVER_ICON[conn.driver]}</span>
                  <div style={styles.info}>
                    <span style={styles.label}>{conn.name}</span>
                    <span style={styles.sub}>{conn.host}:{conn.port}</span>
                  </div>
                  <button
                    style={styles.deleteBtn}
                    onClick={(e) => handleDelete(conn.id, e)}
                    title="Eliminar conexión"
                  >
                    ✕
                  </button>
                </div>

                {ct?.loading && <Loading pad={28} />}
                {ct?.error   && <Err msg={ct.error} pad={28} />}

                {/* ── Databases ── */}
                {ct?.expanded && ct.databases.map((db) => {
                  const dbKey = `${conn.id}:${db}`;
                  const dt = dbTree[dbKey];
                  const isActiveDb = activeDb === dbKey;

                  return (
                    <div key={db}>
                      <div
                        style={{
                          ...styles.row,
                          paddingLeft: 26,
                          background: isActiveDb
                            ? "var(--accent-dim)"
                            : hoveredRow === dbKey
                            ? "rgba(129,140,248,0.06)"
                            : "transparent",
                        }}
                        onClick={() => handleDbClick(stored, db)}
                        onMouseEnter={() => setHoveredRow(dbKey)}
                        onMouseLeave={() => setHoveredRow(null)}
                      >
                        <Chevron open={dt?.expanded} />
                        <span style={{ fontSize: 12 }}>🗄</span>
                        <span style={{
                          ...styles.label,
                          color: isActiveDb ? "var(--accent-text)" : "var(--text-secondary)",
                        }}>
                          {db}
                        </span>
                      </div>

                      {dt?.loading && <Loading pad={44} />}
                      {dt?.error   && <Err msg={dt.error} pad={44} />}

                      {dt?.expanded && dt.schemas.map((schema) => {
                        const schKey = `${dbKey}:${schema}`;
                        const st = schemaTree[schKey];

                        return (
                          <div key={schema}>
                            <div
                              style={{
                                ...styles.row,
                                paddingLeft: 40,
                                background: hoveredRow === schKey
                                  ? "rgba(129,140,248,0.12)"
                                  : st?.expanded
                                  ? "rgba(129,140,248,0.04)"
                                  : "transparent",
                                borderLeft: hoveredRow === schKey
                                  ? "2px solid var(--accent)"
                                  : st?.expanded
                                  ? "2px solid rgba(129,140,248,0.25)"
                                  : "2px solid transparent",
                              }}
                              onClick={() => handleSchemaClick(stored, db, schema)}
                              onMouseEnter={() => setHoveredRow(schKey)}
                              onMouseLeave={() => setHoveredRow(null)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setCtxMenu({ x: e.clientX, y: e.clientY, type: "schema", schema, stored, dbName: db });
                              }}
                            >
                              <Chevron open={st?.expanded} />
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>◈</span>
                              <span style={{ ...styles.label, color: "var(--text-secondary)" }}>
                                {schema}
                              </span>
                            </div>

                            {st?.loading && <Loading pad={60} />}

                            {st?.expanded && st.tables.map((table) => {
                              const tableKey = `${schKey}:${table.name}`;
                              return (
                                <div
                                  key={table.name}
                                  style={{
                                    ...styles.row,
                                    paddingLeft: 58,
                                    background: hoveredRow === tableKey
                                      ? "rgba(129,140,248,0.09)"
                                      : "transparent",
                                  }}
                                  onClick={() => onTableOpen?.(schema, table.name)}
                                  onMouseEnter={() => setHoveredRow(tableKey)}
                                  onMouseLeave={() => setHoveredRow(null)}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    setCtxMenu({ x: e.clientX, y: e.clientY, type: "table", schema, tableName: table.name, stored, dbName: db });
                                  }}
                                >
                                  <span style={{ fontSize: 11, color: "var(--text-muted)", width: 10, flexShrink: 0 }}>▤</span>
                                  <span style={{ ...styles.label, fontSize: 11 }}>
                                    {table.name}
                                  </span>
                                  <span style={styles.colCount}>{table.columns.length}</span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {showModal && <ConnectionModal onSave={handleSave} onClose={() => setShowModal(false)} />}

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          style={{
            ...styles.ctxMenu,
            top: ctxMenu.y,
            left: ctxMenu.x,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.type === "table" && (
            <div
              style={styles.ctxItem}
              onClick={() => {
                setCtxMenu(null);
                onTableOpen?.(ctxMenu.schema, ctxMenu.tableName!);
              }}
            >
              <span style={styles.ctxIcon}>⊞</span> Ver datos
            </div>
          )}
          <div
            style={styles.ctxItem}
            onClick={() => {
              setCtxMenu(null);
              if (ctxMenu.type === "table" && onTableErd) {
                // Para la tabla: conectar a la DB y abrir mini modal
                const dbConn: SavedConnection = {
                  ...ctxMenu.stored.conn,
                  database: ctxMenu.dbName,
                  id: `${ctxMenu.stored.conn.id}:${ctxMenu.dbName}`,
                };
                onSelectConnection(dbConn, ctxMenu.stored.password);
                onTableErd(dbConn, ctxMenu.stored.password, ctxMenu.schema, ctxMenu.tableName!);
              } else if (ctxMenu.type === "schema") {
                // Para el schema: ir al tab ERD con ese schema
                const dbConn: SavedConnection = {
                  ...ctxMenu.stored.conn,
                  database: ctxMenu.dbName,
                  id: `${ctxMenu.stored.conn.id}:${ctxMenu.dbName}`,
                };
                onSelectConnection(dbConn, ctxMenu.stored.password);
                onSchemaErd?.(ctxMenu.schema);
              }
            }}
          >
            <span style={styles.ctxIcon}>⬡</span> Ver en ERD
          </div>
        </div>
      )}
    </>
  );
}

// ── Auxiliares ────────────────────────────────────────────────────────────────

function Chevron({ open }: { open?: boolean }) {
  return (
    <span style={{ fontSize: 9, color: "var(--text-muted)", width: 10, flexShrink: 0 }}>
      {open ? "▾" : "▸"}
    </span>
  );
}
function Loading({ pad }: { pad: number }) {
  return (
    <div style={{ paddingLeft: pad, paddingTop: 4, paddingBottom: 4, fontSize: 11, color: "var(--text-muted)" }}>
      Cargando...
    </div>
  );
}
function Err({ msg, pad }: { msg: string; pad: number }) {
  return (
    <div style={{ paddingLeft: pad, paddingTop: 4, fontSize: 11, color: "var(--red)" }}>
      ✗ {msg.slice(0, 60)}
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────

const styles: Record<string, any> = {
  sidebar: {
    width: 260,
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
    borderRight: "1px solid var(--border)",
    flexShrink: 0,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px 6px",
    borderBottom: "1px solid var(--border)",
  },
  headerTitle: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.08em",
    color: "var(--text-muted)",
  },
  addBtn: {
    width: 20,
    height: 20,
    borderRadius: 4,
    border: "1px solid var(--border-light)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "4px 0",
  },
  emptyMsg: {
    color: "var(--text-muted)",
    fontSize: 12,
    textAlign: "center",
    padding: "16px 12px",
  },
  link: {
    color: "var(--accent-text)",
    cursor: "pointer",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 10px",
    paddingLeft: 10,
    cursor: "pointer",
    borderRadius: 4,
    margin: "1px 4px",
    transition: "background 0.1s",
    userSelect: "none",
  },
  info: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sub: {
    fontSize: 10,
    color: "var(--text-muted)",
  },
  deleteBtn: {
    opacity: 0.4,
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    fontSize: 10,
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: 3,
    flexShrink: 0,
  },
  colCount: {
    marginLeft: "auto",
    fontSize: 10,
    color: "var(--accent-text)",
    background: "var(--accent-dim)",
    border: "1px solid var(--border-light)",
    padding: "1px 6px",
    borderRadius: 8,
    flexShrink: 0,
    fontWeight: 600,
  },
  ctxMenu: {
    position: "fixed" as const,
    zIndex: 1000,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-light)",
    borderRadius: 6,
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    padding: "4px",
    minWidth: 170,
  },
  ctxItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 12px",
    fontSize: 12,
    color: "var(--text-primary)",
    borderRadius: 4,
    cursor: "pointer",
  },
  ctxIcon: {
    fontSize: 14,
    color: "var(--accent-text)",
    width: 16,
    textAlign: "center" as const,
  },
};
