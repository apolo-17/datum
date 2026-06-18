/**
 * TableErdModal — modal que muestra una tabla específica con sus relaciones directas.
 * Estilo DBeaver: tabla seleccionada al centro, tablas relacionadas alrededor.
 */
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactFlow, {
  Node, Edge, Background, Controls,
  useNodesState, useEdgesState, BackgroundVariant,
  EdgeProps, getBezierPath, Handle, Position,
} from "reactflow";
import "reactflow/dist/style.css";
import type { SavedConnection, TableSchema, ColumnSchema } from "../../types";

interface Props {
  connection:   SavedConnection;
  password:     string;
  connectionId: string; // id de la DB-level connection ya abierta
  schema:       string;
  tableName:    string;
  onClose:      () => void;
}

// ── Edge con rayo de luz ──────────────────────────────────────────────────────
function GlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const seed = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const dur  = (1.8 + (seed % 8) * 0.25).toFixed(1);
  return (
    <>
      <path className="react-flow__edge-path" d={path} stroke="#818cf8" strokeWidth={1.5} strokeOpacity={0.4} fill="none" />
      <circle r={5} fill="#818cf8" fillOpacity={0.15}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} />
      </circle>
      <circle r={2.5} fill="#c7d2fe" style={{ filter: "drop-shadow(0 0 5px #818cf8)" }}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} />
      </circle>
      <circle r={1} fill="white">
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} />
      </circle>
    </>
  );
}

// ── Nodo tabla ────────────────────────────────────────────────────────────────
function TableNode({ data }: {
  data: { name: string; schema: string; columns: ColumnSchema[]; isTarget: boolean }
}) {
  return (
    <div style={{ ...ns.wrapper, border: data.isTarget ? "2px solid var(--accent)" : "1px solid var(--border)" }}>
      <Handle type="target" position={Position.Left}
        style={{ background: "#818cf8", border: "none", width: 8, height: 8 }} />
      <div style={{ ...ns.header, background: data.isTarget ? "var(--accent)" : "var(--accent-dim)" }}>
        <span style={ns.schema}>{data.schema}</span>
        <span style={{ ...ns.name, color: data.isTarget ? "#fff" : "var(--accent-text)" }}>
          {data.name}
        </span>
      </div>
      <div style={ns.body}>
        {data.columns.map((col) => (
          <div key={col.name} style={{
            ...ns.col,
            background: col.is_primary_key ? "rgba(251,191,36,0.07)"
              : col.is_foreign_key ? "rgba(129,140,248,0.07)" : "transparent",
          }}>
            <span style={{ ...ns.badge,
              color: col.is_primary_key ? "#fbbf24" : col.is_foreign_key ? "#818cf8" : "transparent" }}>
              {col.is_primary_key ? "PK" : col.is_foreign_key ? "FK" : "  "}
            </span>
            <span style={ns.colName}>{col.name}</span>
            <span style={ns.colType}>{col.data_type.replace("character varying", "varchar").replace("timestamp without time zone", "timestamp")}</span>
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

const NODE_W   = 230;
const HEADER_H = 56;
const COL_H    = 24;
const GAP_Y    = 40;

// ── Layout: target en centro, referenciados a la izquierda, referenciantes a la derecha ──
function buildLayout(
  allTables: TableSchema[],
  targetName: string,
  schema: string,
): { nodes: Node[]; edges: Edge[] } {
  const target = allTables.find((t) => t.name === targetName);
  if (!target) return { nodes: [], edges: [] };

  // Tablas que target referencia (outgoing FK)
  const outgoingNames = new Set(
    target.columns.filter((c) => c.is_foreign_key && c.references_table).map((c) => c.references_table!)
  );

  // Tablas que referencian a target (incoming FK)
  const incomingNames = new Set(
    allTables
      .filter((t) => t.name !== targetName && t.columns.some((c) => c.is_foreign_key && c.references_table === targetName))
      .map((t) => t.name)
  );

  const outgoing = allTables.filter((t) => outgoingNames.has(t.name) && t.name !== targetName);
  const incoming = allTables.filter((t) => incomingNames.has(t.name) && t.name !== targetName);

  const targetH  = HEADER_H + target.columns.length * COL_H;
  const nodes: Node[] = [];

  // ── Centro: target ──
  nodes.push({
    id:       `${schema}.${targetName}`,
    type:     "tableNode",
    position: { x: NODE_W + 120, y: 0 },
    data:     { name: targetName, schema, columns: target.columns, isTarget: true },
    style:    { width: NODE_W },
  });

  // ── Izquierda: outgoing ──
  const leftColH = outgoing.reduce((s, t) => s + HEADER_H + t.columns.length * COL_H + GAP_Y, 0);
  let leftY = (targetH - leftColH) / 2;
  outgoing.forEach((t) => {
    const h = HEADER_H + t.columns.length * COL_H;
    nodes.push({
      id:       `${schema}.${t.name}`,
      type:     "tableNode",
      position: { x: 0, y: leftY },
      data:     { name: t.name, schema, columns: t.columns, isTarget: false },
      style:    { width: NODE_W },
    });
    leftY += h + GAP_Y;
  });

  // ── Derecha: incoming ──
  const rightColH = incoming.reduce((s, t) => s + HEADER_H + t.columns.length * COL_H + GAP_Y, 0);
  let rightY = (targetH - rightColH) / 2;
  incoming.forEach((t) => {
    const h = HEADER_H + t.columns.length * COL_H;
    nodes.push({
      id:       `${schema}.${t.name}`,
      type:     "tableNode",
      position: { x: (NODE_W + 120) * 2, y: rightY },
      data:     { name: t.name, schema, columns: t.columns, isTarget: false },
      style:    { width: NODE_W },
    });
    rightY += h + GAP_Y;
  });

  // ── Edges ──
  const edges: Edge[] = [];
  const seen = new Set<string>();

  const allShown = [target, ...outgoing, ...incoming];
  const shownIds = new Set(allShown.map((t) => `${schema}.${t.name}`));

  allShown.forEach((t) => {
    t.columns.forEach((col) => {
      if (!col.is_foreign_key || !col.references_table) return;
      const src = `${schema}.${t.name}`;
      const tgt = `${schema}.${col.references_table}`;
      if (!shownIds.has(src) || !shownIds.has(tgt) || src === tgt) return;
      const eid = `${src}→${tgt}`;
      if (seen.has(eid)) return;
      seen.add(eid);
      edges.push({ id: eid, source: src, target: tgt, type: "glowEdge" });
    });
  });

  return { nodes, edges };
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function TableErdModal({ connection, password, connectionId, schema, tableName, onClose }: Props) {
  const [loading, setLoading]  = useState(true);
  const [error,   setError]    = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [relCount, setRelCount] = useState({ out: 0, inc: 0 });

  useEffect(() => {
    (async () => {
      try {
        await invoke("open_connection", { connection, password });
        const tables = await invoke<TableSchema[]>("get_tables", { connectionId, schema });
        const { nodes: n, edges: e } = buildLayout(tables, tableName, schema);

        const target = tables.find((t) => t.name === tableName);
        const outN = target?.columns.filter((c) => c.is_foreign_key && c.references_table).length ?? 0;
        const incN = tables.filter((t) => t.name !== tableName &&
          t.columns.some((c) => c.is_foreign_key && c.references_table === tableName)).length;
        setRelCount({ out: outN, inc: incN });

        setNodes(n);
        setEdges(e);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [connectionId, schema, tableName]);

  return (
    <div style={ui.overlay} onClick={onClose}>
      <div style={ui.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={ui.header}>
          <div style={ui.headerLeft}>
            <span style={ui.schemaLabel}>{schema}</span>
            <span style={ui.dot}>·</span>
            <span style={ui.tableLabel}>{tableName}</span>
            {!loading && !error && (
              <span style={ui.meta}>
                {relCount.out} ref salientes · {relCount.inc} ref entrantes
              </span>
            )}
          </div>
          <button style={ui.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: "relative" }}>
          {loading && <div style={ui.center}><span style={ui.hint}>Cargando relaciones…</span></div>}
          {error   && <div style={{ ...ui.center, color: "var(--red)" }}>✗ {error}</div>}
          {!loading && !error && nodes.length === 0 && (
            <div style={ui.center}><span style={ui.hint}>Sin relaciones encontradas</span></div>
          )}
          {!loading && !error && nodes.length > 0 && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.3}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
              <Controls style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 }} />
            </ReactFlow>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Estilos nodo ──────────────────────────────────────────────────────────────
const ns: Record<string, any> = {
  wrapper:  { background: "var(--bg-surface)", borderRadius: 8, overflow: "visible", boxShadow: "0 4px 20px rgba(0,0,0,0.5)", minWidth: 200 },
  header:   { padding: "8px 12px", borderBottom: "1px solid var(--border)", borderRadius: "8px 8px 0 0" },
  schema:   { fontSize: 9, color: "rgba(255,255,255,0.6)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const, display: "block", marginBottom: 2 },
  name:     { fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono)" },
  body:     { padding: "4px 0" },
  col:      { display: "flex", alignItems: "center", gap: 6, padding: "3px 12px", fontSize: 11, fontFamily: "var(--font-mono)" },
  badge:    { fontSize: 8, fontWeight: 700, width: 14, flexShrink: 0 },
  colName:  { flex: 1, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  colType:  { color: "var(--text-muted)", fontSize: 10, flexShrink: 0 },
};

// ── Estilos UI ────────────────────────────────────────────────────────────────
const ui: Record<string, React.CSSProperties> = {
  overlay:     { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500 },
  modal:       { width: "85vw", height: "80vh", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.7)" },
  header:      { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-surface)" },
  headerLeft:  { display: "flex", alignItems: "center", gap: 6 },
  schemaLabel: { fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" },
  dot:         { color: "var(--text-muted)", fontSize: 10 },
  tableLabel:  { fontSize: 14, fontWeight: 700, color: "var(--accent-text)", fontFamily: "var(--font-mono)" },
  meta:        { fontSize: 11, color: "var(--text-muted)", marginLeft: 8 },
  closeBtn:    { background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", fontSize: 14, width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  center:      { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  hint:        { fontSize: 13, color: "var(--text-muted)" },
};
