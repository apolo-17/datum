import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SavedConnection, QueryResult, TableSchema } from "../../types";

interface BrowsedTable { schema: string; name: string; }

interface Props {
  connection: SavedConnection | null;
  password:   string;
  table:      BrowsedTable | null;
}

interface ErrorInfo {
  sql:    string;
  msg:    string;
  row:    number;
  col:    string;
}

// Convierte el valor string del input al literal SQL correcto
function toSqlLiteral(value: string): string {
  const t = value.trim();
  if (t === "" || t.toLowerCase() === "null") return "NULL";
  if (t.toLowerCase() === "true")  return "TRUE";
  if (t.toLowerCase() === "false") return "FALSE";
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return t;
  return `'${t.replace(/'/g, "''")}'`;
}

function cellDisplay(v: unknown): { text: string; kind: "null" | "bool" | "num" | "text" } {
  if (v === null || v === undefined) return { text: "null", kind: "null" };
  if (typeof v === "boolean")        return { text: String(v), kind: "bool" };
  if (typeof v === "number")         return { text: String(v), kind: "num" };
  if (typeof v === "object")         return { text: JSON.stringify(v), kind: "text" };
  const s = String(v);
  return { text: s.length > 200 ? s.slice(0, 200) + "…" : s, kind: "text" };
}

const PAGE = 200;

type SubTab = "datos" | "estructura";

export default function DataBrowser({ connection, password, table }: Props) {
  const [subTab,         setSubTab]         = useState<SubTab>("datos");
  const [result,         setResult]         = useState<QueryResult | null>(null);
  const [ctidValues,     setCtidValues]     = useState<string[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [page,           setPage]           = useState(0);
  const [selRow,         setSelRow]         = useState<number | null>(null);

  // Estructura de la tabla (para la pestaña Estructura)
  const [tableSchema,    setTableSchema]    = useState<TableSchema | null>(null);
  const [schemaLoading,  setSchemaLoading]  = useState(false);

  // Edición inline
  const [pending,  setPending]  = useState<Map<string, string>>(new Map());
  const [editCell, setEditCell] = useState<{ row: number; col: number } | null>(null);
  const [editVal,  setEditVal]  = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Modal de error
  const [errModal, setErrModal] = useState<ErrorInfo | null>(null);
  const [saving,   setSaving]   = useState(false);

  const loadData = useCallback(async () => {
    if (!connection || !table) return;
    setLoading(true);
    setError(null);
    setPending(new Map());
    setEditCell(null);
    setPage(0);
    setSelRow(null);
    try {
      await invoke("open_connection", { connection, password });
      // ctid::text para que sqlx lo serialice correctamente (tid no es tipo estándar)
      const sql = `SELECT *, ctid::text AS __datum_ctid FROM "${table.schema}"."${table.name}" LIMIT 1000`;
      const res  = await invoke<QueryResult>("execute_query", { connectionId: connection.id, sql });

      // Separar __datum_ctid del resto
      const ctidIdx = res.columns.findIndex((c) => c.name === "__datum_ctid");
      const ctids   = res.rows.map((r) => String(r[ctidIdx]));
      const cols = res.columns.filter((c) => c.name !== "__datum_ctid");
      const rows = res.rows.map((r) => r.filter((_, i) => i !== ctidIdx));

      setCtidValues(ctids);
      setResult({ ...res, columns: cols, rows });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [connection?.id, table?.schema, table?.name]);

  useEffect(() => { loadData(); }, [loadData]);

  // Reset subTab y schema cuando cambia la tabla
  useEffect(() => {
    setSubTab("datos");
    setTableSchema(null);
  }, [table?.schema, table?.name]);

  // Carga el schema completo cuando se activa la pestaña Estructura
  useEffect(() => {
    if (subTab !== "estructura" || !connection || !table || tableSchema) return;
    (async () => {
      setSchemaLoading(true);
      try {
        await invoke("open_connection", { connection, password });
        const tables = await invoke<TableSchema[]>("get_tables", {
          connectionId: connection.id,
          schema: table.schema,
        });
        const found = tables.find((t) => t.name === table.name) ?? null;
        setTableSchema(found);
      } catch { /* schema no disponible, mostrará vacío */ }
      finally { setSchemaLoading(false); }
    })();
  }, [subTab, connection?.id, table?.schema, table?.name]);

  // Foco automático al entrar en modo edición
  useEffect(() => {
    if (editCell) setTimeout(() => inputRef.current?.focus(), 30);
  }, [editCell]);

  // ── Confirmar edición de celda ────────────────────────────────────────────
  function commitEdit() {
    if (!editCell) return;
    const key = `${editCell.row}-${editCell.col}`;
    const original = cellDisplay(result?.rows[editCell.row]?.[editCell.col]).text;
    const newPending = new Map(pending);
    if (editVal === original || (original === "null" && editVal === "")) {
      newPending.delete(key); // sin cambio real
    } else {
      newPending.set(key, editVal);
    }
    setPending(newPending);
    setEditCell(null);
  }

  function cancelEdit() { setEditCell(null); }

  function startEdit(absRow: number, colIdx: number) {
    const key = `${absRow}-${colIdx}`;
    const current = pending.get(key)
      ?? cellDisplay(result?.rows[absRow]?.[colIdx]).text;
    setEditVal(current === "null" ? "" : current);
    setEditCell({ row: absRow, col: colIdx });
  }

  // ── Guardar todos los cambios pendientes ──────────────────────────────────
  async function saveAll() {
    if (!connection || !table || pending.size === 0) return;
    const cols = result?.columns ?? [];
    setSaving(true);

    for (const [key, newVal] of pending) {
      const [rowStr, colStr] = key.split("-");
      const absRow = parseInt(rowStr);
      const colIdx = parseInt(colStr);
      const colName = cols[colIdx]?.name ?? "";
      const ctid    = ctidValues[absRow];
      const literal = toSqlLiteral(newVal);
      const sql = `UPDATE "${table.schema}"."${table.name}" SET "${colName}" = ${literal} WHERE ctid = '${ctid}'::tid`;

      try {
        await invoke("execute_query", { connectionId: connection.id, sql });
      } catch (e) {
        setSaving(false);
        setErrModal({ sql, msg: String(e), row: absRow + 1, col: colName });
        return; // detiene en el primer error
      }
    }

    setSaving(false);
    await loadData(); // recarga para mostrar datos confirmados
  }

  // ── Sin tabla ─────────────────────────────────────────────────────────────
  if (!connection || !table) {
    return (
      <div style={s.empty}>
        <span style={{ fontSize: 36, opacity: 0.15 }}>⊞</span>
        <p style={s.emptyHint}>
          Haz doble click en una tabla del ERD<br />o usa el botón ⊞ en el sidebar
        </p>
      </div>
    );
  }

  const rows  = result?.rows   ?? [];
  const cols  = result?.columns ?? [];
  const total = rows.length;
  const paged = rows.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.ceil(total / PAGE);
  const nPending = pending.size;

  return (
    <div style={s.container}>
      {/* ── Header ── */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.schemaLabel}>{table.schema}</span>
          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>·</span>
          <span style={s.tableLabel}>{table.name}</span>
          {result && (
            <span style={s.meta}>{total.toLocaleString()} filas · {cols.length} cols · {result.execution_time_ms} ms</span>
          )}
        </div>
        <div style={s.headerRight}>
          {nPending > 0 && (
            <>
              <span style={s.pendingBadge}>
                {nPending} cambio{nPending > 1 ? "s" : ""} pendiente{nPending > 1 ? "s" : ""}
              </span>
              <button
                style={s.discardBtn}
                onClick={() => { setPending(new Map()); setEditCell(null); }}
              >
                Descartar
              </button>
              <button
                style={s.saveBtn}
                onClick={saveAll}
                disabled={saving}
              >
                {saving ? "Guardando…" : `Guardar ${nPending} cambio${nPending > 1 ? "s" : ""}`}
              </button>
            </>
          )}
          <button style={s.reloadBtn} onClick={loadData} title="Recargar">↺</button>
        </div>
      </div>

      {/* ── Sub-tabs: Datos / Estructura ── */}
      <div style={s.subTabBar}>
        {(["datos", "estructura"] as SubTab[]).map((t) => (
          <button
            key={t}
            style={{
              ...s.subTab,
              borderBottom: subTab === t ? "2px solid var(--accent)" : "2px solid transparent",
              color: subTab === t ? "var(--accent-text)" : "var(--text-muted)",
              fontWeight: subTab === t ? 600 : 400,
            }}
            onClick={() => setSubTab(t)}
          >
            {t === "datos" ? "⊞ Datos" : "≡ Estructura"}
          </button>
        ))}
      </div>

      {loading && <div style={s.status}>Cargando…</div>}
      {error   && <div style={{ ...s.status, color: "var(--red)" }}>✗ {error}</div>}

      {/* ── Pestaña Estructura ── */}
      {subTab === "estructura" && !loading && (
        <div style={s.tableWrap}>
          {schemaLoading && <div style={s.status}>Cargando estructura…</div>}
          {!schemaLoading && (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={{ ...s.th, ...s.rowNumTh }}>#</th>
                  <th style={s.th}>Columna</th>
                  <th style={s.th}>Tipo</th>
                  <th style={{ ...s.th, textAlign: "center" }}>Null</th>
                  <th style={{ ...s.th, textAlign: "center" }}>PK</th>
                  <th style={s.th}>FK → referencia</th>
                </tr>
              </thead>
              <tbody>
                {(tableSchema?.columns ?? []).map((col, i) => (
                  <tr key={col.name} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.018)" }}>
                    <td style={{ ...s.td, ...s.rowNumTd }}>{i + 1}</td>
                    <td style={{ ...s.td, ...s.structCell }}>
                      <span style={{ color: "var(--text-primary)", fontWeight: col.is_primary_key ? 600 : 400 }}>
                        {col.name}
                      </span>
                    </td>
                    <td style={{ ...s.td, ...s.structCell }}>
                      <span style={s.typeChip}>{col.data_type}</span>
                    </td>
                    <td style={{ ...s.td, ...s.structCell, textAlign: "center" }}>
                      {col.nullable
                        ? <span style={s.nullBadge}>YES</span>
                        : <span style={s.notNullBadge}>NO</span>}
                    </td>
                    <td style={{ ...s.td, ...s.structCell, textAlign: "center" }}>
                      {col.is_primary_key && <span style={s.pkBadge}>PK</span>}
                    </td>
                    <td style={{ ...s.td, ...s.structCell }}>
                      {col.is_foreign_key && col.references_table && (
                        <span style={s.fkRef}>
                          <span style={s.fkBadge}>FK</span>
                          <span style={s.fkArrow}>→</span>
                          <span style={s.fkTarget}>
                            {col.references_table}
                            {col.references_column ? `.${col.references_column}` : ""}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!tableSchema && !schemaLoading && (
                  <tr>
                    <td colSpan={6} style={{ ...s.td, textAlign: "center", color: "var(--text-muted)", padding: 28 }}>
                      Sin información de estructura disponible
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Pestaña Datos ── */}
      {subTab === "datos" && !loading && !error && result && (
        <>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={{ ...s.th, ...s.rowNumTh }}>#</th>
                  {cols.map((col) => (
                    <th key={col.name} style={s.th}>
                      <div style={s.thInner}>
                        <span style={s.colName}>{col.name}</span>
                        <span style={s.colType}>{col.data_type}</span>
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
                      style={{
                        background: isSel
                          ? "rgba(99,102,241,0.12)"
                          : ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.018)",
                      }}
                      onClick={() => setSelRow(isSel ? null : absIdx)}
                    >
                      <td style={{ ...s.td, ...s.rowNumTd }}>{absIdx + 1}</td>

                      {row.map((cell, ci) => {
                        const key    = `${absIdx}-${ci}`;
                        const isPend = pending.has(key);
                        const isEdit = editCell?.row === absIdx && editCell?.col === ci;
                        const { text, kind } = cellDisplay(cell);
                        const dispVal = isPend ? pending.get(key)! : text;

                        return (
                          <td
                            key={ci}
                            style={{
                              ...s.td,
                              background: isPend
                                ? "rgba(251,191,36,0.12)"
                                : undefined,
                              outline: isPend
                                ? "1px solid rgba(251,191,36,0.4)"
                                : undefined,
                              cursor: "text",
                              padding: 0,
                            }}
                            onDoubleClick={() => startEdit(absIdx, ci)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isEdit ? (
                              // Input flotante: no queda atrapado en el maxWidth del td
                              <div style={{ position: "relative" }}>
                                <div style={s.cellInner}>{dispVal}</div>
                                <input
                                  ref={inputRef}
                                  value={editVal}
                                  onChange={(e) => setEditVal(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")  { commitEdit(); }
                                    if (e.key === "Escape") { cancelEdit(); }
                                    if (e.key === "Tab") {
                                      e.preventDefault();
                                      commitEdit();
                                      const nextCol = e.shiftKey ? ci - 1 : ci + 1;
                                      if (nextCol >= 0 && nextCol < cols.length) {
                                        startEdit(absIdx, nextCol);
                                      }
                                    }
                                  }}
                                  onBlur={commitEdit}
                                  style={s.cellInput}
                                />
                              </div>
                            ) : (
                              <div
                                style={{
                                  ...s.cellInner,
                                  color:
                                    isPend ? "#fbbf24" :
                                    kind === "null" ? "var(--text-muted)" :
                                    kind === "num"  ? "var(--accent-text)" :
                                    kind === "bool" ? (text === "true" ? "var(--green)" : "var(--red)") :
                                    "var(--text-primary)",
                                  fontStyle: !isPend && kind === "null" ? "italic" : "normal",
                                  textAlign: kind === "num" ? "right" : "left",
                                }}
                                title={`${String(cell)}\n\nDoble click para editar`}
                              >
                                {kind === "bool" && !isPend
                                  ? <span style={s.boolBadge(text === "true")}>{text}</span>
                                  : dispVal}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={cols.length + 1} style={{ ...s.td, textAlign: "center", color: "var(--text-muted)", padding: 28 }}>
                      Sin datos
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div style={s.pagination}>
              <button style={s.pageBtn} disabled={page === 0}
                onClick={() => { setPage(p => p - 1); setSelRow(null); }}>← Anterior</button>
              <span style={s.pageInfo}>
                {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} de {total.toLocaleString()}
              </span>
              <button style={s.pageBtn} disabled={page >= pages - 1}
                onClick={() => { setPage(p => p + 1); setSelRow(null); }}>Siguiente →</button>
            </div>
          )}
        </>
      )}

      {/* ── Modal de error ── */}
      {errModal && (
        <div style={s.modalOverlay} onClick={() => setErrModal(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={s.modalIcon}>⚠</span>
              <span style={s.modalTitle}>Error al guardar cambio</span>
            </div>

            <div style={s.modalBody}>
              <div style={s.modalRow}>
                <span style={s.modalLabel}>Tabla</span>
                <span style={s.modalValue}>{table.schema}.{table.name}</span>
              </div>
              <div style={s.modalRow}>
                <span style={s.modalLabel}>Fila</span>
                <span style={s.modalValue}>{errModal.row}</span>
              </div>
              <div style={s.modalRow}>
                <span style={s.modalLabel}>Columna</span>
                <span style={s.modalValue}>{errModal.col}</span>
              </div>

              <div style={s.modalSection}>Query ejecutado:</div>
              <pre style={s.modalCode}>{errModal.sql}</pre>

              <div style={s.modalSection}>Error de la base de datos:</div>
              <pre style={s.modalError}>{errModal.msg}</pre>
            </div>

            <div style={s.modalFooter}>
              <button
                style={s.modalBtnSecondary}
                onClick={() => setErrModal(null)}
              >
                Cancelar todo
              </button>
              <button
                style={s.modalBtnPrimary}
                onClick={async () => {
                  // Elimina este cambio del pending y continúa guardando el resto
                  const [rowStr, colStr] = [`${errModal.row - 1}`, cols.findIndex(c => c.name === errModal.col).toString()];
                  const newPending = new Map(pending);
                  newPending.delete(`${rowStr}-${colStr}`);
                  setPending(newPending);
                  setErrModal(null);
                  // Reintenta con el resto
                  await saveAll();
                }}
              >
                Saltar este cambio y continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const s: Record<string, any> = {
  container:    { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" },
  empty:        { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, height: "100%" },
  emptyHint:    { fontSize: 13, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.7 },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "6px 14px", background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)", flexShrink: 0, gap: 10,
  },
  headerLeft:   { display: "flex", alignItems: "center", gap: 6 },
  headerRight:  { display: "flex", alignItems: "center", gap: 6 },
  schemaLabel:  { fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" },
  tableLabel:   { fontSize: 13, fontWeight: 700, color: "var(--accent-text)", fontFamily: "var(--font-mono)" },
  meta:         { fontSize: 10, color: "var(--text-muted)", marginLeft: 6 },
  pendingBadge: {
    fontSize: 10, fontWeight: 600,
    background: "rgba(251,191,36,0.15)", color: "#fbbf24",
    border: "1px solid rgba(251,191,36,0.3)", borderRadius: 4,
    padding: "2px 8px",
  },
  saveBtn: {
    background: "var(--accent)", border: "none", borderRadius: 4,
    color: "#fff", fontSize: 11, fontWeight: 600,
    padding: "4px 12px", cursor: "pointer",
  },
  discardBtn: {
    background: "transparent", border: "1px solid var(--border)",
    borderRadius: 4, color: "var(--text-muted)", fontSize: 11,
    padding: "4px 10px", cursor: "pointer",
  },
  reloadBtn: {
    background: "transparent", border: "1px solid var(--border)",
    borderRadius: 4, color: "var(--text-muted)", fontSize: 14,
    width: 26, height: 26, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  status: { padding: "12px 16px", fontSize: 12, color: "var(--text-muted)" },
  tableWrap: { flex: 1, overflow: "auto" },
  table: {
    borderCollapse: "collapse", width: "100%", tableLayout: "auto",
    fontFamily: "var(--font-mono)", fontSize: 12,
  },
  th: {
    position: "sticky", top: 0, background: "var(--bg-elevated)",
    borderBottom: "1px solid var(--border)",
    borderRight: "1px solid rgba(255,255,255,0.04)",
    padding: "6px 10px", textAlign: "left",
    fontWeight: 600, whiteSpace: "nowrap", zIndex: 1,
  },
  rowNumTh: { width: 44, minWidth: 44, textAlign: "right", color: "var(--text-muted)", fontSize: 10, fontWeight: 400 },
  thInner:  { display: "flex", flexDirection: "column", gap: 1 },
  colName:  { color: "var(--text-primary)", fontSize: 11 },
  colType:  { color: "var(--text-muted)", fontSize: 9, fontWeight: 400 },
  td: {
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    borderRight: "1px solid rgba(255,255,255,0.03)",
    maxWidth: 320, overflow: "hidden",
    fontSize: 12, verticalAlign: "middle",
  },
  rowNumTd: {
    color: "var(--text-muted)", fontSize: 10, textAlign: "right",
    userSelect: "none", background: "var(--bg-surface)",
    position: "sticky", left: 0, padding: "5px 8px",
  },
  cellInner: {
    padding: "5px 10px", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
    minHeight: 28,
  },
  cellInput: {
    position: "absolute",
    top: 0, left: 0,
    minWidth: 280,
    width: "max-content",
    zIndex: 50,
    background: "var(--bg-elevated)",
    border: "2px solid var(--accent)",
    borderRadius: 4,
    color: "var(--text-primary)",
    fontSize: 12, fontFamily: "var(--font-mono)",
    padding: "4px 10px",
    outline: "none",
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    minHeight: 30,
  },
  boolBadge: (val: boolean): React.CSSProperties => ({
    display: "inline-block", padding: "1px 6px", borderRadius: 3,
    fontSize: 10, fontWeight: 600,
    background: val ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)",
    color: val ? "var(--green)" : "var(--red)",
  }),
  pagination: {
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: 12, padding: "8px 14px",
    background: "var(--bg-surface)", borderTop: "1px solid var(--border)", flexShrink: 0,
  },
  pageBtn:  { background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-secondary)", fontSize: 11, padding: "3px 10px", cursor: "pointer" },
  pageInfo: { fontSize: 11, color: "var(--text-muted)", minWidth: 140, textAlign: "center" },

  // ── Sub-tabs ──
  subTabBar: {
    display: "flex", gap: 0,
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0, paddingLeft: 8,
  },
  subTab: {
    padding: "7px 16px", fontSize: 12,
    background: "transparent", border: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer", transition: "all 0.15s",
    letterSpacing: "0.01em",
  },

  // ── Estructura ──
  structCell: { padding: "6px 12px", fontFamily: "var(--font-mono)", fontSize: 12 },
  typeChip: {
    display: "inline-block",
    background: "rgba(129,140,248,0.1)", color: "var(--accent-text)",
    border: "1px solid rgba(129,140,248,0.2)",
    borderRadius: 4, padding: "1px 7px", fontSize: 11,
    fontFamily: "var(--font-mono)",
  },
  nullBadge: {
    display: "inline-block", padding: "1px 7px", borderRadius: 4,
    fontSize: 10, fontWeight: 600,
    background: "rgba(255,255,255,0.05)", color: "var(--text-muted)",
  },
  notNullBadge: {
    display: "inline-block", padding: "1px 7px", borderRadius: 4,
    fontSize: 10, fontWeight: 600,
    background: "rgba(239,68,68,0.1)", color: "var(--red)",
  },
  pkBadge: {
    display: "inline-block", padding: "1px 7px", borderRadius: 4,
    fontSize: 10, fontWeight: 700,
    background: "rgba(251,191,36,0.12)", color: "#fbbf24",
    border: "1px solid rgba(251,191,36,0.25)",
  },
  fkRef:    { display: "flex", alignItems: "center", gap: 5 },
  fkBadge: {
    display: "inline-block", padding: "1px 6px", borderRadius: 4,
    fontSize: 10, fontWeight: 700,
    background: "rgba(129,140,248,0.12)", color: "#818cf8",
    border: "1px solid rgba(129,140,248,0.25)",
  },
  fkArrow:  { color: "var(--text-muted)", fontSize: 11 },
  fkTarget: { color: "var(--accent-text)", fontSize: 11, fontFamily: "var(--font-mono)" },

  // ── Modal ──
  modalOverlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modal: {
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 10, width: 520, maxWidth: "90vw",
    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    overflow: "hidden",
  },
  modalHeader: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "14px 18px", borderBottom: "1px solid var(--border)",
    background: "rgba(239,68,68,0.08)",
  },
  modalIcon:  { fontSize: 16, color: "var(--red)" },
  modalTitle: { fontSize: 14, fontWeight: 700, color: "var(--text-primary)" },
  modalBody:  { padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 },
  modalRow:   { display: "flex", gap: 12, alignItems: "baseline" },
  modalLabel: { fontSize: 11, color: "var(--text-muted)", width: 70, flexShrink: 0 },
  modalValue: { fontSize: 12, color: "var(--text-primary)", fontFamily: "var(--font-mono)" },
  modalSection: { fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 6 },
  modalCode: {
    background: "var(--bg-surface)", border: "1px solid var(--border)",
    borderRadius: 6, padding: "10px 12px",
    fontSize: 11, fontFamily: "var(--font-mono)",
    color: "var(--accent-text)", margin: 0,
    whiteSpace: "pre-wrap", wordBreak: "break-all",
    maxHeight: 120, overflow: "auto",
  },
  modalError: {
    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 6, padding: "10px 12px",
    fontSize: 11, fontFamily: "var(--font-mono)",
    color: "var(--red)", margin: 0,
    whiteSpace: "pre-wrap", wordBreak: "break-all",
    maxHeight: 120, overflow: "auto",
  },
  modalFooter: {
    display: "flex", justifyContent: "flex-end", gap: 8,
    padding: "12px 18px", borderTop: "1px solid var(--border)",
  },
  modalBtnSecondary: {
    background: "transparent", border: "1px solid var(--border)",
    borderRadius: 5, color: "var(--text-secondary)",
    fontSize: 12, padding: "6px 14px", cursor: "pointer",
  },
  modalBtnPrimary: {
    background: "var(--accent)", border: "none",
    borderRadius: 5, color: "#fff",
    fontSize: 12, fontWeight: 600, padding: "6px 14px", cursor: "pointer",
  },
};
