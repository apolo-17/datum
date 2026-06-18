import { useState } from "react";
import "./App.css";
import Sidebar from "./components/sidebar/Sidebar";
import SqlEditor from "./components/editor/SqlEditor";
import ResultsTable from "./components/results/ResultsTable";
import ErdDiagram from "./components/erd/ErdDiagram";
import DataBrowser from "./components/browser/DataBrowser";
import TableErdModal from "./components/erd/TableErdModal";
import type { SavedConnection, QueryResult } from "./types";

interface BrowsedTable { schema: string; name: string; }

interface TableErdTarget {
  connection: SavedConnection;
  password:   string;
  schema:     string;
  tableName:  string;
}

type ActiveTab = "editor" | "erd" | "browser";

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("editor");
  const [activeConnection, setActiveConnection] = useState<SavedConnection | null>(null);
  const [activePassword, setActivePassword] = useState<string>("");
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [browsedTable, setBrowsedTable] = useState<BrowsedTable | null>(null);
  const [erdFocusSchema, setErdFocusSchema] = useState<string | undefined>(undefined);
  const [tableErdTarget, setTableErdTarget] = useState<TableErdTarget | null>(null);

  function openTable(schema: string, name: string) {
    setBrowsedTable({ schema, name });
    setActiveTab("browser");
  }

  function openSchemaErd(schema: string) {
    setErdFocusSchema(schema);
    setActiveTab("erd");
  }

  function openTableErd(conn: SavedConnection, password: string, schema: string, tableName: string) {
    setTableErdTarget({ connection: conn, password, schema, tableName });
  }

  return (
    <div style={styles.app}>
      {/* Barra de tabs superior */}
      <div style={styles.tabBar}>
        <div style={styles.tabGroup}>
          <TabBtn label="SQL Editor" icon="⌨" id="editor" active={activeTab} onClick={setActiveTab} />
          <TabBtn label="ERD Diagram" icon="⬡" id="erd" active={activeTab} onClick={setActiveTab} />
          <TabBtn label="Data Browser" icon="⊞" id="browser" active={activeTab} onClick={setActiveTab} />
        </div>
        <div style={styles.windowTitle}>
          {activeConnection
            ? `${activeConnection.name} · ${activeConnection.driver}`
            : "datum"}
        </div>
      </div>

      {/* Layout principal */}
      <div style={styles.layout}>
        {/* Sidebar izquierdo — árbol de conexiones */}
        <Sidebar
          activeConnection={activeConnection}
          onSelectConnection={(conn, pwd) => {
            setActiveConnection(conn);
            setActivePassword(pwd);
            setBrowsedTable(null);
          }}
          onTableOpen={openTable}
          onSchemaErd={openSchemaErd}
          onTableErd={openTableErd}
        />

        {/* Área principal */}
        <div style={styles.main}>
          {activeTab === "editor" && (
            <>
              <SqlEditor
                connection={activeConnection}
                password={activePassword}
                onResult={setQueryResult}
              />
              <ResultsTable result={queryResult} />
            </>
          )}
          {activeTab === "erd" && (
            <ErdDiagram
              connection={activeConnection}
              password={activePassword}
              onTableOpen={openTable}
              focusSchema={erdFocusSchema}
            />
          )}
          {activeTab === "browser" && (
            <DataBrowser
              connection={activeConnection}
              password={activePassword}
              table={browsedTable}
            />
          )}
        </div>
      </div>

      {/* Mini ERD modal para tabla específica */}
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

      {/* Status bar inferior */}
      <div style={styles.statusBar}>
        <span style={styles.statusDot(!!activeConnection)} />
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
  );
}

function TabBtn({
  label, icon, id, active, onClick,
}: {
  label: string;
  icon: string;
  id: ActiveTab;
  active: ActiveTab;
  onClick: (id: ActiveTab) => void;
}) {
  const isActive = id === active;
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        ...styles.tab,
        background: isActive ? "var(--accent-dim)" : "transparent",
        color: isActive ? "var(--accent-text)" : "var(--text-muted)",
        borderColor: isActive ? "var(--accent)" : "transparent",
      }}
    >
      <span>{icon}</span> {label}
    </button>
  );
}

const styles: Record<string, any> = {
  app: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "var(--bg-base)",
    overflow: "hidden",
  },
  tabBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 12px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    gap: 4,
    flexShrink: 0,
  },
  tabGroup: {
    display: "flex",
    gap: 4,
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 12px",
    borderRadius: "var(--radius-md)",
    border: "1px solid",
    fontSize: 12,
    fontWeight: 500,
    transition: "all 0.15s",
  },
  windowTitle: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontWeight: 500,
  },
  layout: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  placeholder: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  statusBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 12px",
    background: "var(--bg-surface)",
    borderTop: "1px solid var(--border)",
    fontSize: 11,
    flexShrink: 0,
  },
  statusDot: (connected: boolean) => ({
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: connected ? "var(--green)" : "var(--text-muted)",
    flexShrink: 0,
  }),
};

export default App;
