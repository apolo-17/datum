import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, BackgroundVariant,
  EdgeProps, getBezierPath, BaseEdge,
} from "reactflow";
import "reactflow/dist/style.css";
import type { SavedConnection, TableSchema, ColumnSchema } from "../../types";

// ── Tipos cortos ──────────────────────────────────────────────────────────────
function shortType(t: string): string {
  const map: Record<string, string> = {
    "character varying":           "varchar",
    "timestamp without time zone": "timestamp",
    "timestamp with time zone":    "timestamptz",
    "double precision":            "float8",
    "bigint":                      "int8",
    "integer":                     "int4",
    "smallint":                    "int2",
    "boolean":                     "bool",
    "character":                   "char",
  };
  return map[t] ?? t;
}

// ── Edge con rayo de luz animado ──────────────────────────────────────────────
function GlowEdge({
  id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  // Velocidades aleatorias por edge para que no sean iguales todos
  const dur = 1.8 + (parseInt(id, 36) % 10) * 0.18;

  return (
    <g>
      {/* Línea base tenue */}
      <BaseEdge path={edgePath} style={{ stroke: "#818cf8", strokeWidth: 1, opacity: 0.25 }} />

      {/* Halo exterior del rayo */}
      <circle r={7} fill="#818cf8" opacity={0.12} style={{ filter: "blur(3px)" }}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={edgePath} />
      </circle>

      {/* Punto central brillante */}
      <circle r={3} fill="#c7d2fe" style={{ filter: "drop-shadow(0 0 5px #818cf8) drop-shadow(0 0 10px #818cf8)" }}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={edgePath} />
      </circle>

      {/* Núcleo blanco */}
      <circle r={1.2} fill="white">
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={edgePath} />
      </circle>
    </g>
  );
}

const edgeTypes = { glowEdge: GlowEdge };

// ── Nodo tabla ────────────────────────────────────────────────────────────────
function TableNode({ data }: { data: { name: string; schema: string; columns: ColumnSchema[] } }) {
  return (
    <div style={nodeStyles.wrapper}>
      <div style={nodeStyles.header}>
        <span style={nodeStyles.schemaLabel}>{data.schema}</span>
        <span style={nodeStyles.tableName}>{data.name}</span>
      </div>
      <div style={nodeStyles.body}>
        {data.columns.map((col) => (
          <div
            key={col.name}
            style={{
              ...nodeStyles.colRow,
              background: col.is_primary_key
                ? "rgba(251,191,36,0.07)"
                : col.is_foreign_key
                ? "rgba(129,140,248,0.07)"
                : "transparent",
            }}
          >
            <span style={{
              ...nodeStyles.badge,
              color: col.is_primary_key ? "#fbbf24" : col.is_foreign_key ? "#818cf8" : "transparent",
            }}>
              {col.is_primary_key ? "PK" : col.is_foreign_key ? "FK" : "  "}
            </span>
            <span style={nodeStyles.colName}>{col.name}</span>
            <span style={nodeStyles.colType}>{shortType(col.data_type)}</span>
            {!col.nullable && <span style={nodeStyles.notNull}>!</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

// ── Layout en grid ─────────────────────────────────────────────────────────────
const NODE_W    = 240;
const NODE_GAP_X = 80;
const NODE_GAP_Y = 60;
const COLS       = 4;
const HEADER_H   = 52;
const COL_H      = 26;

function buildLayout(tables: { schema: string; table: TableSchema }[]): Node[] {
  return tables.map(({ schema, table }, i) => {
    const col     = i % COLS;
    const row     = Math.floor(i / COLS);
    const nodeH   = HEADER_H + table.columns.length * COL_H;
    // Offset vertical de cada columna para que no se amontonen
    const colOff  = col * 30;
    return {
      id: `${schema}.${table.name}`,
      type: "tableNode",
      position: {
        x: col * (NODE_W + NODE_GAP_X),
        y: row * (nodeH + NODE_GAP_Y) + colOff,
      },
      data: { name: table.name, schema, columns: table.columns },
      style: { width: NODE_W },
    };
  });
}

function buildEdges(
  tables: { schema: string; table: TableSchema }[],
  nodeIds: Set<string>,
): Edge[] {
  const edges: Edge[] = [];
  const seen = new Set<string>();

  // Mapa de nombre de tabla → nodeId (para resolver refs cross-schema)
  const nameToNodeId = new Map<string, string>();
  tables.forEach(({ schema, table }) => {
    nameToNodeId.set(table.name, `${schema}.${table.name}`);
  });

  tables.forEach(({ schema, table }) => {
    table.columns.forEach((col) => {
      if (!col.is_foreign_key) return;
      const refTable = col.references_table;
      if (!refTable) return;

      const sourceId = `${schema}.${table.name}`;
      // Busca el target: primero en el mapa, si no asume mismo schema
      const targetId = nameToNodeId.get(refTable) ?? `${schema}.${refTable}`;

      // Solo crea el edge si ambos nodos existen
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return;
      if (sourceId === targetId) return; // auto-referencia, skip

      const edgeId = `${sourceId}→${targetId}`;
      if (seen.has(edgeId)) return;
      seen.add(edgeId);

      edges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
        type: "glowEdge",
        animated: false,
      });
    });
  });

  return edges;
}

// ── Componente principal ──────────────────────────────────────────────────────
interface Props {
  connection: SavedConnection | null;
  password: string;
}

export default function ErdDiagram({ connection, password }: Props) {
  const [schemas, setSchemas]     = useState<string[]>([]);
  const [activeSchema, setActive] = useState<string>("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Carga schemas al conectar
  useEffect(() => {
    if (!connection) { setSchemas([]); setActive(""); setNodes([]); setEdges([]); return; }
    (async () => {
      try {
        await invoke("open_connection", { connection, password });
        const s = await invoke<string[]>("get_schemas", { connectionId: connection.id });
        setSchemas(s);
        setActive(s[0] ?? "");
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [connection?.id]);

  const loadSchema = useCallback(async (schema: string) => {
    if (!connection || !schema) return;
    setLoading(true);
    setError(null);
    try {
      const tables = await invoke<TableSchema[]>("get_tables", {
        connectionId: connection.id,
        schema,
      });
      const flat     = tables.map((t) => ({ schema, table: t }));
      const newNodes = buildLayout(flat);
      const nodeIds  = new Set(newNodes.map((n) => n.id));
      const newEdges = buildEdges(flat, nodeIds);
      setNodes(newNodes);
      setEdges(newEdges);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [connection?.id]);

  useEffect(() => {
    if (activeSchema) loadSchema(activeSchema);
  }, [activeSchema]);

  if (!connection) {
    return (
      <div style={ui.center}>
        <span style={{ fontSize: 36, opacity: 0.2 }}>⬡</span>
        <p style={ui.hint}>Selecciona una base de datos en el sidebar</p>
      </div>
    );
  }

  return (
    <div style={ui.container}>
      {/* Toolbar */}
      <div style={ui.toolbar}>
        <span style={ui.toolbarTitle}>ERD · {connection.database || connection.name}</span>
        <div style={ui.schemaTabs}>
          {schemas.map((s) => (
            <button
              key={s}
              style={{
                ...ui.schemaTab,
                background:   s === activeSchema ? "var(--accent-dim)" : "transparent",
                color:        s === activeSchema ? "var(--accent-text)" : "var(--text-muted)",
                borderColor:  s === activeSchema ? "var(--accent)" : "transparent",
              }}
              onClick={() => setActive(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          style={ui.refreshBtn}
          onClick={() => loadSchema(activeSchema)}
          title="Recargar"
        >↺</button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: "relative" }}>
        {loading && (
          <div style={ui.overlay}><span style={ui.hint}>Cargando tablas...</span></div>
        )}
        {error && (
          <div style={{ ...ui.overlay, color: "var(--red)" }}>✗ {error}</div>
        )}
        {!loading && !error && nodes.length === 0 && (
          <div style={ui.overlay}><span style={ui.hint}>Sin tablas en este schema</span></div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--border)"
          />
          <Controls
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
          />
          <MiniMap
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 6,
            }}
            nodeColor="var(--accent-dim)"
            maskColor="rgba(0,0,0,0.35)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// ── Estilos nodo ──────────────────────────────────────────────────────────────
const nodeStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    boxShadow: "0 2px 16px rgba(0,0,0,0.5)",
    minWidth: 200,
  },
  header: {
    background: "var(--accent-dim)",
    borderBottom: "1px solid var(--border)",
    padding: "8px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  schemaLabel: {
    fontSize: 9,
    color: "var(--accent-text)",
    opacity: 0.7,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  },
  tableName: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--accent-text)",
    fontFamily: "var(--font-mono)",
  },
  body: { padding: "4px 0" },
  colRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 12px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
  },
  badge: { fontSize: 8, fontWeight: 700, width: 14, flexShrink: 0 },
  colName: {
    flex: 1,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  colType:  { color: "var(--text-muted)", fontSize: 10, flexShrink: 0 },
  notNull:  { fontSize: 9, color: "var(--red)", opacity: 0.7, flexShrink: 0 },
};

// ── Estilos UI ────────────────────────────────────────────────────────────────
const ui: Record<string, React.CSSProperties> = {
  container: {
    flex: 1, display: "flex", flexDirection: "column",
    overflow: "hidden", height: "100%",
  },
  toolbar: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "6px 12px", background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)", flexShrink: 0,
  },
  toolbarTitle: {
    fontSize: 11, fontWeight: 600,
    color: "var(--text-secondary)", marginRight: 8, flexShrink: 0,
  },
  schemaTabs: { display: "flex", gap: 4, flex: 1, overflowX: "auto" },
  schemaTab: {
    padding: "3px 10px", fontSize: 11, borderRadius: 4,
    border: "1px solid", cursor: "pointer", fontWeight: 500, flexShrink: 0,
  },
  refreshBtn: {
    background: "transparent", border: "1px solid var(--border)",
    borderRadius: 4, color: "var(--text-muted)", fontSize: 14,
    width: 26, height: 26, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  center: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: 12, height: "100%",
  },
  overlay: {
    position: "absolute", inset: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 10, pointerEvents: "none",
  },
  hint: { fontSize: 13, color: "var(--text-muted)" },
};
