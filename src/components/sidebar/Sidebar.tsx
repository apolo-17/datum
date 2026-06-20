import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load as loadStore } from "@tauri-apps/plugin-store";
import type { SavedConnection, DriverType, TableSchema } from "../../types";
import ConnectionModal from "../shared/ConnectionModal";
import type { SearchEntry } from "../shared/SearchModal";

const STORE_FILE = "connections.json";
const STORE_KEY  = "saved_connections";


interface Props {
  activeConnection: SavedConnection | null;
  onSelectConnection: (conn: SavedConnection, password: string) => void;
  onTableOpen?: (schema: string, name: string) => void;
  onSchemaOpen?: (schema: string) => void;
  onSchemaErd?: (schema: string) => void;
  onTableErd?: (conn: SavedConnection, password: string, schema: string, tableName: string) => void;
  onIndexUpdate?: (entries: SearchEntry[]) => void;
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

export default function Sidebar({ onSelectConnection, onTableOpen, onSchemaOpen, onSchemaErd, onTableErd, onIndexUpdate }: Props) {
  const [connections, setConnections] = useState<StoredConn[]>([]);
  const [showModal, setShowModal]     = useState(false);
  const [editTarget, setEditTarget]   = useState<StoredConn | null>(null);
  const [connMenu, setConnMenu]       = useState<string | null>(null);

  // Semáforo: idle | connecting | connected | error
  type ConnStatus = "idle" | "connecting" | "connected" | "error";
  const [connStatus, setConnStatus]   = useState<Record<string, ConnStatus>>({});

  // Modal de reconexión
  const [reconnTarget, setReconnTarget] = useState<StoredConn | null>(null);
  const [reconnState,  setReconnState]  = useState<"idle" | "connecting" | "ok" | "error">("idle");
  const [reconnError,  setReconnError]  = useState<string>("");

  const [connTree, setConnTree]       = useState<Record<string, ConnTree>>({});
  const [dbTree, setDbTree]           = useState<Record<string, DbTree>>({});
  const [schemaTree, setSchemaTree]   = useState<Record<string, SchemaTree>>({});
  const [activeDb, setActiveDb]       = useState<string | null>(null);
  const [ctxMenu, setCtxMenu]         = useState<CtxMenu | null>(null);
  const [hoveredRow, setHoveredRow]   = useState<string | null>(null);
  const ctxRef                        = useRef<HTMLDivElement>(null);

  // Cierra el menú ⋯ al hacer click fuera
  useEffect(() => {
    if (!connMenu) return;
    const close = () => setConnMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [!!connMenu]);

  // Cierra el ctx menu al hacer click fuera
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [!!ctxMenu]);

  // ── Publica el índice de búsqueda cuando cambia el árbol ─────────────────
  useEffect(() => {
    if (!onIndexUpdate) return;
    const entries: SearchEntry[] = [];
    for (const [key, st] of Object.entries(schemaTree)) {
      if (!st.tables.length) continue;
      // key = connId:dbName:schemaName
      const parts  = key.split(":");
      const schema = parts[parts.length - 1];
      const dbName = parts[parts.length - 2] ?? "";
      for (const table of st.tables) {
        entries.push({
          schema,
          tableName: table.name,
          columns:   table.columns.map((c) => c.name),
          dbName,
        });
      }
    }
    onIndexUpdate(entries);
  }, [schemaTree, onIndexUpdate]);

  // ── Al iniciar: carga metadata del store + contraseñas del keychain ────────
  useEffect(() => {
    (async () => {
      try {
        const store = await loadStore(STORE_FILE);
        const saved = await store.get<SavedConnection[]>(STORE_KEY);
        if (!saved || saved.length === 0) return;

        // Carga TODAS las contraseñas en una sola llamada al keychain
        // (evita que macOS muestre N diálogos de autorización)
        const ids = saved.map((c) => c.id);
        const pwdMap = await invoke<Record<string, string>>("load_all_passwords", {
          connectionIds: ids,
        }).catch(() => ({} as Record<string, string>));

        const loaded = saved.map((conn) => ({
          conn,
          password: pwdMap[conn.id] ?? "",
          passwordPending: false,
        }));
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

  // ── Editar conexión existente ─────────────────────────────────────────────
  async function handleUpdate(conn: SavedConnection, password: string) {
    // Actualiza contraseña en keychain (si se cambió)
    if (password) {
      try { await invoke("save_password", { connectionId: conn.id, password }); } catch { /* ok */ }
    }
    const updated = connections.map((s) =>
      s.conn.id === conn.id
        ? { conn, password: password || s.password, passwordPending: false }
        : s
    );
    setConnections(updated);
    setEditTarget(null);
    // Limpiar árbol de esa conexión para forzar re-carga con nueva config
    setConnTree((t) => { const n = { ...t }; delete n[conn.id]; return n; });
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
    setConnStatus((s) => ({ ...s, [id]: "connecting" }));
    try {
      await invoke("open_connection", { connection: conn, password });
      const dbs = await invoke<string[]>("list_databases", { connectionId: id });
      setConnTree((s) => ({
        ...s,
        [id]: { expanded: true, databases: dbs, loading: false, error: null },
      }));
      setConnStatus((s) => ({ ...s, [id]: "connected" }));
    } catch (e: unknown) {
      setConnTree((s) => ({
        ...s,
        [id]: { expanded: true, databases: [], loading: false, error: String(e) },
      }));
      setConnStatus((s) => ({ ...s, [id]: "error" }));
    }
  }

  // ── Reconectar (desde menú ⋯) ────────────────────────────────────────────
  async function handleReconnect(stored: StoredConn) {
    const { conn, password } = stored;
    setReconnTarget(stored);
    setReconnState("connecting");
    setReconnError("");
    setConnStatus((s) => ({ ...s, [conn.id]: "connecting" }));
    try {
      await invoke("open_connection", { connection: conn, password });
      const dbs = await invoke<string[]>("list_databases", { connectionId: conn.id });
      setConnTree((s) => ({
        ...s,
        [conn.id]: { expanded: true, databases: dbs, loading: false, error: null },
      }));
      setConnStatus((s) => ({ ...s, [conn.id]: "connected" }));
      setReconnState("ok");
    } catch (e: unknown) {
      setConnStatus((s) => ({ ...s, [conn.id]: "error" }));
      setReconnState("error");
      setReconnError(String(e));
    }
  }

  // ── Nivel 2: click en una database ────────────────────────────────────────
  async function handleDbClick(stored: StoredConn, dbName: string) {
    const { conn, password } = stored;
    const key = `${conn.id}:${dbName}`;
    const cur = dbTree[key];

    // SQLite usa el campo database para la ruta del archivo — no sobreescribir con el nombre de DB
    const dbDatabase = conn.driver === "SQLite" ? conn.database : dbName;
    const dbConn: SavedConnection = { ...conn, database: dbDatabase, id: `${conn.id}:${dbName}` };
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

  // ── Nivel 3a: click en fila del schema → abre Overview, no toca expanded ──
  async function handleSchemaClick(stored: StoredConn, dbName: string, schemaName: string) {
    const { conn, password } = stored;
    const dbConnId = `${conn.id}:${dbName}`;
    const key = `${dbConnId}:${schemaName}`;
    const cur = schemaTree[key];

    // Si no hay tablas cargadas todavía, cargarlas al abrir el overview
    if (!cur || !cur.tables.length) {
      setSchemaTree((s) => ({ ...s, [key]: { expanded: true, tables: [], loading: true } }));
      try {
        const dbConn: SavedConnection = { ...conn, database: conn.driver === "SQLite" ? conn.database : dbName, id: dbConnId };
        await invoke("open_connection", { connection: dbConn, password }).catch(() => {});
        const tables = await invoke<TableSchema[]>("get_tables", {
          connectionId: dbConnId,
          schema: schemaName,
        });
        setSchemaTree((s) => ({ ...s, [key]: { expanded: true, tables, loading: false } }));
      } catch {
        setSchemaTree((s) => ({ ...s, [key]: { expanded: true, tables: [], loading: false } }));
      }
    }

    onSchemaOpen?.(schemaName);
  }

  // ── Nivel 3b: click en la flecha del schema → solo toggle expand/collapse ──
  function handleSchemaToggle(e: React.MouseEvent, stored: StoredConn, dbName: string, schemaName: string) {
    e.stopPropagation();
    const dbConnId = `${stored.conn.id}:${dbName}`;
    const key = `${dbConnId}:${schemaName}`;
    const cur = schemaTree[key];

    if (cur?.expanded) {
      // Colapsa
      setSchemaTree((s) => ({ ...s, [key]: { ...s[key], expanded: false } }));
    } else if (cur?.tables.length) {
      // Ya tiene tablas, solo re-expande
      setSchemaTree((s) => ({ ...s, [key]: { ...s[key], expanded: true } }));
    } else {
      // Primera vez: carga tablas (handleSchemaClick set expanded:true al cargar)
      handleSchemaClick(stored, dbName, schemaName);
    }
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
                  {/* Semáforo de conexión */}
                  <StatusDot status={connStatus[conn.id] ?? "idle"} />
                  <span style={{ fontSize: 13 }}>{DRIVER_ICON[conn.driver]}</span>
                  <div style={styles.info}>
                    <span style={styles.label}>{conn.name}</span>
                    <span style={styles.sub}>{conn.host}:{conn.port}</span>
                  </div>

                  {/* Botón ⋯ opciones */}
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <button
                      style={{
                        ...styles.optionsBtn,
                        opacity: hoveredRow === conn.id || connMenu === conn.id ? 1 : 0,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConnMenu((prev) => prev === conn.id ? null : conn.id);
                      }}
                      title="Opciones"
                    >
                      ⋯
                    </button>

                    {connMenu === conn.id && (
                      <div
                        style={styles.connDropdown}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <button
                          style={styles.connDropItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnMenu(null);
                            handleReconnect(stored);
                          }}
                        >
                          <span style={styles.connDropIcon}>↺</span> Reconectar
                        </button>
                        <button
                          style={styles.connDropItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConnMenu(null);
                            setEditTarget(stored);
                          }}
                        >
                          <span style={styles.connDropIcon}>✎</span> Editar
                        </button>
                        <div style={styles.connDropSep} />
                        <button
                          style={{ ...styles.connDropItem, color: "var(--red)" }}
                          onClick={(e) => { handleDelete(conn.id, e); setConnMenu(null); }}
                        >
                          <span style={{ ...styles.connDropIcon, color: "var(--red)" }}>✕</span> Eliminar
                        </button>
                      </div>
                    )}
                  </div>
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
                              {/* Flecha independiente: toggle collapse/expand */}
                              <button
                                style={{
                                  ...styles.toggleArrow,
                                  color: hoveredRow === schKey ? "var(--text-primary)" : "var(--text-muted)",
                                }}
                                onClick={(e) => handleSchemaToggle(e, stored, db, schema)}
                                title={st?.expanded ? "Colapsar tablas" : "Expandir tablas"}
                              >
                                {st?.expanded ? "▼" : "▶"}
                              </button>
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

      {showModal && (
        <ConnectionModal onSave={handleSave} onClose={() => setShowModal(false)} />
      )}

      {editTarget && (
        <ConnectionModal
          initialConn={editTarget.conn}
          initialPassword={editTarget.password}
          onSave={handleUpdate}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* ── Modal de reconexión ── */}
      {reconnTarget && (
        <ReconnectModal
          connName={reconnTarget.conn.name}
          state={reconnState}
          error={reconnError}
          onClose={() => { setReconnTarget(null); setReconnState("idle"); setReconnError(""); }}
          onRetry={() => handleReconnect(reconnTarget)}
        />
      )}

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

type ConnStatus = "idle" | "connecting" | "connected" | "error";

const STATUS_DOT_COLOR: Record<ConnStatus, string> = {
  idle:       "#4b5563",   // gris
  connecting: "#f59e0b",   // ámbar
  connected:  "#22c55e",   // verde
  error:      "#ef4444",   // rojo
};
const STATUS_DOT_TITLE: Record<ConnStatus, string> = {
  idle:       "Sin conectar",
  connecting: "Conectando…",
  connected:  "Conectado",
  error:      "Error de conexión",
};

function StatusDot({ status }: { status: ConnStatus }) {
  const isPulsing = status === "connecting";
  return (
    <span
      title={STATUS_DOT_TITLE[status]}
      style={{
        display: "inline-block",
        width: 7, height: 7,
        borderRadius: "50%",
        background: STATUS_DOT_COLOR[status],
        flexShrink: 0,
        boxShadow: status === "connected"
          ? "0 0 5px 1px rgba(34,197,94,0.5)"
          : status === "error"
          ? "0 0 5px 1px rgba(239,68,68,0.4)"
          : "none",
        animation: isPulsing ? "datum-pulse 1s infinite" : "none",
      }}
    />
  );
}

function ReconnectModal({
  connName, state, error, onClose, onRetry,
}: {
  connName: string;
  state: "idle" | "connecting" | "ok" | "error";
  error: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div style={rStyles.overlay} onClick={onClose}>
      <div style={rStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={rStyles.header}>
          <span style={rStyles.title}>Reconectar</span>
          <button style={rStyles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={rStyles.body}>
          <div style={rStyles.connName}>{connName}</div>

          {state === "connecting" && (
            <div style={rStyles.row}>
              <span style={{ ...rStyles.dot, background: "#f59e0b", animation: "datum-pulse 1s infinite" }} />
              <span style={{ color: "var(--text-secondary)" }}>Intentando conexión…</span>
            </div>
          )}

          {state === "ok" && (
            <div style={rStyles.resultBox("ok")}>
              <span style={rStyles.resultIcon}>✓</span>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Conexión exitosa</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>El servidor respondió correctamente.</div>
              </div>
            </div>
          )}

          {state === "error" && (
            <>
              <div style={rStyles.resultBox("error")}>
                <span style={rStyles.resultIcon}>✕</span>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Fallo de conexión</div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>No se pudo establecer la conexión.</div>
                </div>
              </div>
              <details style={rStyles.details}>
                <summary style={rStyles.summary}>Ver detalles del error</summary>
                <pre style={rStyles.errorPre}>{error}</pre>
              </details>
            </>
          )}
        </div>

        <div style={rStyles.footer}>
          {state === "error" && (
            <button style={rStyles.retryBtn} onClick={onRetry}>↺ Reintentar</button>
          )}
          <button style={rStyles.closeAction} onClick={onClose}>
            {state === "ok" ? "Cerrar" : "Cancelar"}
          </button>
        </div>
      </div>
    </div>
  );
}

const rStyles: Record<string, any> = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
  },
  modal: {
    background: "var(--bg-surface)", border: "1px solid var(--border)",
    borderRadius: 10, width: 400, boxShadow: "0 20px 48px rgba(0,0,0,0.5)",
    overflow: "hidden",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 18px", borderBottom: "1px solid var(--border)",
  },
  title: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" },
  closeBtn: {
    background: "transparent", border: "none",
    color: "var(--text-secondary)", fontSize: 16, cursor: "pointer", padding: 4,
  },
  body: { padding: "20px 18px", display: "flex", flexDirection: "column", gap: 14 },
  connName: {
    fontSize: 13, fontWeight: 600, color: "var(--accent-text)",
    fontFamily: "var(--font-mono)",
  },
  row: { display: "flex", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  resultBox: (type: "ok" | "error") => ({
    display: "flex", alignItems: "flex-start", gap: 12,
    padding: "12px 14px", borderRadius: 8,
    background: type === "ok" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
    border: `1px solid ${type === "ok" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
    color: type === "ok" ? "#22c55e" : "#ef4444",
    fontSize: 13,
  }),
  resultIcon: { fontSize: 18, lineHeight: 1.2, flexShrink: 0 },
  details: { marginTop: -4 },
  summary: {
    fontSize: 11, color: "var(--text-muted)", cursor: "pointer",
    userSelect: "none", padding: "4px 0",
  },
  errorPre: {
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 6, padding: "10px 12px", fontSize: 11,
    color: "#ef4444", fontFamily: "var(--font-mono)",
    whiteSpace: "pre-wrap", wordBreak: "break-all",
    marginTop: 8, maxHeight: 140, overflowY: "auto",
  },
  footer: {
    display: "flex", justifyContent: "flex-end", gap: 8,
    padding: "12px 18px", borderTop: "1px solid var(--border)",
  },
  retryBtn: {
    padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border)",
    background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
  },
  closeAction: {
    padding: "7px 16px", borderRadius: 6, border: "none",
    background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
};

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
    <div style={{ paddingLeft: pad, paddingTop: 4, fontSize: 11, color: "var(--red)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      ✗ {msg}
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
  optionsBtn: {
    background: "transparent",
    border: "none",
    color: "var(--text-secondary)",
    fontSize: 16,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
    lineHeight: 1,
    transition: "opacity 0.1s",
    letterSpacing: 1,
  },
  connDropdown: {
    position: "absolute" as const,
    top: "calc(100% + 4px)",
    right: 0,
    zIndex: 200,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-light)",
    borderRadius: 7,
    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
    padding: "4px",
    minWidth: 150,
  },
  connDropItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 10px",
    background: "transparent",
    border: "none",
    borderRadius: 4,
    fontSize: 12,
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left" as const,
  },
  connDropSep: {
    height: 1,
    background: "var(--border)",
    margin: "3px 4px",
  },
  connDropIcon: {
    fontSize: 13,
    color: "var(--text-muted)",
    width: 14,
    textAlign: "center" as const,
  },
  toggleArrow: {
    background: "transparent",
    border: "none",
    padding: "0 4px",
    minWidth: 18,
    height: 24,
    fontSize: 11,
    color: "var(--text-secondary)",
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
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
