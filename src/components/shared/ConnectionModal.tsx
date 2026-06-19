import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SavedConnection, DriverType } from "../../types";

interface Props {
  onSave:           (conn: SavedConnection, password: string) => void;
  onClose:          () => void;
  initialConn?:     SavedConnection;   // si se pasa → modo edición
  initialPassword?: string;
}

const DRIVERS: DriverType[] = ["PostgreSQL", "MySQL", "SQLite", "SqlServer"];
const DEFAULT_PORTS: Record<DriverType, number> = {
  PostgreSQL: 5432,
  MySQL:      3306,
  SQLite:     0,
  SqlServer:  1433,
};

export default function ConnectionModal({ onSave, onClose, initialConn, initialPassword }: Props) {
  const isEdit = !!initialConn;

  function isRemoteHost(host: string) {
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  }

  const [form, setForm] = useState({
    name:     initialConn?.name     ?? "",
    driver:   initialConn?.driver   ?? ("PostgreSQL" as DriverType),
    host:     initialConn?.host     ?? "localhost",
    port:     initialConn?.port     ?? 5432,
    database: initialConn?.database ?? "",
    username: initialConn?.username ?? "",
    // SSL activado por defecto en hosts remotos (nueva conexión)
    use_ssl:  initialConn ? initialConn.use_ssl : false,
    use_ssh:  initialConn?.use_ssh  ?? false,
  });
  const [password,    setPassword]    = useState(initialPassword ?? "");
  const [testing,     setTesting]     = useState(false);
  const [testResult,  setTestResult]  = useState<{ ok: boolean; msg: string } | null>(null);

  function set(key: string, value: unknown) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Cuando cambia el host en una nueva conexión, ajusta SSL automáticamente
      if (key === "host" && !isEdit) {
        next.use_ssl = isRemoteHost(String(value));
      }
      return next;
    });
    setTestResult(null);
  }

  function handleDriverChange(driver: DriverType) {
    setForm((f) => ({ ...f, driver, port: DEFAULT_PORTS[driver] }));
    setTestResult(null);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const conn: SavedConnection = { ...form, id: initialConn?.id ?? crypto.randomUUID() };
    try {
      const msg = await invoke<string>("open_connection", { connection: conn, password });
      setTestResult({ ok: true, msg });
      await invoke("close_connection", { connectionId: conn.id });
    } catch (e: unknown) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // En edición conserva el id original; en creación genera uno nuevo
    const id = initialConn?.id ?? crypto.randomUUID();
    onSave({ ...form, id }, password);
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>
            {isEdit ? "Editar conexión" : "Nueva conexión"}
          </span>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Driver selector */}
          <div style={styles.field}>
            <label style={styles.label}>Motor de base de datos</label>
            <div style={styles.driverGrid}>
              {DRIVERS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleDriverChange(d)}
                  style={{
                    ...styles.driverBtn,
                    background:  form.driver === d ? "var(--accent-dim)"  : "var(--bg-elevated)",
                    borderColor: form.driver === d ? "var(--accent)"      : "var(--border)",
                    color:       form.driver === d ? "var(--accent-text)" : "var(--text-secondary)",
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <Field label="Nombre" required>
            <input
              style={styles.input}
              placeholder="ej. prod-postgres"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              required
            />
          </Field>

          {form.driver === "SQLite" ? (
            <Field label="Ruta al archivo .db">
              <input
                style={styles.input}
                placeholder="/Users/tu/base.db"
                value={form.database}
                onChange={(e) => set("database", e.target.value)}
              />
            </Field>
          ) : (
            <>
              <div style={styles.row2}>
                <Field label="Host" style={{ flex: 1 }}>
                  <input
                    style={styles.input}
                    value={form.host}
                    onChange={(e) => set("host", e.target.value)}
                  />
                </Field>
                <Field label="Puerto" style={{ width: 90 }}>
                  <input
                    style={styles.input}
                    type="number"
                    value={form.port}
                    onChange={(e) => set("port", Number(e.target.value))}
                  />
                </Field>
              </div>

              <Field label="Base de datos">
                <input
                  style={styles.input}
                  placeholder="mydb"
                  value={form.database}
                  onChange={(e) => set("database", e.target.value)}
                />
              </Field>

              <div style={styles.row2}>
                <Field label="Usuario" style={{ flex: 1 }}>
                  <input
                    style={styles.input}
                    placeholder="postgres"
                    value={form.username}
                    onChange={(e) => set("username", e.target.value)}
                  />
                </Field>
                <Field label="Contraseña" style={{ flex: 1 }}>
                  <input
                    style={styles.input}
                    type="password"
                    placeholder={isEdit ? "Dejar vacío para no cambiar" : "••••••••"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              </div>

              <div style={styles.checkRow}>
                <label style={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={form.use_ssl}
                    onChange={(e) => set("use_ssl", e.target.checked)}
                  />
                  SSL
                </label>
                <label style={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={form.use_ssh}
                    onChange={(e) => set("use_ssh", e.target.checked)}
                  />
                  SSH Tunnel
                </label>
              </div>
            </>
          )}

          {testResult && (
            <div style={{
              padding: "8px 12px", borderRadius: 6, fontSize: 12,
              background: testResult.ok ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
              border: `1px solid ${testResult.ok ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
              color: testResult.ok ? "var(--green)" : "var(--red)",
            }}>
              {testResult.ok ? "✓ " : "✗ "}{testResult.msg}
            </div>
          )}

          <div style={styles.actions}>
            <button type="button" style={styles.testBtn} onClick={handleTest} disabled={testing}>
              {testing ? "Probando..." : "Probar conexión"}
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={styles.cancelBtn} onClick={onClose}>Cancelar</button>
              <button type="submit" style={styles.saveBtn}>
                {isEdit ? "Guardar cambios" : "Guardar"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children, required, style }: {
  label: string; children: React.ReactNode; required?: boolean; style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
        {label}{required && <span style={{ color: "var(--red)" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
  },
  modal: {
    background: "var(--bg-surface)", border: "1px solid var(--border)",
    borderRadius: 10, width: 460, maxHeight: "90vh", overflow: "auto",
    boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
  },
  modalHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 18px", borderBottom: "1px solid var(--border)",
  },
  modalTitle: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" },
  closeBtn: {
    background: "transparent", border: "none",
    color: "var(--text-secondary)", fontSize: 16, padding: 4, cursor: "pointer",
  },
  form: { display: "flex", flexDirection: "column", gap: 14, padding: 18 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  label: { fontSize: 11, color: "var(--text-muted)", fontWeight: 500 },
  driverGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  driverBtn: {
    padding: "8px 10px", borderRadius: 6, border: "1px solid",
    fontSize: 12, fontWeight: 500, cursor: "pointer", transition: "all 0.12s",
  },
  input: {
    background: "var(--bg-elevated)", border: "1px solid var(--border)",
    borderRadius: 6, padding: "7px 10px", color: "var(--text-primary)",
    fontSize: 13, outline: "none", width: "100%",
  },
  row2: { display: "flex", gap: 8 },
  checkRow: { display: "flex", gap: 16 },
  checkLabel: {
    display: "flex", alignItems: "center", gap: 6,
    fontSize: 12, color: "var(--text-secondary)", cursor: "pointer",
  },
  actions: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    gap: 8, paddingTop: 6, borderTop: "1px solid var(--border)", marginTop: 4,
  },
  testBtn: {
    padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border-light)",
    background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
  },
  cancelBtn: {
    padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border)",
    background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
  },
  saveBtn: {
    padding: "7px 14px", borderRadius: 6, border: "none",
    background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
};
