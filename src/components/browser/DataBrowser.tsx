import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { SavedConnection, QueryResult, TableSchema } from "../../types";

interface BrowsedTable { schema: string; name: string; }

interface Props {
  connection:   SavedConnection | null;
  password:     string;
  table:        BrowsedTable | null;
  schema?:      string | null;
  onTableOpen?: (schema: string, name: string) => void;
}

interface ErrorInfo { sql: string; msg: string; row: number; col: string; }

// ── Filtros ───────────────────────────────────────────────────────────────────
type FilterOp =
  | "contains" | "not_contains" | "starts_with"
  | "=" | "!=" | ">" | "<" | ">=" | "<="
  | "is_null" | "is_not_null";

const OP_LABELS: Record<FilterOp, string> = {
  "contains":    "contiene",
  "not_contains":"no contiene",
  "starts_with": "empieza con",
  "=":           "= igual a",
  "!=":          "≠ distinto de",
  ">":           "> mayor que",
  "<":           "< menor que",
  ">=":          "≥ mayor o igual",
  "<=":          "≤ menor o igual",
  "is_null":     "es NULL",
  "is_not_null": "no es NULL",
};

interface FilterEntry { col: string; op: FilterOp; value: string; }

function buildFilterSQL(f: FilterEntry): string {
  const col = `"${f.col}"`;
  const val = f.value.replace(/'/g, "''");
  switch (f.op) {
    case "=":            return `${col}::text = '${val}'`;
    case "!=":           return `${col}::text != '${val}'`;
    case ">":            return `${col} > '${val}'`;
    case "<":            return `${col} < '${val}'`;
    case ">=":           return `${col} >= '${val}'`;
    case "<=":           return `${col} <= '${val}'`;
    case "contains":     return `${col}::text ILIKE '%${val}%'`;
    case "not_contains": return `${col}::text NOT ILIKE '%${val}%'`;
    case "starts_with":  return `${col}::text ILIKE '${val}%'`;
    case "is_null":      return `${col} IS NULL`;
    case "is_not_null":  return `${col} IS NOT NULL`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const NULL_SENTINEL = "__DATUM_NULL__";

function toSqlLiteral(value: string): string {
  if (value === NULL_SENTINEL) return "NULL";
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

const PAGE_SIZE = 100;
type SubTab = "datos" | "estructura";

// ── ColBar ────────────────────────────────────────────────────────────────────
function ColBar({ columns }: { columns: TableSchema["columns"] }) {
  const total = columns.length;
  if (total === 0) return null;
  const pk   = columns.filter((c) => c.is_primary_key).length;
  const fk   = columns.filter((c) => c.is_foreign_key && !c.is_primary_key).length;
  const rest = total - pk - fk;
  return (
    <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", width: 120, flexShrink: 0 }}>
      {pk   > 0 && <div style={{ width: `${(pk   / total) * 100}%`, background: "#fbbf24" }} />}
      {fk   > 0 && <div style={{ width: `${(fk   / total) * 100}%`, background: "#818cf8" }} />}
      {rest > 0 && <div style={{ width: `${(rest / total) * 100}%`, background: "rgba(255,255,255,0.1)" }} />}
    </div>
  );
}

// ── Schema Overview ───────────────────────────────────────────────────────────
function SchemaOverview({ connection, password, schema, onTableOpen }: {
  connection: SavedConnection; password: string; schema: string;
  onTableOpen: (schema: string, name: string) => void;
}) {
  const [tables,   setTables]   = useState<TableSchema[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [search,   setSearch]   = useState("");
  const [hovered,  setHovered]  = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSearch(""); setSelected(null); setLoading(true); setError(null);
    (async () => {
      try {
        await invoke("open_connection", { connection, password });
        const result = await invoke<TableSchema[]>("get_tables", { connectionId: connection.id, schema });
        setTables(result);
      } catch (e) { setError(String(e)); }
      finally { setLoading(false); }
    })();
  }, [connection.id, schema]);

  const filtered = tables.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  const withFk   = tables.filter((t) => t.columns.some((c) => c.is_foreign_key)).length;
  const maxCols  = Math.max(...tables.map((t) => t.columns.length), 1);

  if (loading) return <div style={ov.center}><span style={ov.hint}>Cargando tablas…</span></div>;
  if (error)   return <div style={{ ...ov.center, color: "var(--red)" }}>✗ {error}</div>;

  return (
    <div style={ov.container}>
      <div style={ov.header}>
        <div style={ov.headerLeft}>
          <span style={ov.schemaChip}>◈ {schema}</span>
          <span style={ov.stat}>{tables.length} tablas</span>
          <span style={ov.sep}>·</span>
          <span style={ov.stat}>{withFk} con FK</span>
        </div>
        <input style={ov.search} placeholder="Filtrar tabla…" value={search}
          onChange={(e) => setSearch(e.target.value)} autoFocus />
      </div>
      <div style={ov.colHeader}>
        <span style={{ flex: 1 }}>Tabla</span>
        <span style={{ width: 120 }}>Composición</span>
        <span style={{ width: 52, textAlign: "right" }}>Cols</span>
        <span style={{ width: 44, textAlign: "center" }}>PK</span>
        <span style={{ width: 44, textAlign: "center" }}>FK</span>
        <span style={{ width: 80 }} />
      </div>
      <div style={ov.list}>
        {filtered.map((table) => {
          const pkCount  = table.columns.filter((c) => c.is_primary_key).length;
          const fkCount  = table.columns.filter((c) => c.is_foreign_key).length;
          const colCount = table.columns.length;
          const isHov    = hovered  === table.name;
          const isSel    = selected === table.name;
          return (
            <div key={table.name} style={{
              ...ov.row,
              background: isSel ? "rgba(129,140,248,0.1)" : isHov ? "rgba(129,140,248,0.05)" : "transparent",
              borderLeft: isSel ? "3px solid var(--accent)" : isHov ? "3px solid rgba(129,140,248,0.4)" : "3px solid transparent",
            }}
              onMouseEnter={() => setHovered(table.name)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => { setSelected(table.name); onTableOpen(schema, table.name); }}
            >
              <div style={ov.tableName}>
                <span style={ov.tableIcon}>▤</span>
                <span style={{ ...ov.nameText, color: isSel ? "var(--accent-text)" : "var(--text-primary)" }}>
                  {table.name}
                </span>
              </div>
              <div style={{ width: 120 }}><ColBar columns={table.columns} /></div>
              <div style={{ width: 52, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                <div style={{ height: 3, borderRadius: 2, flexShrink: 0, background: "rgba(255,255,255,0.15)", width: Math.round((colCount / maxCols) * 28) }} />
                <span style={ov.num}>{colCount}</span>
              </div>
              <div style={{ width: 44, textAlign: "center" }}>
                {pkCount > 0 ? <span style={ov.pkChip}>{pkCount}</span> : <span style={ov.dash}>—</span>}
              </div>
              <div style={{ width: 44, textAlign: "center" }}>
                {fkCount > 0 ? <span style={ov.fkChip}>{fkCount}</span> : <span style={ov.dash}>—</span>}
              </div>
              <div style={{ width: 80, display: "flex", justifyContent: "flex-end" }}>
                <span style={{ ...ov.openBtn, opacity: isHov || isSel ? 1 : 0 }}>Abrir →</span>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ ...ov.center, paddingTop: 48 }}>
            <span style={ov.hint}>Sin resultados para "{search}"</span>
          </div>
        )}
      </div>
      <div style={ov.legend}>
        <div style={ov.legendItem}><div style={{ ...ov.legendDot, background: "#fbbf24" }} /> PK</div>
        <div style={ov.legendItem}><div style={{ ...ov.legendDot, background: "#818cf8" }} /> FK</div>
        <div style={ov.legendItem}><div style={{ ...ov.legendDot, background: "rgba(255,255,255,0.1)" }} /> Regular</div>
      </div>
    </div>
  );
}

const ov: Record<string, any> = {
  container:  { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" },
  center:     { flex: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  hint:       { fontSize: 13, color: "var(--text-muted)" },
  header:     { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0, gap: 12 },
  headerLeft: { display: "flex", alignItems: "center", gap: 8 },
  schemaChip: { fontSize: 14, fontWeight: 700, color: "var(--accent-text)", fontFamily: "var(--font-mono)" },
  stat:       { fontSize: 11, color: "var(--text-muted)" },
  sep:        { fontSize: 11, color: "var(--border-light)" },
  search:     { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontSize: 12, padding: "6px 12px", outline: "none", width: 220, fontFamily: "var(--font-mono)" },
  colHeader:  { display: "flex", alignItems: "center", padding: "5px 20px 5px 23px", background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.07em", textTransform: "uppercase", flexShrink: 0 },
  list:       { flex: 1, overflowY: "auto" },
  row:        { display: "flex", alignItems: "center", padding: "0 20px", height: 42, cursor: "pointer", transition: "all 0.1s", borderBottom: "1px solid rgba(255,255,255,0.03)" },
  tableName:  { flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  tableIcon:  { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 },
  nameText:   { fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "color 0.1s" },
  num:        { fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)", flexShrink: 0 },
  dash:       { fontSize: 12, color: "rgba(255,255,255,0.1)" },
  pkChip:     { display: "inline-block", minWidth: 20, textAlign: "center", padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "rgba(251,191,36,0.12)", color: "#fbbf24" },
  fkChip:     { display: "inline-block", minWidth: 20, textAlign: "center", padding: "1px 6px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: "rgba(129,140,248,0.12)", color: "#818cf8" },
  openBtn:    { fontSize: 11, fontWeight: 600, color: "var(--accent-text)", transition: "opacity 0.15s" },
  legend:     { display: "flex", gap: 16, padding: "6px 20px", borderTop: "1px solid var(--border)", background: "var(--bg-elevated)", flexShrink: 0 },
  legendItem: { display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" },
  legendDot:  { width: 8, height: 8, borderRadius: 2 },
};

// ── DataBrowser ───────────────────────────────────────────────────────────────
export default function DataBrowser({ connection, password, table, schema, onTableOpen }: Props) {
  const [subTab,        setSubTab]        = useState<SubTab>("datos");
  const [result,        setResult]        = useState<QueryResult | null>(null);
  const [ctidValues,    setCtidValues]    = useState<string[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [page,          setPage]          = useState(0);
  const [totalCount,    setTotalCount]    = useState<number>(0);
  const [selRow,        setSelRow]        = useState<number | null>(null);
  const [filters,       setFilters]       = useState<FilterEntry[]>([]);
  const [filterDraft,   setFilterDraft]   = useState<FilterEntry[]>([]);
  const [showFilter,    setShowFilter]    = useState(false);
  const [tableSchema,   setTableSchema]   = useState<TableSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [pending,       setPending]       = useState<Map<string, string>>(new Map());
  const [editCell,      setEditCell]      = useState<{ row: number; col: number } | null>(null);
  const [editVal,       setEditVal]       = useState("");
  const [saving,        setSaving]        = useState(false);
  const [errModal,      setErrModal]      = useState<ErrorInfo | null>(null);
  const [colWidths,     setColWidths]     = useState<Record<string, number>>({});
  // Export
  const [showExport,    setShowExport]    = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportStatus,  setExportStatus]  = useState<{ ok: boolean; msg: string } | null>(null);
  const [exportLimit,   setExportLimit]   = useState<number | null>(50_000);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setColWidths({}); }, [table?.schema, table?.name]);

  function getColW(name: string) { return colWidths[name] ?? 160; }

  function startResize(e: React.MouseEvent, colName: string) {
    e.preventDefault();
    const startX = e.clientX, startW = getColW(colName);
    function onMove(ev: MouseEvent) {
      setColWidths((prev) => ({ ...prev, [colName]: Math.max(60, startW + (ev.clientX - startX)) }));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ── Export ──────────────────────────────────────────────────────────────────
  async function exportData(format: "csv" | "json") {
    if (!connection || !table) return;

    // 1. Diálogo nativo para elegir dónde guardar
    const defaultName = `${table.schema}_${table.name}.${format}`;
    const chosenPath = await save({
      title: `Guardar como ${format.toUpperCase()}`,
      defaultPath: defaultName,
      filters: [{ name: format === "csv" ? "CSV" : "JSON", extensions: [format] }],
    });
    if (!chosenPath) return; // usuario canceló

    setExportLoading(true);
    setExportStatus(null);
    setShowExport(false);

    try {
      await invoke("open_connection", { connection, password });
      const base = `"${table.schema}"."${table.name}"`;

      const whereParts = filters.filter((f) => {
        if (f.op === "is_null" || f.op === "is_not_null") return !!f.col;
        return f.col && f.value.trim() !== "";
      }).map(buildFilterSQL);
      const where = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

      const limitClause = exportLimit !== null ? ` LIMIT ${exportLimit}` : "";
      const sql = `SELECT * FROM ${base} ${where}${limitClause}`;
      const res = await invoke<QueryResult>("execute_query", { connectionId: connection.id, sql });

      let content: string;
      if (format === "csv") {
        const header = res.columns.map((c) => `"${c.name}"`).join(",");
        const body   = res.rows.map((r) =>
          r.map((c) => c === null ? "" : `"${String(c).replace(/"/g, '""')}"`).join(",")
        );
        content = [header, ...body].join("\n");
      } else {
        const data = res.rows.map((row) =>
          Object.fromEntries(res.columns.map((col, i) => [col.name, row[i]]))
        );
        content = JSON.stringify(data, null, 2);
      }

      await invoke("write_file_to_path", { path: chosenPath, content });
      setExportStatus({ ok: true, msg: `✓ ${res.rows.length.toLocaleString()} filas guardadas en:\n${chosenPath}` });
    } catch (e) {
      setExportStatus({ ok: false, msg: String(e) });
    } finally {
      setExportLoading(false);
      setShowExport(true); // vuelve a abrir el dropdown para mostrar resultado
    }
  }

  // ── Load data ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async (targetPage = 0, activeFilters: FilterEntry[] = filters) => {
    if (!connection || !table) return;
    setLoading(true); setError(null);
    setPending(new Map()); setEditCell(null); setSelRow(null);
    try {
      await invoke("open_connection", { connection, password });
      const base = `"${table.schema}"."${table.name}"`;

      const whereParts = activeFilters.filter((f) => {
        if (f.op === "is_null" || f.op === "is_not_null") return !!f.col;
        return f.col && f.value.trim() !== "";
      }).map(buildFilterSQL);
      const where = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

      const countRes = await invoke<QueryResult>("execute_query", {
        connectionId: connection.id,
        sql: `SELECT COUNT(*) FROM ${base} ${where}`,
      });
      setTotalCount(Number(countRes.rows[0]?.[0] ?? 0));
      setPage(targetPage);

      const offset = targetPage * PAGE_SIZE;
      const res = await invoke<QueryResult>("execute_query", {
        connectionId: connection.id,
        sql: `SELECT *, ctid::text AS __datum_ctid FROM ${base} ${where} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      });

      const ctidIdx = res.columns.findIndex((c) => c.name === "__datum_ctid");
      setCtidValues(res.rows.map((r) => String(r[ctidIdx])));
      setResult({ ...res, columns: res.columns.filter((c) => c.name !== "__datum_ctid"), rows: res.rows.map((r) => r.filter((_, i) => i !== ctidIdx)) });
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [connection?.id, table?.schema, table?.name]);

  useEffect(() => { loadData(0, []); setFilters([]); setFilterDraft([]); }, [loadData]);

  useEffect(() => { setSubTab("datos"); setTableSchema(null); }, [table?.schema, table?.name]);

  useEffect(() => {
    if (subTab !== "estructura" || !connection || !table || tableSchema) return;
    (async () => {
      setSchemaLoading(true);
      try {
        await invoke("open_connection", { connection, password });
        const tables = await invoke<TableSchema[]>("get_tables", { connectionId: connection.id, schema: table.schema });
        setTableSchema(tables.find((t) => t.name === table.name) ?? null);
      } catch { /* silent */ }
      finally { setSchemaLoading(false); }
    })();
  }, [subTab, connection?.id, table?.schema, table?.name]);

  useEffect(() => { if (editCell) setTimeout(() => inputRef.current?.focus(), 30); }, [editCell]);

  // ── Cell edit ───────────────────────────────────────────────────────────────
  function commitEdit() {
    if (!editCell) return;
    const key      = `${editCell.row}-${editCell.col}`;
    const original = cellDisplay(result?.rows[editCell.row]?.[editCell.col]).text;
    const newPending = new Map(pending);
    if (editVal === original) {
      newPending.delete(key);
    } else {
      newPending.set(key, editVal === "" ? NULL_SENTINEL : editVal);
    }
    setPending(newPending);
    setEditCell(null);
  }

  function setNullAndCommit() {
    if (!editCell) return;
    const key = `${editCell.row}-${editCell.col}`;
    const newPending = new Map(pending);
    newPending.set(key, NULL_SENTINEL);
    setPending(newPending);
    setEditCell(null);
  }

  function cancelEdit() { setEditCell(null); }

  function startEdit(absRow: number, colIdx: number) {
    const key     = `${absRow}-${colIdx}`;
    const current = pending.get(key) ?? cellDisplay(result?.rows[absRow]?.[colIdx]).text;
    setEditVal(current === "null" || current === NULL_SENTINEL ? "" : current);
    setEditCell({ row: absRow, col: colIdx });
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function saveAll() {
    if (!connection || !table || pending.size === 0) return;
    const cols = result?.columns ?? [];
    setSaving(true);
    for (const [key, newVal] of pending) {
      const [rowStr, colStr] = key.split("-");
      const absRow  = parseInt(rowStr);
      const colIdx  = parseInt(colStr);
      const colName = cols[colIdx]?.name ?? "";
      const ctid    = ctidValues[absRow];
      const literal = toSqlLiteral(newVal);
      const sql = `UPDATE "${table.schema}"."${table.name}" SET "${colName}" = ${literal} WHERE ctid = '${ctid}'::tid`;
      try {
        await invoke("execute_query", { connectionId: connection.id, sql });
      } catch (e) {
        setSaving(false);
        setErrModal({ sql, msg: String(e), row: absRow + 1, col: colName });
        return;
      }
    }
    setSaving(false);
    await loadData();
  }

  // ── Early returns ─────────────────────────────────────────────────────────
  if (!connection) return (
    <div style={s.empty}>
      <span style={{ fontSize: 36, opacity: 0.15 }}>⊞</span>
      <p style={s.emptyHint}>Selecciona una base de datos en el sidebar</p>
    </div>
  );

  if (!table && schema) return (
    <SchemaOverview connection={connection} password={password} schema={schema} onTableOpen={onTableOpen ?? (() => {})} />
  );

  if (!table) return (
    <div style={s.empty}>
      <span style={{ fontSize: 36, opacity: 0.15 }}>⊞</span>
      <p style={s.emptyHint}>Haz click en un schema del sidebar para ver sus tablas<br />o haz click en una tabla para ver sus datos</p>
    </div>
  );

  const rows    = result?.rows    ?? [];
  const cols    = result?.columns ?? [];
  const pages   = Math.ceil(totalCount / PAGE_SIZE);
  const nPend   = pending.size;
  const nFilters = filters.filter((f) => f.col && (f.op === "is_null" || f.op === "is_not_null" || f.value.trim() !== "")).length;

  return (
    <div style={s.container}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.schemaLabel}>{table.schema}</span>
          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>·</span>
          <span style={s.tableLabel}>{table.name}</span>
          {result && <span style={s.meta}>{totalCount.toLocaleString()} filas · {cols.length} cols · {result.execution_time_ms}ms</span>}
        </div>
        <div style={s.headerRight}>
          {nPend > 0 && <>
            <span style={s.pendingBadge}>{nPend} cambio{nPend > 1 ? "s" : ""} pendiente{nPend > 1 ? "s" : ""}</span>
            <button style={s.btnSecondary} onClick={() => { setPending(new Map()); setEditCell(null); }}>Descartar</button>
            <button style={s.btnPrimary} onClick={saveAll} disabled={saving}>{saving ? "Guardando…" : `Guardar ${nPend}`}</button>
          </>}

          {result && (
            <div style={{ position: "relative" }}>
              <button
                style={{ ...s.btnTool, color: exportLoading ? "var(--accent-text)" : "var(--text-muted)" }}
                onClick={() => { setShowExport((v) => !v); setExportStatus(null); }}
                title="Exportar datos como CSV o JSON"
                disabled={exportLoading}
              >
                {exportLoading ? "⏳ Exportando…" : "⬇ Exportar"}
              </button>
              {showExport && (
                <div style={s.exportDropdown} onClick={(e) => e.stopPropagation()}>
                  <div style={s.exportTitle}>Exportar datos</div>

                  {!exportLoading && !exportStatus && (
                    <>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
                        Se abrirá un diálogo para elegir dónde guardar.
                      </div>

                      {/* Selector de filas */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 5 }}>
                          Filas a exportar ({totalCount.toLocaleString()} totales)
                        </div>
                        {([
                          [1_000,  "1,000 filas"],
                          [10_000, "10,000 filas"],
                          [50_000, "50,000 filas"],
                          [null,   "Todas ⚠"],
                        ] as [number | null, string][]).map(([val, label]) => (
                          <label key={String(val)} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-primary)", padding: "3px 0", cursor: "pointer" }}>
                            <input type="radio" name="exportLimit" checked={exportLimit === val}
                              onChange={() => setExportLimit(val)} style={{ accentColor: "var(--accent)" }} />
                            {label}
                            {val === null && totalCount > 100_000 && (
                              <span style={{ fontSize: 10, color: "#fbbf24" }}>puede tardar</span>
                            )}
                          </label>
                        ))}
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button style={s.exportBtn} onClick={() => exportData("csv")}>⬇ CSV</button>
                        <button style={s.exportBtn} onClick={() => exportData("json")}>⬇ JSON</button>
                      </div>
                    </>
                  )}

                  {exportLoading && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>
                      Consultando y escribiendo archivo…
                    </div>
                  )}

                  {exportStatus && (
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      <div style={{ color: exportStatus.ok ? "var(--green)" : "var(--red)", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.6 }}>
                        {exportStatus.msg}
                      </div>
                      {exportStatus.ok && (
                        <button style={{ ...s.exportBtn, marginTop: 8, width: "100%", color: "var(--text-muted)" }}
                          onClick={() => { setExportStatus(null); }}>
                          Exportar otro
                        </button>
                      )}
                      {!exportStatus.ok && (
                        <button style={{ ...s.exportBtn, marginTop: 8, width: "100%" }}
                          onClick={() => setExportStatus(null)}>
                          Reintentar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            style={{ ...s.btnTool, color: nFilters > 0 ? "var(--accent-text)" : "var(--text-muted)", borderColor: nFilters > 0 ? "var(--accent)" : "var(--border)", position: "relative" }}
            onClick={() => {
              setFilterDraft(filters.length > 0 ? [...filters] : [{ col: cols[0]?.name ?? "", op: "contains", value: "" }]);
              setShowFilter((v) => !v);
            }}
            title="Filtrar filas por condiciones"
          >
            ⊟ Filtrar{nFilters > 0 ? ` (${nFilters})` : ""}
          </button>

          <button style={s.btnIcon} onClick={() => loadData(0, filters)} title="Recargar datos">↺</button>
        </div>
      </div>

      {/* ── Sub-tabs ─────────────────────────────────────────────────────── */}
      <div style={s.subTabBar}>
        {(["datos", "estructura"] as SubTab[]).map((t) => (
          <button key={t} style={{ ...s.subTab, borderBottom: subTab === t ? "2px solid var(--accent)" : "2px solid transparent", color: subTab === t ? "var(--accent-text)" : "var(--text-muted)", fontWeight: subTab === t ? 600 : 400 }} onClick={() => setSubTab(t)}>
            {t === "datos" ? "⊞ Datos" : "≡ Estructura"}
          </button>
        ))}
      </div>

      {/* ── Panel de filtros ─────────────────────────────────────────────── */}
      {showFilter && (
        <div style={s.filterPanel}>
          <div style={s.filterHeader}>
            <span style={s.filterTitle}>Filtros</span>
            <span style={s.filterHint}>Combina múltiples condiciones con AND</span>
          </div>
          {filterDraft.map((f, i) => {
            const noValue = f.op === "is_null" || f.op === "is_not_null";
            return (
              <div key={i} style={s.filterRow}>
                {/* Columna */}
                <select style={s.filterSelect} value={f.col}
                  onChange={(e) => { const d = [...filterDraft]; d[i] = { ...d[i], col: e.target.value }; setFilterDraft(d); }}>
                  {cols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>

                {/* Operador */}
                <select style={{ ...s.filterSelect, minWidth: 140 }} value={f.op}
                  onChange={(e) => { const d = [...filterDraft]; d[i] = { ...d[i], op: e.target.value as FilterOp }; setFilterDraft(d); }}>
                  {(Object.entries(OP_LABELS) as [FilterOp, string][]).map(([op, label]) => (
                    <option key={op} value={op}>{label}</option>
                  ))}
                </select>

                {/* Valor */}
                {!noValue && (
                  <input style={s.filterInput} placeholder="valor…" value={f.value}
                    onChange={(e) => { const d = [...filterDraft]; d[i] = { ...d[i], value: e.target.value }; setFilterDraft(d); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { setFilters(filterDraft); setShowFilter(false); loadData(0, filterDraft); }
                    }}
                    autoFocus={i === filterDraft.length - 1}
                  />
                )}
                {noValue && <span style={{ ...s.filterInput, color: "var(--text-muted)", fontStyle: "italic", flex: 1 }}>sin valor</span>}

                {/* Eliminar fila */}
                <button style={s.filterRemove} title="Eliminar este filtro"
                  onClick={() => setFilterDraft(filterDraft.filter((_, j) => j !== i))}>✕</button>
              </div>
            );
          })}

          <div style={s.filterActions}>
            <button style={s.filterAddBtn}
              onClick={() => setFilterDraft([...filterDraft, { col: cols[0]?.name ?? "", op: "contains", value: "" }])}>
              + Agregar condición
            </button>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={s.btnSecondary} onClick={() => { setFilters([]); setFilterDraft([]); setShowFilter(false); loadData(0, []); }}>
                Limpiar
              </button>
              <button style={s.btnPrimary} onClick={() => { setFilters(filterDraft); setShowFilter(false); loadData(0, filterDraft); }}>
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && <div style={s.status}>Cargando…</div>}
      {error   && <div style={{ ...s.status, color: "var(--red)" }}>✗ {error}</div>}


      {/* ── Estructura ───────────────────────────────────────────────────── */}
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
                      <span style={{ color: "var(--text-primary)", fontWeight: col.is_primary_key ? 600 : 400 }}>{col.name}</span>
                    </td>
                    <td style={{ ...s.td, ...s.structCell }}><span style={s.typeChip}>{col.data_type}</span></td>
                    <td style={{ ...s.td, ...s.structCell, textAlign: "center" }}>
                      {col.nullable ? <span style={s.nullBadge}>YES</span> : <span style={s.notNullBadge}>NO</span>}
                    </td>
                    <td style={{ ...s.td, ...s.structCell, textAlign: "center" }}>
                      {col.is_primary_key && <span style={s.pkBadge}>PK</span>}
                    </td>
                    <td style={{ ...s.td, ...s.structCell }}>
                      {col.is_foreign_key && col.references_table && (
                        <span style={s.fkRef}>
                          <span style={s.fkBadge}>FK</span>
                          <span style={s.fkArrow}>→</span>
                          <span style={s.fkTarget}>{col.references_table}{col.references_column ? `.${col.references_column}` : ""}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!tableSchema && !schemaLoading && (
                  <tr><td colSpan={6} style={{ ...s.td, textAlign: "center", color: "var(--text-muted)", padding: 28 }}>Sin información de estructura disponible</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Datos ────────────────────────────────────────────────────────── */}
      {subTab === "datos" && !loading && !error && result && (
        <>
          <div style={s.tableWrap}>
            <table style={{ ...s.table, tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
              <colgroup>
                <col style={{ width: 48 }} />
                {cols.map((col) => <col key={col.name} style={{ width: getColW(col.name) }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...s.th, ...s.rowNumTh }}>#</th>
                  {cols.map((col) => (
                    <th key={col.name} style={{ ...s.th, width: getColW(col.name), position: "relative" }}>
                      <div style={s.thInner}>
                        <span style={s.colName}>{col.name}</span>
                        <span style={s.colType}>{col.data_type}</span>
                      </div>
                      <div style={s.resizeHandle}
                        onMouseDown={(e) => startResize(e, col.name)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        title="Arrastrar para redimensionar columna"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => {
                  const absIdx = page * PAGE_SIZE + ri;
                  const isSel  = selRow === absIdx;
                  return (
                    <tr key={absIdx}
                      style={{ background: isSel ? "rgba(99,102,241,0.12)" : ri % 2 === 0 ? "transparent" : "rgba(255,255,255,0.018)" }}
                      onClick={() => setSelRow(isSel ? null : absIdx)}
                    >
                      <td style={{ ...s.td, ...s.rowNumTd }}>{absIdx + 1}</td>
                      {row.map((cell, ci) => {
                        const key     = `${absIdx}-${ci}`;
                        const isPend  = pending.has(key);
                        const isEdit  = editCell?.row === absIdx && editCell?.col === ci;
                        const { text, kind } = cellDisplay(cell);
                        const pendVal = pending.get(key);
                        const dispVal = isPend
                          ? (pendVal === NULL_SENTINEL ? "null" : pendVal!)
                          : text;
                        const dispKind = isPend && pendVal === NULL_SENTINEL ? "null" : kind;

                        return (
                          <td key={ci} style={{
                            ...s.td,
                            background: isPend ? "rgba(251,191,36,0.10)" : undefined,
                            outline: isEdit ? "2px solid var(--accent)" : isPend ? "1px solid rgba(251,191,36,0.4)" : undefined,
                            outlineOffset: isEdit ? "-2px" : undefined,
                            cursor: "text", padding: 0,
                          }}
                            onDoubleClick={() => startEdit(absIdx, ci)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isEdit ? (
                              <div style={{ position: "relative", minHeight: 28 }}>
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
                                      if (nextCol >= 0 && nextCol < cols.length) startEdit(absIdx, nextCol);
                                    }
                                  }}
                                  onBlur={commitEdit}
                                  style={s.cellInput}
                                  placeholder="valor…"
                                />
                                <button
                                  style={s.nullBtn}
                                  onMouseDown={(e) => { e.preventDefault(); setNullAndCommit(); }}
                                  title="Establecer como NULL"
                                >→ NULL</button>
                              </div>
                            ) : (
                              <div style={{
                                ...s.cellInner,
                                color: isPend && pendVal !== NULL_SENTINEL ? "#fbbf24"
                                  : dispKind === "null" ? "var(--text-muted)"
                                  : dispKind === "num"  ? "var(--accent-text)"
                                  : dispKind === "bool" ? (text === "true" ? "var(--green)" : "var(--red)")
                                  : "var(--text-primary)",
                                fontStyle: dispKind === "null" ? "italic" : "normal",
                                textAlign:  dispKind === "num" ? "right" : "left",
                              }}
                                title={`${String(cell)}\n\nDoble click para editar`}
                              >
                                {dispKind === "bool" && !isPend
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
                {rows.length === 0 && (
                  <tr><td colSpan={cols.length + 1} style={{ ...s.td, textAlign: "center", color: "var(--text-muted)", padding: 28 }}>Sin datos</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div style={s.pagination}>
              <button style={s.pageBtn} disabled={page === 0} onClick={() => loadData(page - 1, filters)}>← Anterior</button>
              <span style={s.pageInfo}>
                {(page * PAGE_SIZE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString()} de {totalCount.toLocaleString()}
              </span>
              <button style={s.pageBtn} disabled={page >= pages - 1} onClick={() => loadData(page + 1, filters)}>Siguiente →</button>
            </div>
          )}
        </>
      )}

      {/* ── Modal error guardado ─────────────────────────────────────────── */}
      {errModal && (
        <div style={s.modalOverlay} onClick={() => setErrModal(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={{ fontSize: 16, color: "var(--red)" }}>⚠</span>
              <span style={s.modalTitle}>Error al guardar cambio</span>
            </div>
            <div style={s.modalBody}>
              <div style={s.modalRow}><span style={s.modalLabel}>Tabla</span><span style={s.modalValue}>{table.schema}.{table.name}</span></div>
              <div style={s.modalRow}><span style={s.modalLabel}>Fila</span><span style={s.modalValue}>{errModal.row}</span></div>
              <div style={s.modalRow}><span style={s.modalLabel}>Columna</span><span style={s.modalValue}>{errModal.col}</span></div>
              <div style={s.modalSection}>Query ejecutado:</div>
              <pre style={s.modalCode}>{errModal.sql}</pre>
              <div style={s.modalSection}>Error:</div>
              <pre style={s.modalError}>{errModal.msg}</pre>
            </div>
            <div style={s.modalFooter}>
              <button style={s.modalBtnSecondary} onClick={() => setErrModal(null)}>Cancelar todo</button>
              <button style={s.modalBtnPrimary} onClick={async () => {
                const colIdx    = cols.findIndex((c) => c.name === errModal.col);
                const newPending = new Map(pending);
                newPending.delete(`${errModal.row - 1}-${colIdx}`);
                setPending(newPending);
                setErrModal(null);
                await saveAll();
              }}>Saltar y continuar</button>
            </div>
          </div>
        </div>
      )}

      {/* Cierra export dropdown al clickar fuera */}
      {showExport && <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setShowExport(false)} />}
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const s: Record<string, any> = {
  container:  { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" },
  empty:      { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, height: "100%" },
  emptyHint:  { fontSize: 13, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.7 },
  header:     { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0, gap: 8 },
  headerLeft: { display: "flex", alignItems: "center", gap: 6 },
  headerRight:{ display: "flex", alignItems: "center", gap: 6 },
  schemaLabel:{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" },
  tableLabel: { fontSize: 13, fontWeight: 700, color: "var(--accent-text)", fontFamily: "var(--font-mono)" },
  meta:       { fontSize: 10, color: "var(--text-muted)", marginLeft: 6 },
  pendingBadge:{ fontSize: 10, fontWeight: 600, background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 4, padding: "2px 8px" },

  // Botones del header
  btnPrimary:  { background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", fontSize: 11, fontWeight: 600, padding: "4px 12px", cursor: "pointer", whiteSpace: "nowrap" },
  btnSecondary:{ background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", fontSize: 11, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" },
  btnTool:    { background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", fontSize: 11, padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" },
  btnIcon:    { background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", fontSize: 14, width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },

  // Export dropdown
  exportDropdown: {
    position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "14px 16px", width: 260,
    boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
  },
  exportTitle:{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 },
  exportBtn:  { flex: 1, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-primary)", fontSize: 12, fontWeight: 600, padding: "7px 0", cursor: "pointer" },

  status:     { padding: "12px 16px", fontSize: 12, color: "var(--text-muted)" },
  tableWrap:  { flex: 1, overflow: "auto" },
  table:      { borderCollapse: "collapse", width: "100%", tableLayout: "auto", fontFamily: "var(--font-mono)", fontSize: 12 },
  th:         { position: "sticky", top: 0, background: "var(--bg-elevated)", borderBottom: "2px solid var(--border)", borderRight: "1px solid var(--border)", padding: "6px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", zIndex: 1, overflow: "hidden" },
  rowNumTh:   { width: 44, minWidth: 44, textAlign: "right", color: "var(--text-muted)", fontSize: 10, fontWeight: 400 },
  thInner:    { display: "flex", flexDirection: "column", gap: 1, overflow: "hidden" },
  colName:    { color: "var(--text-primary)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" },
  colType:    { color: "var(--text-muted)", fontSize: 9, fontWeight: 400 },
  resizeHandle: {
    position: "absolute", right: 0, top: 0,
    width: 4, height: "100%", cursor: "col-resize",
    background: "transparent", zIndex: 2, transition: "background 0.1s",
    borderRadius: 2,
  },
  td:         { borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)", overflow: "hidden", fontSize: 12, verticalAlign: "middle" },
  rowNumTd:   { color: "var(--text-muted)", fontSize: 10, textAlign: "right", userSelect: "none", background: "var(--bg-surface)", position: "sticky", left: 0, padding: "5px 8px" },
  cellInner:  { padding: "5px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minHeight: 28 },
  cellInput:  {
    position: "absolute", top: 0, left: 0,
    minWidth: 260, width: "max-content", zIndex: 50,
    background: "var(--bg-elevated)", border: "2px solid var(--accent)", borderRadius: 4,
    color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-mono)",
    padding: "4px 10px 4px 10px", outline: "none",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)", minHeight: 28,
  },
  nullBtn: {
    position: "absolute", top: 0, right: 0,
    background: "rgba(239,68,68,0.15)", border: "none", borderRadius: "0 3px 3px 0",
    color: "var(--red)", fontSize: 10, fontWeight: 600,
    padding: "5px 8px", cursor: "pointer", height: "100%", zIndex: 51,
    whiteSpace: "nowrap",
  },
  boolBadge: (val: boolean): React.CSSProperties => ({
    display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 10, fontWeight: 600,
    background: val ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)",
    color: val ? "var(--green)" : "var(--red)",
  }),
  pagination: { display: "flex", alignItems: "center", justifyContent: "center", gap: 12, padding: "8px 14px", background: "var(--bg-surface)", borderTop: "1px solid var(--border)", flexShrink: 0 },
  pageBtn:    { background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-secondary)", fontSize: 11, padding: "3px 10px", cursor: "pointer" },
  pageInfo:   { fontSize: 11, color: "var(--text-muted)", minWidth: 180, textAlign: "center" },

  // Filtros
  filterPanel:  { background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 },
  filterHeader: { display: "flex", alignItems: "baseline", gap: 10 },
  filterTitle:  { fontSize: 12, fontWeight: 600, color: "var(--text-primary)" },
  filterHint:   { fontSize: 11, color: "var(--text-muted)" },
  filterRow:    { display: "flex", alignItems: "center", gap: 8 },
  filterSelect: {
    background: "var(--bg-surface)", border: "1px solid var(--border)",
    borderRadius: 4, color: "var(--text-primary)", fontSize: 11,
    padding: "5px 8px", fontFamily: "var(--font-mono)", minWidth: 120, outline: "none",
  },
  filterInput:  { flex: 1, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-primary)", fontSize: 11, padding: "5px 8px", outline: "none", fontFamily: "var(--font-mono)" },
  filterRemove: { background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", padding: "2px 6px", borderRadius: 3, flexShrink: 0 },
  filterActions:{ display: "flex", justifyContent: "space-between", alignItems: "center" },
  filterAddBtn: { background: "transparent", border: "none", color: "var(--accent-text)", fontSize: 11, cursor: "pointer", padding: 0, fontWeight: 500 },

  // Sub-tabs
  subTabBar:  { display: "flex", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0, paddingLeft: 8 },
  subTab:     { padding: "7px 16px", fontSize: 12, background: "transparent", border: "none", borderBottom: "2px solid transparent", cursor: "pointer", transition: "all 0.15s" },

  // Estructura
  structCell:   { padding: "6px 12px", fontFamily: "var(--font-mono)", fontSize: 12 },
  typeChip:     { display: "inline-block", background: "rgba(129,140,248,0.1)", color: "var(--accent-text)", border: "1px solid rgba(129,140,248,0.2)", borderRadius: 4, padding: "1px 7px", fontSize: 11, fontFamily: "var(--font-mono)" },
  nullBadge:    { display: "inline-block", padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "rgba(255,255,255,0.05)", color: "var(--text-muted)" },
  notNullBadge: { display: "inline-block", padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "rgba(239,68,68,0.1)", color: "var(--red)" },
  pkBadge:      { display: "inline-block", padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" },
  fkRef:        { display: "flex", alignItems: "center", gap: 5 },
  fkBadge:      { display: "inline-block", padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 700, background: "rgba(129,140,248,0.12)", color: "#818cf8", border: "1px solid rgba(129,140,248,0.25)" },
  fkArrow:      { color: "var(--text-muted)", fontSize: 11 },
  fkTarget:     { color: "var(--accent-text)", fontSize: 11, fontFamily: "var(--font-mono)" },

  // Modal
  modalOverlay:      { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 },
  modal:             { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, width: 520, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", overflow: "hidden" },
  modalHeader:       { display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.08)" },
  modalTitle:        { fontSize: 14, fontWeight: 700, color: "var(--text-primary)" },
  modalBody:         { padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 },
  modalRow:          { display: "flex", gap: 12, alignItems: "baseline" },
  modalLabel:        { fontSize: 11, color: "var(--text-muted)", width: 70, flexShrink: 0 },
  modalValue:        { fontSize: 12, color: "var(--text-primary)", fontFamily: "var(--font-mono)" },
  modalSection:      { fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 6 },
  modalCode:         { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--accent-text)", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 120, overflow: "auto" },
  modalError:        { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, padding: "10px 12px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--red)", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 120, overflow: "auto" },
  modalFooter:       { display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)" },
  modalBtnSecondary: { background: "transparent", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-secondary)", fontSize: 12, padding: "6px 14px", cursor: "pointer" },
  modalBtnPrimary:   { background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", fontSize: 12, fontWeight: 600, padding: "6px 14px", cursor: "pointer" },
};
