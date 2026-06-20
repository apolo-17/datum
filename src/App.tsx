import { useState, useEffect, useCallback } from "react";
import "./App.css";
import Sidebar from "./components/sidebar/Sidebar";
import SqlEditor from "./components/editor/SqlEditor";
import ResultsTable from "./components/results/ResultsTable";
import ErdDiagram from "./components/erd/ErdDiagram";
import DataBrowser from "./components/browser/DataBrowser";
import TableErdModal from "./components/erd/TableErdModal";
import SearchModal, { type SearchEntry } from "./components/shared/SearchModal";
import SplashScreen from "./components/shared/SplashScreen";
import UpdateNotifier from "./components/shared/UpdateNotifier";
import TermsModal from "./components/shared/TermsModal";
import type { SavedConnection, QueryResult } from "./types";

const TERMS_KEY = "datum-terms-accepted";

// ── Tipos ──────────────────────────────────────────────────────────────────

type TabKind = "editor" | "browser" | "erd";

interface DatumTab {
  id: string;
  kind: TabKind;
  label: string;
  icon: string;
  // browser
  browsedTable?: { schema: string; name: string } | null;
  browsedSchema?: string | null;
  // editor
  queryResult?: QueryResult | null;
  // erd
  erdFocusSchema?: string;
  erdConnection?:  SavedConnection | null;
  erdPassword?:    string;
}

interface TableErdTarget {
  connection: SavedConnection;
  password:   string;
  schema:     string;
  tableName:  string;
}

function makeId() { return Math.random().toString(36).slice(2, 9); }

const INITIAL_TAB: DatumTab = { id: "t0", kind: "editor", label: "SQL Editor", icon: "⌨" };

// ── App ────────────────────────────────────────────────────────────────────

function App() {
  // ── Terms ───────────────────────────────────────────────────────────────
  const [termsAccepted, setTermsAccepted] = useState(() =>
    localStorage.getItem(TERMS_KEY) === "1"
  );
  function handleAcceptTerms() {
    localStorage.setItem(TERMS_KEY, "1");
    setTermsAccepted(true);
  }

  // ── Splash ──────────────────────────────────────────────────────────────
  const [showSplash, setShowSplash] = useState(true);

  // ── Tema ────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    return (localStorage.getItem("datum-theme") as "dark" | "light") ?? "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("datum-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  const [tabs, setTabs]               = useState<DatumTab[]>([INITIAL_TAB]);
  const [activeTabId, setActiveTabId] = useState<string>("t0");
  const [activeConnection, setActiveConnection] = useState<SavedConnection | null>(null);
  const [activePassword, setActivePassword]     = useState<string>("");
  const [tableErdTarget, setTableErdTarget]     = useState<TableErdTarget | null>(null);
  const [searchOpen, setSearchOpen]             = useState(false);
  const [searchIndex, setSearchIndex]           = useState<SearchEntry[]>([]);

  // ⌘K / Ctrl+K abre el search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleIndexUpdate = useCallback((entries: SearchEntry[]) => {
    setSearchIndex(entries);
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────

  function addTab(partial: Omit<DatumTab, "id">): string {
    const id = makeId();
    setTabs(prev => [...prev, { id, ...partial }]);
    setActiveTabId(id);
    return id;
  }

  function updateTab(id: string, patch: Partial<DatumTab>) {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }

  function closeTab(id: string) {
    setTabs(prev => {
      let next = prev.filter(t => t.id !== id);
      if (next.length === 0) {
        const fallback: DatumTab = { id: makeId(), kind: "editor", label: "SQL Editor", icon: "⌨" };
        next = [fallback];
      }
      if (activeTabId === id) {
        const idx = prev.findIndex(t => t.id === id);
        const newActive = next[Math.max(0, idx - 1)];
        if (newActive) setActiveTabId(newActive.id);
      }
      return next;
    });
  }

  // ── Acciones del sidebar ───────────────────────────────────────────────

  function openTable(schema: string, name: string) {
    const existing = tabs.find(
      t => t.kind === "browser" && t.browsedTable?.schema === schema && t.browsedTable?.name === name
    );
    if (existing) { setActiveTabId(existing.id); return; }
    addTab({ kind: "browser", label: name, icon: "⊞", browsedTable: { schema, name }, browsedSchema: null });
  }

  function openSchema(schema: string) {
    const existing = tabs.find(t => t.kind === "browser" && t.browsedSchema === schema && !t.browsedTable);
    if (existing) { setActiveTabId(existing.id); return; }
    addTab({ kind: "browser", label: schema, icon: "⊞", browsedSchema: schema, browsedTable: null });
  }

  function openSchemaErd(schema: string) {
    const existing = tabs.find(t => t.kind === "erd" && t.erdFocusSchema === schema && t.erdConnection?.id === activeConnection?.id);
    if (existing) { setActiveTabId(existing.id); return; }
    addTab({ kind: "erd", label: `ERD · ${schema}`, icon: "⬡", erdFocusSchema: schema, erdConnection: activeConnection, erdPassword: activePassword });
  }

  function openTableErd(conn: SavedConnection, password: string, schema: string, tableName: string) {
    setTableErdTarget({ connection: conn, password, schema, tableName });
  }

  function newEditorTab() {
    addTab({ kind: "editor", label: "SQL Editor", icon: "⌨" });
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
    {!termsAccepted && <TermsModal onAccept={handleAcceptTerms} />}
    {showSplash && termsAccepted && <SplashScreen onDone={() => setShowSplash(false)} />}
    <UpdateNotifier />
    <div style={s.app}>
      {/* ── Tab bar ── */}
      <div style={s.tabBar}>
        <div style={s.tabStrip}>
          {tabs.map(tab => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                style={{
                  ...s.tab,
                  background: isActive ? "var(--bg-base)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                  borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                }}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span style={{ fontSize: 11 }}>{tab.icon}</span>
                <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tab.label}
                </span>
                <button
                  style={s.closeBtn}
                  onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                  title="Cerrar tab"
                >
                  ×
                </button>
              </div>
            );
          })}

          {/* Botón nueva tab */}
          <button style={s.newTabBtn} onClick={newEditorTab} title="Nueva pestaña SQL">
            +
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            style={s.searchBtn}
            onClick={() => setSearchOpen(true)}
            title="Buscar tabla o columna (⌘K)"
          >
            <span style={{ fontSize: 12 }}>⌕</span>
            <span>Buscar…</span>
            <kbd style={s.searchKbd}>⌘K</kbd>
          </button>
          <button
            style={s.themeBtn}
            onClick={toggleTheme}
            title={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <div style={s.windowTitle}>
            {activeConnection
              ? `${activeConnection.name} · ${activeConnection.driver}`
              : "datum"}
          </div>
        </div>
      </div>

      {/* ── Layout principal ── */}
      <div style={s.layout}>
        <Sidebar
          activeConnection={activeConnection}
          onSelectConnection={(conn, pwd) => {
            setActiveConnection(conn);
            setActivePassword(pwd);
          }}
          onTableOpen={openTable}
          onSchemaOpen={openSchema}
          onSchemaErd={openSchemaErd}
          onTableErd={openTableErd}
          onIndexUpdate={handleIndexUpdate}
        />

        {/* Área de tabs — todas montadas, solo la activa visible */}
        <div style={s.main}>
          {tabs.map(tab => (
            <div
              key={tab.id}
              style={{ ...s.tabContent, display: tab.id === activeTabId ? "flex" : "none" }}
            >
              {tab.kind === "editor" && (
                <>
                  <SqlEditor
                    connection={activeConnection}
                    password={activePassword}
                    onResult={result => updateTab(tab.id, { queryResult: result })}
                  />
                  <ResultsTable result={tab.queryResult ?? null} />
                </>
              )}

              {tab.kind === "browser" && (
                <DataBrowser
                  connection={activeConnection}
                  password={activePassword}
                  table={tab.browsedTable ?? null}
                  schema={tab.browsedSchema ?? null}
                  onTableOpen={openTable}
                />
              )}

              {tab.kind === "erd" && (
                <ErdDiagram
                  connection={tab.erdConnection ?? activeConnection}
                  password={tab.erdPassword ?? activePassword}
                  onTableOpen={openTable}
                  focusSchema={tab.erdFocusSchema}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Search global ⌘K */}
      {searchOpen && (
        <SearchModal
          index={searchIndex}
          onSelect={openTable}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Mini ERD modal */}
      {tableErdTarget && (
        <TableErdModal
          connection={tableErdTarget.connection}
          password={tableErdTarget.password}
          connectionId={tableErdTarget.connection.id}
          schema={tableErdTarget.schema}
          tableName={tableErdTarget.tableName}
          onClose={() => setTableErdTarget(null)}
        />
      )}

      {/* Status bar */}
      <div style={s.statusBar}>
        <span style={s.statusDot(!!activeConnection)} />
        <span style={{ color: "var(--text-muted)" }}>
          {activeConnection
            ? `${activeConnection.host}:${activeConnection.port} · ${activeConnection.database}`
            : "Sin conexión activa"}
        </span>
        <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
          Datum v0.1.0
        </span>
      </div>
    </div>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, any> = {
  app: {
    display: "flex", flexDirection: "column",
    height: "100vh", background: "var(--bg-base)", overflow: "hidden",
  },
  tabBar: {
    display: "flex", alignItems: "stretch",
    justifyContent: "space-between",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0, minHeight: 36,
  },
  tabStrip: {
    display: "flex", alignItems: "stretch", flex: 1,
    overflow: "hidden", gap: 0,
  },
  tab: {
    display: "flex", alignItems: "center", gap: 6,
    padding: "0 10px", fontSize: 12, fontWeight: 500,
    cursor: "pointer", userSelect: "none",
    borderRight: "1px solid var(--border)",
    transition: "background 0.1s",
    minWidth: 0, flexShrink: 0,
  },
  closeBtn: {
    background: "transparent", border: "none",
    color: "var(--text-muted)", fontSize: 14,
    cursor: "pointer", padding: "0 2px",
    lineHeight: 1, borderRadius: 3,
    marginLeft: 2, flexShrink: 0,
    opacity: 0.7,
  },
  newTabBtn: {
    background: "transparent", border: "none",
    color: "var(--text-muted)", fontSize: 18,
    cursor: "pointer", padding: "0 14px",
    lineHeight: 1, alignSelf: "center",
  },
  windowTitle: {
    fontSize: 12, color: "var(--text-muted)",
    fontWeight: 500, padding: "0 16px",
    display: "flex", alignItems: "center", flexShrink: 0,
  },
  layout: {
    display: "flex", flex: 1, overflow: "hidden",
  },
  main: {
    flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
  },
  tabContent: {
    flex: 1, flexDirection: "column", overflow: "hidden",
  },
  statusBar: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "4px 12px",
    background: "var(--bg-surface)",
    borderTop: "1px solid var(--border)",
    fontSize: 11, flexShrink: 0,
  },
  searchBtn: {
    display: "flex", alignItems: "center", gap: 6,
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-muted)", fontSize: 12,
    padding: "4px 10px", cursor: "pointer",
  },
  searchKbd: {
    background: "var(--bg-surface)", border: "1px solid var(--border-light)",
    borderRadius: 3, padding: "1px 4px", fontSize: 10,
    fontFamily: "var(--font-mono)", color: "var(--text-muted)",
    marginLeft: 4,
  },
  themeBtn: {
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 6, color: "var(--text-secondary)", fontSize: 14,
    padding: "4px 8px", cursor: "pointer", lineHeight: 1,
  },
  statusDot: (connected: boolean) => ({
    width: 6, height: 6, borderRadius: "50%",
    background: connected ? "var(--green)" : "var(--text-muted)",
    flexShrink: 0,
  }),
};

export default App;
