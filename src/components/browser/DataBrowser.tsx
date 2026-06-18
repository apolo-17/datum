import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SavedConnection, QueryResult } from "../../types";

interface BrowsedTable {
  schema: string;
  name: string;
}

interface Props {
  connection: SavedConnection | null;
  password:   string;
  table:      BrowsedTable | null;
}

const PAGE = 200;

function cellValue(v: unknown): { text: string; kind: "null" | "bool" | "num" | "text" } {
  if (v === null || v === undefined) return { text: "null", kind: "null" };
  if (typeof v === "boolean")        return { text: String(v), kind: "bool" };
  if (typeof v === "number")         return { text: String(v), kind: "num" };
  if (typeof v === "object")         return { text: JSON.stringify(v), kind: "text" };
  const s = String(v);
  return { text: s.length > 200 ? s.slice(0, 200) + "…" : s, kind: "text" };
}

export default function DataBrowser({ connection, password, table }: Props) {
  const [result,   setResult]   = useState<QueryResult | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [page,     setPage]     = useState(0);
  const [selRow,   setSelRow]   = useState<number | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setPage(0);
    setSelRow(null);
    if (!connection || !table) return;

    (async () => {
      setLoading(true);
      try {
        await invoke("open_connection", { connection, password });
        const sql = `SELECT * FROM "${table.schema}"."${table.name}" LIMIT 1000`;
        const res = await invoke<QueryResult>("execute_query", {
          connectionId: connection.id,
          sql,
        });
        setResult(res);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [connection?.id, table?.schema, table?.name]);

  // ── Sin tabla seleccionada ────────────────────────────────────────────────
  if (!connection || !table) {
    return (
      <div style={styles.empty}>
        <span style={{ fontSize: 36, opacity: 0.15 }}>⊞</span>
        <p style={styles.emptyHint}>
          Haz doble click en una tabla del ERD
          <br />o selecciónala desde el sidebar
        </p>
      </div>
    );
  }

  const rows   = result?.rows   ?? [];
  const cols   = result?.columns ?? [];
  const total  = rows.length;
  const paged  = rows.slice(page * PAGE, (page + 1) * PAGE);
  const pages  = Math.ceil(total / PAGE);

  return (
    <div style={styles.container}>
      {/* ── Header ── */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.schemaLabel}>{table.schema}</span>
          <span style={styles.dot}>·</span>
          <span style={styles.tableLabel}>{table.name}</span>
        </div>
        <div style={styles.headerRight}>
          {result && (
            <>
              <span style={styles.meta}>{total.toLocaleString()} filas</span>
              <span style={styles.meta}>·</span>
              <span style={styles.meta}>{result.execution_time_ms} ms</span>
              {cols.length > 0 && (
                <>
                  <span style={styles.meta}>·</span>
                  <span style={styles.meta}>{cols.length} columnas</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Estado ── */}
      {loading && <div style={styles.status}>Cargando…</div>}
      {error   && <div style={{ ...styles.status, color: "var(--red)" }}>✗ {error}</div>}

      {/* ── Tabla ── */}
      {result && !loading && (
        <>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {/* Columna de números de fila */}
                  <th style={{ ...styles.th, ...styles.rowNumTh }}>#</th>
                  {cols.map((col) => (
                    <th key={col.name} style={styles.th}>
                      <div style={styles.thInner}>
                        <span style={styles.colName}>{col.name}</span>
                        <span style={styles.colType}>{col.data_type}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((row, ri) => {
                  const absIdx = page * PAGE + ri;
                  const isSel  = selRow === absIdx;
                  return (
                    <tr
                      key={absIdx}
                      onClick={() => setSelRow(isSel ? null : absIdx)}
                      style={{
                        background: isSel
                          ? "var(--accent-dim)"
                          : ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.018)",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ ...styles.td, ...styles.rowNumTd }}>{absIdx + 1}</td>
                      {row.map((cell, ci) => {
                        const { text, kind } = cellValue(cell);
                        return (
                          <td
                            key={ci}
                            style={{
                              ...styles.td,
                              color:
                                kind === "null" ? "var(--text-muted)" :
                                kind === "num"  ? "var(--accent-text)" :
                                kind === "bool" ? (text === "true" ? "var(--green)" : "var(--red)") :
                                "var(--text-primary)",
                              fontStyle: kind === "null" ? "italic" : "normal",
                              textAlign: kind === "num" ? "right" : "left",
                            }}
                            title={String(cell)}
                          >
                            {kind === "bool" ? (
                              <span style={styles.boolBadge(text === "true")}>{text}</span>
                            ) : text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {paged.length === 0 && (
                  <tr>
                    <td
                      colSpan={cols.length + 1}
                      style={{ ...styles.td, textAlign: "center", color: "var(--text-muted)", padding: 24 }}
                    >
                      Sin datos
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Paginación ── */}
          {pages > 1 && (
            <div style={styles.pagination}>
              <button
                style={styles.pageBtn}
                disabled={page === 0}
                onClick={() => { setPage(p => p - 1); setSelRow(null); }}
              >
                ← Anterior
              </button>
              <span style={styles.pageInfo}>
                {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} de {total.toLocaleString()}
              </span>
              <button
                style={styles.pageBtn}
                disabled={page >= pages - 1}
                onClick={() => { setPage(p => p + 1); setSelRow(null); }}
              >
                Siguiente →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const styles: Record<string, any> = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    height: "100%",
  },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    height: "100%",
  },
  emptyHint: {
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
    lineHeight: 1.7,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "7px 14px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  schemaLabel: {
    fontSize: 10,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)",
  },
  dot: { color: "var(--text-muted)", fontSize: 10 },
  tableLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--accent-text)",
    fontFamily: "var(--font-mono)",
  },
  meta: { fontSize: 11, color: "var(--text-muted)" },
  status: {
    padding: "12px 16px",
    fontSize: 12,
    color: "var(--text-muted)",
  },
  tableWrap: {
    flex: 1,
    overflow: "auto",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
    tableLayout: "auto",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
  },
  th: {
    position: "sticky",
    top: 0,
    background: "var(--bg-elevated)",
    borderBottom: "1px solid var(--border)",
    borderRight: "1px solid rgba(255,255,255,0.04)",
    padding: "6px 10px",
    textAlign: "left",
    fontWeight: 600,
    whiteSpace: "nowrap",
    zIndex: 1,
  },
  rowNumTh: {
    width: 40,
    minWidth: 40,
    textAlign: "right",
    color: "var(--text-muted)",
    fontSize: 10,
    fontWeight: 400,
  },
  thInner: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  colName: {
    color: "var(--text-primary)",
    fontSize: 11,
  },
  colType: {
    color: "var(--text-muted)",
    fontSize: 9,
    fontWeight: 400,
    letterSpacing: "0.02em",
  },
  td: {
    padding: "5px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    borderRight: "1px solid rgba(255,255,255,0.03)",
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
  },
  rowNumTd: {
    color: "var(--text-muted)",
    fontSize: 10,
    textAlign: "right",
    userSelect: "none",
    background: "var(--bg-surface)",
    position: "sticky",
    left: 0,
  },
  boolBadge: (val: boolean): React.CSSProperties => ({
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 600,
    background: val ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)",
    color: val ? "var(--green)" : "var(--red)",
  }),
  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: "8px 14px",
    background: "var(--bg-surface)",
    borderTop: "1px solid var(--border)",
    flexShrink: 0,
  },
  pageBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text-secondary)",
    fontSize: 11,
    padding: "3px 10px",
    cursor: "pointer",
  },
  pageInfo: {
    fontSize: 11,
    color: "var(--text-muted)",
    minWidth: 120,
    textAlign: "center",
  },
};
