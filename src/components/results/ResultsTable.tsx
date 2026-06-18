import { useState } from "react";
import type { QueryResult } from "../../types";

interface Props {
  result: QueryResult | null;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  active:   { bg: "rgba(52,211,153,0.15)",  color: "#34d399" },
  trial:    { bg: "rgba(96,165,250,0.15)",   color: "#60a5fa" },
  churned:  { bg: "rgba(248,113,113,0.15)", color: "#f87171" },
  inactive: { bg: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  true:     { bg: "rgba(52,211,153,0.15)",  color: "#34d399" },
  false:    { bg: "rgba(248,113,113,0.15)", color: "#f87171" },
};

export default function ResultsTable({ result }: Props) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  if (!result) {
    return (
      <div style={styles.empty}>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Ejecuta un query para ver los resultados
        </p>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      {/* Meta info */}
      <div style={styles.meta}>
        <span style={{ color: "var(--green)" }}>✓</span>
        <span style={{ color: "var(--text-muted)" }}>
          {result.rows.length} filas · {result.execution_time_ms}ms
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button style={styles.metaBtn} onClick={() => exportCSV(result)}>↓ CSV</button>
          <button style={styles.metaBtn} onClick={() => exportJSON(result)}>↓ JSON</button>
        </div>
      </div>

      {/* Tabla */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th key={col.name} style={styles.th}>
                  <span style={{ color: "var(--accent-text)" }}>{col.name}</span>
                  <span style={styles.colType}>{col.data_type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr
                key={i}
                style={{
                  ...styles.tr,
                  background: hoveredRow === i
                    ? "rgba(59,130,246,0.07)"
                    : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                }}
                onMouseEnter={() => setHoveredRow(i)}
                onMouseLeave={() => { setHoveredRow(null); setHoveredCell(null); }}
              >
                {row.map((cell, j) => {
                  const colName = result.columns[j]?.name;
                  const val = cell === null || cell === undefined ? "NULL" : String(cell);
                  const statusStyle = STATUS_COLORS[val.toLowerCase()];
                  const isHoveredCell = hoveredCell?.row === i && hoveredCell?.col === j;

                  return (
                    <td
                      key={j}
                      style={{
                        ...styles.td,
                        background: isHoveredCell ? "rgba(59,130,246,0.15)" : "transparent",
                      }}
                      onMouseEnter={() => setHoveredCell({ row: i, col: j })}
                      title={`${colName}: ${val}`}
                    >
                      {statusStyle ? (
                        <span style={{
                          ...styles.badge,
                          background: statusStyle.bg,
                          color: statusStyle.color,
                        }}>
                          {val}
                        </span>
                      ) : val === "NULL" ? (
                        <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>NULL</span>
                      ) : (
                        <span>{val}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function exportCSV(result: QueryResult) {
  const header = result.columns.map((c) => c.name).join(",");
  const rows = result.rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","));
  const csv = [header, ...rows].join("\n");
  download(csv, "datum-export.csv", "text/csv");
}

function exportJSON(result: QueryResult) {
  const data = result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col.name, row[i]]))
  );
  download(JSON.stringify(data, null, 2), "datum-export.json", "application/json");
}

function download(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  empty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
    flexShrink: 0,
  },
  metaBtn: {
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid var(--border-light)",
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: 11,
    cursor: "pointer",
  },
  tableWrap: {
    flex: 1,
    overflow: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
    fontFamily: "var(--font-mono)",
  },
  th: {
    padding: "7px 12px",
    textAlign: "left" as const,
    background: "var(--bg-surface)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    borderBottom: "1px solid var(--border)",
    position: "sticky" as const,
    top: 0,
    whiteSpace: "nowrap" as const,
    userSelect: "none" as const,
  },
  colType: {
    marginLeft: 6,
    color: "var(--text-muted)",
    fontWeight: 400,
    fontSize: 10,
  },
  tr: {
    borderBottom: "1px solid rgba(45,55,72,0.5)",
    transition: "background 0.1s",
    cursor: "default",
  },
  td: {
    padding: "6px 12px",
    color: "var(--text-primary)",
    whiteSpace: "nowrap" as const,
    transition: "background 0.1s",
  },
  badge: {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
    fontFamily: "var(--font-sans)",
  },
};
