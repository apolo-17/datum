import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import dagre from "dagre";
import ReactFlow, {
  Node, Edge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, BackgroundVariant,
  EdgeProps, getBezierPath,
  Handle, Position,
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

// ── Edge con rayo de luz ──────────────────────────────────────────────────────
function GlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });
  const seed = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const dur  = (1.6 + (seed % 12) * 0.2).toFixed(1);

  return (
    <>
      <path
        className="react-flow__edge-path"
        d={edgePath}
        stroke="#818cf8"
        strokeWidth={1.5}
        strokeOpacity={0.35}
        fill="none"
      />
      <circle r={6} fill="#818cf8" fillOpacity={0.12}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={edgePath} />
      </circle>
      <circle r={3} fill="#c7d2fe" style={{ filter: "drop-shadow(0 0 5px #818cf8)" }}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={edgePath} />
      </circle>
      <circle r={1.2} fill="white" fillOpacity={0.9}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={edgePath} />
      </circle>
    </>
  );
}

// ── Nodo tabla ────────────────────────────────────────────────────────────────
function TableNode({ data }: {
  data: { name: string; schema: string; columns: ColumnSchema[]; onOpen: () => void }
}) {
  return (
    <div
      style={nodeStyles.wrapper}
      onDoubleClick={data.onOpen}
      title="Doble click para ver datos"
    >
      <Handle type="target" position={Position.Left}
        style={{ background: "#818cf8", border: "none", width: 8, height: 8 }} />

      <div style={nodeStyles.header}>
        <span style={nodeStyles.schemaLabel}>{data.schema}</span>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={nodeStyles.tableName}>{data.name}</span>
          <span
            style={nodeStyles.viewBtn}
            onClick={(e) => { e.stopPropagation(); data.onOpen(); }}
            title="Ver datos"
          >⊞</span>
        </div>
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

      <Handle type="source" position={Position.Right}
        style={{ background: "#818cf8", border: "none", width: 8, height: 8 }} />
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };
const edgeTypes = { glowEdge: GlowEdge };

// ── Constantes de layout ──────────────────────────────────────────────────────
const NODE_W   = 240;
const HEADER_H = 68;
const COL_H    = 26;

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 100 });

  nodes.forEach((node) => {
    const cols = (node.data as any).columns.length;
    const h    = HEADER_H + cols * COL_H;
    g.setNode(node.id, { width: NODE_W, height: h });
  });
  edges.forEach((edge) => g.setEdge(edge.source, edge.target));

  dagre.layout(g);

  return nodes.map((node) => {
    const { x, y }  = g.node(node.id);
    const cols       = (node.data as any).columns.length;
    const h          = HEADER_H + cols * COL_H;
    return {
      ...node,
      position: { x: x - NODE_W / 2, y: y - h / 2 },
    };
  });
}

// ── buildEdges ────────────────────────────────────────────────────────────────
function buildEdges(
  tables: { schema: string; table: TableSchema }[],
  nodeIds: Set<string>,
): Edge[] {
  const edges: Edge[] = [];
  const seen          = new Set<string>();
  const nameToId      = new Map<string, string>();

  tables.forEach(({ schema, table }) => {
    nameToId.set(table.name, `${schema}.${table.name}`);
  });

  tables.forEach(({ schema, table }) => {
    table.columns.forEach((col) => {
      if (!col.is_foreign_key || !col.references_table) return;
      const sourceId = `${schema}.${table.name}`;
      const targetId = nameToId.get(col.references_table) ?? `${schema}.${col.references_table}`;
      if (!nodeIds.has(sourceId) || !nodeIds.has(targetId) || sourceId === targetId) return;
      const edgeId = `${sourceId}→${targetId}`;
      if (seen.has(edgeId)) return;
      seen.add(edgeId);
      edges.push({ id: edgeId, source: sourceId, target: targetId, type: "glowEdge" });
    });
  });

  return edges;
}

// ── Componente principal ──────────────────────────────────────────────────────
interface Props {
  connection:  SavedConnection | null;
  password:    string;
  onTableOpen: (schema: string, name: string) => void;
}

export default function ErdDiagram({ connection, password, onTableOpen }: Props) {
  const [schemas,      setSchemas]      = useState<string[]>([]);
  const [activeSchema, setActiveSchema] = useState<string>("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (!connection) { setSchemas([]); setActiveSchema(""); setNodes([]); setEdges([]); return; }
    (async () => {
      try {
        await invoke("open_connection", { connection, password });
        const s = await invoke<string[]>("get_schemas", { connectionId: connection.id });
        setSchemas(s);
        setActiveSchema(s[0] ?? "");
      } catch (e) { setError(String(e)); }
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

      const flat = tables.map((t) => ({ schema, table: t }));

      // Nodos con callback de apertura inyectado en data
      const rawNodes: Node[] = flat.map(({ schema: s, table }) => ({
        id:    `${s}.${table.name}`,
        type:  "tableNode",
        position: { x: 0, y: 0 },
        data: {
          name:    table.name,
          schema:  s,
          columns: table.columns,
          onOpen:  () => onTableOpen(s, table.name),
        },
        style: { width: NODE_W },
      }));

      const nodeIds  = new Set(rawNodes.map((n) => n.id as string));
      const newEdges = buildEdges(flat, nodeIds);
      const laidOut  = applyDagreLayout(rawNodes, newEdges);

      setNodes(laidOut);
      setEdges(newEdges);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [connection?.id, onTableOpen]);

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
      <div style={ui.toolbar}>
        <span style={ui.toolbarTitle}>ERD · {connection.database || connection.name}</span>
        <div style={ui.schemaTabs}>
          {schemas.map((s) => (
            <button key={s} onClick={() => setActiveSchema(s)} style={{
              ...ui.schemaTab,
              background:  s === activeSchema ? "var(--accent-dim)"  : "transparent",
              color:       s === activeSchema ? "var(--accent-text)" : "var(--text-muted)",
              borderColor: s === activeSchema ? "var(--accent)"      : "transparent",
            }}>{s}</button>
          ))}
        </div>
        <button style={ui.refreshBtn} onClick={() => loadSchema(activeSchema)} title="Recargar">↺</button>
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        {loading  && <div style={ui.overlay}><span style={ui.hint}>Cargando…</span></div>}
        {error    && <div style={{ ...ui.overlay, color: "var(--red)" }}>✗ {error}</div>}
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
          onNodeDoubleClick={(_, node) => {
            onTableOpen(node.data.schema, node.data.name);
          }}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
          <Controls style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 }} />
          <MiniMap
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 }}
            nodeColor="var(--accent-dim)"
            maskColor="rgba(0,0,0,0.35)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}

// ── Estilos nodo ──────────────────────────────────────────────────────────────
const nodeStyles: Record<string, any> = {
  wrapper: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "visible",
    boxShadow: "0 2px 16px rgba(0,0,0,0.5)",
    minWidth: 200,
    cursor: "default",
  },
  header: {
    background: "var(--accent-dim)",
    borderBottom: "1px solid var(--border)",
    padding: "8px 10px 8px 12px",
    borderRadius: "8px 8px 0 0",
  },
  schemaLabel: {
    fontSize: 9,
    color: "var(--accent-text)",
    opacity: 0.7,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    display: "block",
    marginBottom: 2,
  },
  tableName: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--accent-text)",
    fontFamily: "var(--font-mono)",
  },
  viewBtn: {
    fontSize: 13,
    cursor: "pointer",
    opacity: 0.6,
    padding: "0 2px",
    borderRadius: 3,
    color: "var(--accent-text)",
    userSelect: "none" as const,
  },
  body:    { padding: "4px 0" },
  colRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 12px",
    fontSize: 11,
    fontFamily: "var(--font-mono)",
  },
  badge:   { fontSize: 8, fontWeight: 700, width: 14, flexShrink: 0 },
  colName: { flex: 1, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  colType: { color: "var(--text-muted)", fontSize: 10, flexShrink: 0 },
  notNull: { fontSize: 9, color: "var(--red)", opacity: 0.7, flexShrink: 0 },
};

// ── Estilos UI ────────────────────────────────────────────────────────────────
const ui: Record<string, React.CSSProperties> = {
  container:    { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", height: "100%" },
  toolbar:      { display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 },
  toolbarTitle: { fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginRight: 8, flexShrink: 0 },
  schemaTabs:   { display: "flex", gap: 4, flex: 1, overflowX: "auto" },
  schemaTab:    { padding: "3px 10px", fontSize: 11, borderRadius: 4, border: "1px solid", cursor: "pointer", fontWeight: 500, flexShrink: 0 },
  refreshBtn:   { background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", fontSize: 14, width: 26, height: 26, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  center:       { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, height: "100%" },
  overlay:      { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, pointerEvents: "none" },
  hint:         { fontSize: 13, color: "var(--text-muted)" },
};
