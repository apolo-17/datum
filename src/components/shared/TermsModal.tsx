import { exit } from "@tauri-apps/plugin-process";

interface Props {
  onAccept: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 10000,
    background: "rgba(0,0,0,0.85)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modal: {
    background: "var(--bg2, #13131a)",
    border: "1px solid var(--border, #1e1e2e)",
    borderRadius: 16,
    width: "100%",
    maxWidth: 520,
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    padding: "24px 28px 16px",
    borderBottom: "1px solid var(--border, #1e1e2e)",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  logoText: {
    fontSize: 18,
    fontWeight: 700,
    color: "var(--text, #e2e8f0)",
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text, #e2e8f0)",
    margin: 0,
  },
  headerSub: {
    fontSize: 12,
    color: "var(--muted, #64748b)",
    marginTop: 4,
  },
  body: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "20px 28px",
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--accent2, #818cf8)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: 6,
  },
  sectionText: {
    fontSize: 13,
    color: "var(--muted, #64748b)",
    lineHeight: 1.6,
  },
  footer: {
    padding: "16px 28px",
    borderTop: "1px solid var(--border, #1e1e2e)",
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  footerNote: {
    flex: 1,
    fontSize: 11,
    color: "var(--muted, #64748b)",
  },
  btnDecline: {
    padding: "8px 18px",
    borderRadius: 8,
    border: "1px solid var(--border, #1e1e2e)",
    background: "transparent",
    color: "var(--muted, #64748b)",
    fontSize: 13,
    cursor: "pointer",
  },
  btnAccept: {
    padding: "8px 20px",
    borderRadius: 8,
    border: "none",
    background: "var(--accent, #6366f1)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
};

export default function TermsModal({ onAccept }: Props) {
  async function handleDecline() {
    await exit(0);
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logo}>
            <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
              <rect x="10" y="2" width="8" height="5" rx="1.5" fill="#6366f1"/>
              <rect x="10" y="21" width="8" height="5" rx="1.5" fill="#6366f1"/>
              <rect x="2" y="11" width="8" height="5" rx="1.5" fill="#818cf8"/>
              <rect x="18" y="11" width="8" height="5" rx="1.5" fill="#818cf8"/>
              <circle cx="14" cy="14" r="3" fill="#6366f1"/>
              <line x1="14" y1="7" x2="14" y2="11" stroke="#6366f1" strokeWidth="1.5"/>
              <line x1="14" y1="17" x2="14" y2="21" stroke="#6366f1" strokeWidth="1.5"/>
              <line x1="10" y1="14" x2="7" y2="14" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="2 1"/>
              <line x1="18" y1="14" x2="21" y2="14" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="2 1"/>
            </svg>
            <span style={styles.logoText}>Datum</span>
          </div>
          <p style={styles.headerTitle}>Términos de uso y Política de privacidad</p>
          <p style={styles.headerSub}>Versión 1.0 · Efectiva desde el 1 de julio de 2024</p>
        </div>

        {/* Contenido */}
        <div style={styles.body}>
          <div style={styles.section}>
            <div style={styles.sectionTitle}>1. Uso del software</div>
            <p style={styles.sectionText}>
              Datum es un cliente de bases de datos de escritorio. Puedes usarlo
              libremente para conectarte a tus bases de datos PostgreSQL, MySQL y
              SQLite. Está prohibido usar Datum para ofrecer un servicio competidor
              de pago basado en este software sin licencia comercial.
            </p>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>2. Privacidad y datos</div>
            <p style={styles.sectionText}>
              Datum no recopila, transmite ni almacena ningún dato tuyo ni de tus
              bases de datos. Las credenciales de conexión se guardan en el
              Keychain de tu sistema operativo y nunca salen de tu equipo.
              No hay telemetría, analytics ni tracking de ningún tipo.
            </p>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>3. Actualizaciones automáticas</div>
            <p style={styles.sectionText}>
              La app verifica periódicamente si hay nuevas versiones disponibles
              en GitHub Releases. La descarga e instalación de actualizaciones
              siempre requiere tu confirmación explícita.
            </p>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>4. Licencia</div>
            <p style={styles.sectionText}>
              Datum se distribuye bajo la Business Source License 1.1 (BSL 1.1).
              El código fuente está disponible en GitHub. A partir del 1 de enero
              de 2029, se relicenciará automáticamente bajo Apache License 2.0.
            </p>
          </div>

          <div style={styles.section}>
            <div style={styles.sectionTitle}>5. Sin garantías</div>
            <p style={styles.sectionText}>
              Este software se provee "tal cual", sin garantías de ningún tipo.
              El autor no es responsable de pérdidas de datos o daños derivados
              del uso de Datum. Haz siempre backups de tus bases de datos.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <span style={styles.footerNote}>
            Al aceptar, confirmas que leíste y aceptas estos términos.
          </span>
          <button style={styles.btnDecline} onClick={handleDecline}>
            Rechazar
          </button>
          <button style={styles.btnAccept} onClick={onAccept}>
            Aceptar y continuar
          </button>
        </div>
      </div>
    </div>
  );
}
