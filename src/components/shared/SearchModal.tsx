import { useState, useEffect, useRef } from "react";

export interface SearchEntry {
  schema:    string;
  tableName: string;
  columns:   string[];   // nombres de columnas cargadas
  dbName:    string;     // database a la que pertenece
}

interface Props {
  index:       SearchEntry[];
  onSelect:    (schema: string, tableName: string) => void;
  onClose:     () => void;
}

export default function SearchModal({ index, onSelect, onClose }: Props) {
  const [query,   setQuery]   = useState("");
  const [cursor,  setCursor]  = useState(0);
  const inputRef              = useRef<HTMLInputElement>(null);
  const listRef               = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Cierra con Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Filtrado: match en tableName o en cualquier columna
  const q = query.trim().toLowerCase();
  const results: (SearchEntry & { matchedCols: string[] })[] = q
    ? index
        .map((e) => {
          const tableMatch  = e.tableName.toLowerCase().includes(q);
          const matchedCols = e.columns.filter((c) => c.toLowerCase().includes(q));
          if (!tableMatch && matchedCols.length === 0) return null;
          return { ...e, matchedCols };
        })
        .filter(Boolean) as (SearchEntry & { matchedCols: string[] })[]
    : index.map((e) => ({ ...e, matchedCols: [] })).slice(0, 30);

  // Navegar con flechas y Enter
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && results[cursor]) {
      pick(results[cursor]);
    }
  }

  function pick(r: SearchEntry) {
    onSelect(r.schema, r.tableName);
    onClose();
  }

  // Mantiene el item activo visible
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Reset cursor cuando cambia query
  useEffect(() => { setCursor(0); }, [query]);

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>

        {/* ── Search input ── */}
        <div style={s.inputWrap}>
          <span style={s.searchIcon}>⌕</span>
          <input
            ref={inputRef}
            style={s.input}
            placeholder="Buscar tabla o columna…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
          {query && (
            <button style={s.clearBtn} onClick={() => setQuery("")}>✕</button>
          )}
        </div>

        {/* ── Results ── */}
        <div ref={listRef} style={s.list}>
          {results.length === 0 && q && (
            <div style={s.empty}>Sin resultados para "{q}"</div>
          )}

          {results.map((r, i) => {
            const isActive = i === cursor;
            return (
              <div
                key={`${r.schema}.${r.tableName}`}
                style={{
                  ...s.item,
                  background: isActive ? "var(--accent-dim)" : "transparent",
                  borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                }}
                onClick={() => pick(r)}
                onMouseEnter={() => setCursor(i)}
              >
                <div style={s.itemMain}>
                  <span style={s.tableIcon}>▤</span>
                  <span style={s.tableName}>{highlight(r.tableName, q)}</span>
                  <span style={s.schemaBadge}>{r.schema}</span>
                  {r.dbName && <span style={s.dbBadge}>{r.dbName}</span>}
                </div>

                {r.matchedCols.length > 0 && (
                  <div style={s.colRow}>
                    {r.matchedCols.slice(0, 5).map((col) => (
                      <span key={col} style={s.colChip}>
                        {highlight(col, q)}
                      </span>
                    ))}
                    {r.matchedCols.length > 5 && (
                      <span style={s.colMore}>+{r.matchedCols.length - 5}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div style={s.footer}>
          <span style={s.hint}><kbd style={s.kbd}>↑↓</kbd> navegar</span>
          <span style={s.hint}><kbd style={s.kbd}>↵</kbd> abrir</span>
          <span style={s.hint}><kbd style={s.kbd}>esc</kbd> cerrar</span>
          <span style={{ marginLeft: "auto", ...s.hint }}>
            {results.length} resultado{results.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// Resalta el fragmento que hizo match
function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "rgba(96,165,250,0.3)", color: "var(--accent-text)", borderRadius: 2 }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

const s: Record<string, any> = {
  overlay: {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,0.65)",
    display: "flex", alignItems: "flex-start", justifyContent: "center",
    paddingTop: "15vh", zIndex: 300,
  },
  modal: {
    width: 580, maxHeight: "65vh",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-light)",
    borderRadius: 12,
    boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
    display: "flex", flexDirection: "column",
    overflow: "hidden",
  },
  inputWrap: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  searchIcon: {
    fontSize: 20, color: "var(--text-muted)",
    lineHeight: 1, userSelect: "none",
  },
  input: {
    flex: 1, background: "transparent", border: "none", outline: "none",
    color: "var(--text-primary)", fontSize: 15,
    fontFamily: "var(--font-sans)",
  },
  clearBtn: {
    background: "transparent", border: "none",
    color: "var(--text-muted)", fontSize: 12, cursor: "pointer", padding: "2px 4px",
  },
  list: {
    flex: 1, overflowY: "auto", padding: "6px",
  },
  empty: {
    padding: "24px 16px", color: "var(--text-muted)",
    fontSize: 13, textAlign: "center",
  },
  item: {
    padding: "8px 12px", borderRadius: 6, cursor: "pointer",
    transition: "background 0.08s",
    display: "flex", flexDirection: "column", gap: 4,
    marginBottom: 2,
  },
  itemMain: {
    display: "flex", alignItems: "center", gap: 8,
  },
  tableIcon: {
    fontSize: 12, color: "var(--text-muted)", flexShrink: 0,
  },
  tableName: {
    fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
    fontFamily: "var(--font-mono)", flex: 1,
  },
  schemaBadge: {
    fontSize: 10, color: "var(--accent-text)",
    background: "var(--accent-dim)",
    padding: "1px 6px", borderRadius: 4, flexShrink: 0,
  },
  dbBadge: {
    fontSize: 10, color: "var(--text-muted)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    padding: "1px 6px", borderRadius: 4, flexShrink: 0,
  },
  colRow: {
    display: "flex", flexWrap: "wrap", gap: 4, paddingLeft: 20,
  },
  colChip: {
    fontSize: 10, fontFamily: "var(--font-mono)",
    color: "var(--text-secondary)",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    padding: "1px 6px", borderRadius: 3,
  },
  colMore: {
    fontSize: 10, color: "var(--text-muted)", alignSelf: "center",
  },
  footer: {
    display: "flex", alignItems: "center", gap: 14,
    padding: "8px 14px", borderTop: "1px solid var(--border)",
    flexShrink: 0,
  },
  hint: {
    display: "flex", alignItems: "center", gap: 5,
    fontSize: 11, color: "var(--text-muted)",
  },
  kbd: {
    background: "var(--bg-elevated)", border: "1px solid var(--border-light)",
    borderRadius: 4, padding: "1px 5px", fontSize: 10,
    fontFamily: "var(--font-mono)", color: "var(--text-secondary)",
  },
};
