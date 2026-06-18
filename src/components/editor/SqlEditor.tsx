import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { format as sqlFormat } from "sql-formatter";
import type { SavedConnection, QueryResult } from "../../types";

interface Props {
  connection: SavedConnection | null;
  password: string;
  onResult: (result: QueryResult) => void;
}

interface HistoryEntry {
  sql:      string;
  ts:       Date;
  ms:       number;
  rows:     number;
  error?:   string;
}

// ─── Ask AI panel ────────────────────────────────────────────────────────────
function AskAiPanel({
  onInsert,
  onClose,
}: {
  onInsert: (sql: string) => void;
  onClose:  () => void;
}) {
  const [prompt,   setPrompt]   = useState("");
  const [apiKey,   setApiKey]   = useState("");
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<string | null>(null);
  const [err,      setErr]      = useState<string | null>(null);
  const [showKey,  setShowKey]  = useState(false);

  // Carga la API key del keychain al abrir
  useEffect(() => {
    invoke<string | null>("load_password", { connectionId: "__anthropic_api_key__" })
      .then((k) => { if (k) setApiKey(k); })
      .catch(() => {});
  }, []);

  async function handleSaveKey() {
    await invoke("save_password", { connectionId: "__anthropic_api_key__", password: apiKey })
      .catch(() => {});
    setShowKey(false);
  }

  async function handleAsk() {
    if (!prompt.trim()) return;
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const sql = await invoke<string>("ask_ai", {
        prompt,
        schemaContext: "",
        apiKey,
      });
      setResult(sql);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={ai.overlay} onClick={onClose}>
      <div style={ai.panel} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={ai.header}>
          <span style={ai.title}>✦ Ask AI → SQL</span>
          <button style={ai.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* API key row */}
        <div style={ai.keyRow}>
          {showKey ? (
            <>
              <input
                style={ai.input}
                type="password"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoFocus
              />
              <button style={ai.saveBtn} onClick={handleSaveKey}>Guardar</button>
              <button style={ai.cancelBtn} onClick={() => setShowKey(false)}>✕</button>
            </>
          ) : (
            <button style={ai.keyBtn} onClick={() => setShowKey(true)}>
              {apiKey ? "🔑 API Key configurada" : "⚠ Configura API Key"}
            </button>
          )}
        </div>

        {/* Prompt */}
        <textarea
          style={ai.textarea}
          placeholder="Describe lo que quieres consultar…&#10;Ej: Muéstrame los usuarios registrados en los últimos 7 días"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAsk();
          }}
          rows={4}
        />

        <button
          style={{ ...ai.runBtn, opacity: loading || !apiKey ? 0.6 : 1 }}
          onClick={handleAsk}
          disabled={loading || !apiKey}
        >
          {loading ? "Generando…" : "⌘↵ Generar SQL"}
        </button>

        {err && <div style={ai.err}>{err}</div>}

        {result && (
          <div style={ai.resultBox}>
            <pre style={ai.pre}>{result}</pre>
            <button style={ai.insertBtn} onClick={() => { onInsert(result); onClose(); }}>
              ↳ Insertar en editor
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Historial panel ──────────────────────────────────────────────────────────
function HistorialPanel({
  entries,
  onRestore,
  onClose,
}: {
  entries:   HistoryEntry[];
  onRestore: (sql: string) => void;
  onClose:   () => void;
}) {
  return (
    <div style={hist.overlay} onClick={onClose}>
      <div style={hist.panel} onClick={(e) => e.stopPropagation()}>
        <div style={hist.header}>
          <span style={hist.title}>⏱ Historial de queries</span>
          <button style={hist.closeBtn} onClick={onClose}>✕</button>
        </div>

        {entries.length === 0 ? (
          <div style={hist.empty}>Aún no hay queries ejecutados.</div>
        ) : (
          <div style={hist.list}>
            {[...entries].reverse().map((e, i) => (
              <div
                key={i}
                style={hist.entry}
                onClick={() => { onRestore(e.sql); onClose(); }}
              >
                <div style={hist.entryMeta}>
                  <span style={e.error ? hist.errDot : hist.okDot} />
                  <span style={hist.time}>
                    {e.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  {!e.error && (
                    <>
                      <span style={hist.chip}>{e.rows} filas</span>
                      <span style={hist.chip}>{e.ms}ms</span>
                    </>
                  )}
                  {e.error && <span style={hist.errChip}>Error</span>}
                </div>
                <pre style={hist.sql}>{e.sql.length > 120 ? e.sql.slice(0, 120) + "…" : e.sql}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SQL Editor principal ─────────────────────────────────────────────────────
export default function SqlEditor({ connection, password, onResult }: Props) {
  const editorRef    = useRef<HTMLDivElement>(null);
  const viewRef      = useRef<EditorView | null>(null);
  const [running,    setRunning]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [history,    setHistory]    = useState<HistoryEntry[]>([]);
  const [showHist,   setShowHist]   = useState(false);
  const [showAi,     setShowAi]     = useState(false);

  const getSql = () => viewRef.current?.state.doc.toString() ?? "";

  const setSql = useCallback((newSql: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newSql },
    });
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;
    const state = EditorState.create({
      doc: "SELECT *\nFROM users\nLIMIT 50;",
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        sql(),
        oneDark,
        keymap.of([
          ...defaultKeymap,
          indentWithTab,
          { key: "Mod-Enter", run: () => { handleRunRef.current(); return true; } },
        ]),
        EditorView.theme({
          "&": { height: "200px", fontSize: "13px", fontFamily: '"JetBrains Mono", "Fira Code", monospace' },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { padding: "12px 0" },
          ".cm-gutters": { background: "#0f1117", borderRight: "1px solid #2d3748" },
          ".cm-lineNumbers .cm-gutterElement": { color: "#475569", minWidth: "36px" },
          ".cm-activeLine": { background: "rgba(255,255,255,0.03)" },
          ".cm-activeLineGutter": { background: "rgba(255,255,255,0.03)" },
        }),
      ],
    });
    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, []);

  const handleRunRef = useRef<() => void>(() => {});

  async function handleRun() {
    if (!connection) { setError("Selecciona una conexión primero."); return; }
    const sqlText = getSql();
    if (!sqlText.trim()) return;

    setRunning(true);
    setError(null);
    const start = Date.now();

    try {
      await invoke("open_connection", { connection, password }).catch(() => {});
      const result = await invoke<QueryResult>("execute_query", { connectionId: connection.id, sql: sqlText });
      const ms = Date.now() - start;
      onResult(result);
      setHistory((h) => [...h, { sql: sqlText, ts: new Date(), ms, rows: result.rows.length }]);
    } catch (e: unknown) {
      const msg = String(e);
      setError(msg);
      setHistory((h) => [...h, { sql: sqlText, ts: new Date(), ms: Date.now() - start, rows: 0, error: msg }]);
    } finally {
      setRunning(false);
    }
  }

  handleRunRef.current = handleRun;

  function handleFormato() {
    const current = getSql();
    try {
      const formatted = sqlFormat(current, { language: "sql", tabWidth: 2, keywordCase: "upper" });
      setSql(formatted);
    } catch {
      // Si falla el formatter (SQL inválido), no hacemos nada
    }
  }

  return (
    <>
      <div style={styles.wrap}>
        <div style={styles.toolbar}>
          {/* Run */}
          <button
            style={{ ...styles.btn, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", opacity: running ? 0.6 : 1 }}
            onClick={handleRun}
            disabled={running}
          >
            {running ? "⏳ Ejecutando..." : "▶ Run"}
          </button>

          {/* Formato */}
          <button style={styles.btn} onClick={handleFormato} title="Formatear SQL (Alt+Shift+F)">
            ⊞ Formato
          </button>

          {/* Historial */}
          <button
            style={{ ...styles.btn, position: "relative" }}
            onClick={() => setShowHist(true)}
            title="Historial de queries"
          >
            ⏱ Historial
            {history.length > 0 && (
              <span style={styles.histBadge}>{history.length}</span>
            )}
          </button>

          {/* Derecha */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {connection && <span style={styles.connBadge}>{connection.name}</span>}
            <button
              style={{ ...styles.btn, borderColor: "var(--purple)", color: "var(--purple)" }}
              onClick={() => setShowAi(true)}
              title="Generar SQL con IA"
            >
              ✦ Ask AI
            </button>
          </div>
        </div>

        <div ref={editorRef} style={{ background: "#0f1117", borderBottom: "1px solid var(--border)" }} />
        <div style={styles.hint}>⌘ + Enter para ejecutar</div>
        {error && <div style={styles.error}>{error}</div>}
      </div>

      {showHist && (
        <HistorialPanel
          entries={history}
          onRestore={setSql}
          onClose={() => setShowHist(false)}
        />
      )}

      {showAi && (
        <AskAiPanel
          onInsert={setSql}
          onClose={() => setShowAi(false)}
        />
      )}
    </>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const styles: Record<string, any> = {
  wrap: { display: "flex", flexDirection: "column", borderBottom: "1px solid var(--border)", flexShrink: 0 },
  toolbar: {
    display: "flex", alignItems: "center", gap: 6,
    padding: "6px 12px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)",
  },
  btn: {
    padding: "4px 10px", borderRadius: 4,
    border: "1px solid var(--border-light)",
    background: "var(--bg-elevated)", color: "var(--text-secondary)",
    fontSize: 12, fontWeight: 500, cursor: "pointer",
  },
  histBadge: {
    position: "absolute" as const, top: -4, right: -4,
    background: "var(--accent)", color: "#fff",
    fontSize: 9, fontWeight: 700,
    borderRadius: 8, padding: "1px 4px", lineHeight: 1.4,
  },
  connBadge: { fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "var(--accent-dim)", color: "var(--accent-text)", fontWeight: 500 },
  hint: { padding: "4px 12px", fontSize: 11, color: "var(--text-muted)", background: "var(--bg-surface)", textAlign: "right" as const },
  error: { padding: "8px 12px", background: "rgba(248,113,113,0.1)", borderTop: "1px solid rgba(248,113,113,0.3)", color: "var(--red)", fontSize: 12 },
};

const ai: Record<string, any> = {
  overlay: {
    position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
  },
  panel: {
    background: "var(--bg-elevated)", border: "1px solid var(--border-light)",
    borderRadius: 10, padding: 20, width: 500, maxWidth: "90vw",
    display: "flex", flexDirection: "column", gap: 12,
    boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  title:  { fontSize: 14, fontWeight: 700, color: "var(--purple)" },
  closeBtn: { background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" },
  keyRow: { display: "flex", gap: 8, alignItems: "center" },
  input: {
    flex: 1, background: "var(--bg-surface)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-primary)", fontSize: 12, padding: "6px 10px", outline: "none",
  },
  saveBtn: { padding: "5px 12px", borderRadius: 5, background: "var(--accent)", border: "none", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 600 },
  cancelBtn: { padding: "5px 8px", borderRadius: 5, background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" },
  keyBtn: { fontSize: 11, color: "var(--text-muted)", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 5, padding: "4px 10px", cursor: "pointer" },
  textarea: {
    background: "var(--bg-surface)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-primary)", fontSize: 13,
    padding: "10px 12px", outline: "none", resize: "vertical" as const,
    fontFamily: "inherit", lineHeight: 1.5,
  },
  runBtn: {
    padding: "8px 16px", borderRadius: 6, background: "var(--purple)",
    border: "none", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  err: { background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 6, padding: "8px 12px", color: "var(--red)", fontSize: 12 },
  resultBox: {
    background: "var(--bg-surface)", border: "1px solid var(--border)",
    borderRadius: 6, overflow: "hidden",
  },
  pre: { margin: 0, padding: "12px 14px", fontSize: 12, color: "var(--text-primary)", fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" as const, overflowX: "auto" as const },
  insertBtn: {
    display: "block", width: "100%", padding: "8px 14px",
    background: "rgba(129,140,248,0.1)", border: "none", borderTop: "1px solid var(--border)",
    color: "var(--accent-text)", fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
};

const hist: Record<string, any> = {
  overlay: {
    position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.4)",
    display: "flex", alignItems: "flex-start", justifyContent: "flex-end", zIndex: 200,
  },
  panel: {
    width: 420, height: "100%",
    background: "var(--bg-elevated)", borderLeft: "1px solid var(--border-light)",
    display: "flex", flexDirection: "column",
    boxShadow: "-16px 0 48px rgba(0,0,0,0.5)",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0,
  },
  title:    { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" },
  closeBtn: { background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" },
  empty:    { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 },
  list:     { flex: 1, overflowY: "auto", padding: "8px 0" },
  entry: {
    padding: "10px 16px", cursor: "pointer",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    transition: "background 0.1s",
  },
  entryMeta: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  okDot:    { width: 6, height: 6, borderRadius: "50%", background: "var(--green)", flexShrink: 0 },
  errDot:   { width: 6, height: 6, borderRadius: "50%", background: "var(--red)", flexShrink: 0 },
  time:     { fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" },
  chip: {
    fontSize: 10, padding: "1px 6px", borderRadius: 4,
    background: "rgba(129,140,248,0.1)", color: "var(--accent-text)", fontWeight: 600,
  },
  errChip: {
    fontSize: 10, padding: "1px 6px", borderRadius: 4,
    background: "rgba(248,113,113,0.1)", color: "var(--red)", fontWeight: 600,
  },
  sql: { margin: 0, fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" as const, lineHeight: 1.4 },
};
