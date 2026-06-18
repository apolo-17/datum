import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import type { SavedConnection, QueryResult } from "../../types";

interface Props {
  connection: SavedConnection | null;
  password: string;
  onResult: (result: QueryResult) => void;
}

export default function SqlEditor({ connection, password, onResult }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monta CodeMirror una sola vez
  useEffect(() => {
    if (!editorRef.current) return;

    const startDoc = "SELECT *\nFROM users\nLIMIT 50;";

    const state = EditorState.create({
      doc: startDoc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        sql(),
        oneDark,
        keymap.of([
          ...defaultKeymap,
          indentWithTab,
          {
            key: "Mod-Enter",
            run: () => {
              handleRunRef.current();
              return true;
            },
          },
        ]),
        EditorView.theme({
          "&": {
            height: "200px",
            fontSize: "13px",
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          },
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

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Ref para que el keymap de CodeMirror pueda llamar la versión actualizada
  const handleRunRef = useRef<() => void>(() => {});

  async function handleRun() {
    if (!connection) {
      setError("Selecciona una conexión en el sidebar primero.");
      return;
    }
    const sql = viewRef.current?.state.doc.toString() ?? "";
    if (!sql.trim()) return;

    setRunning(true);
    setError(null);

    try {
      await invoke("open_connection", { connection, password }).catch(() => {});
      const result = await invoke<QueryResult>("execute_query", {
        connectionId: connection.id,
        sql,
      });
      onResult(result);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  // Mantiene el ref sincronizado
  handleRunRef.current = handleRun;

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <button
          style={{
            ...styles.btn,
            background: "var(--accent)",
            borderColor: "var(--accent)",
            color: "#fff",
            opacity: running ? 0.6 : 1,
          }}
          onClick={handleRun}
          disabled={running}
        >
          {running ? "⏳ Ejecutando..." : "▶ Run"}
        </button>
        <button style={styles.btn}>⊞ Formato</button>
        <button style={styles.btn}>⏱ Historial</button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {connection && (
            <span style={styles.connBadge}>{connection.name}</span>
          )}
          <button style={{ ...styles.btn, borderColor: "var(--purple)", color: "var(--purple)" }}>
            ✦ Ask AI
          </button>
        </div>
      </div>

      {/* Editor CodeMirror */}
      <div
        ref={editorRef}
        style={{ background: "#0f1117", borderBottom: "1px solid var(--border)" }}
      />

      <div style={styles.hint}>⌘ + Enter para ejecutar</div>

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
  },
  btn: {
    padding: "4px 10px",
    borderRadius: 4,
    border: "1px solid var(--border-light)",
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 500,
  },
  connBadge: {
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 4,
    background: "var(--accent-dim)",
    color: "var(--accent-text)",
    fontWeight: 500,
  },
  hint: {
    padding: "4px 12px",
    fontSize: 11,
    color: "var(--text-muted)",
    background: "var(--bg-surface)",
    textAlign: "right" as const,
  },
  error: {
    padding: "8px 12px",
    background: "rgba(248,113,113,0.1)",
    borderTop: "1px solid rgba(248,113,113,0.3)",
    color: "var(--red)",
    fontSize: 12,
  },
};
