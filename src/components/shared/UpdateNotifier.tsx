import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: "fixed",
    bottom: 24,
    right: 24,
    zIndex: 9000,
    background: "var(--bg2, #1a1a2e)",
    border: "1px solid var(--accent, #6366f1)",
    borderRadius: 12,
    padding: "16px 20px",
    width: 320,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    animation: "slideUp 0.25s ease",
  },
  title: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 4,
    color: "var(--text, #e2e8f0)",
  },
  sub: {
    fontSize: 12,
    color: "var(--muted, #64748b)",
    marginBottom: 14,
  },
  row: {
    display: "flex",
    gap: 8,
  },
  btnPrimary: {
    flex: 1,
    padding: "7px 0",
    borderRadius: 7,
    border: "none",
    background: "var(--accent, #6366f1)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSecondary: {
    flex: 1,
    padding: "7px 0",
    borderRadius: 7,
    border: "1px solid var(--border, #2a2a3e)",
    background: "transparent",
    color: "var(--muted, #64748b)",
    fontSize: 13,
    cursor: "pointer",
  },
  progress: {
    fontSize: 12,
    color: "var(--accent, #6366f1)",
    marginTop: 8,
    textAlign: "center" as const,
  },
};

export default function UpdateNotifier() {
  const [update, setUpdate]       = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Espera 5 segundos para no interrumpir el arranque
    const timer = setTimeout(async () => {
      try {
        const u = await check();
        if (u?.available) setUpdate(u);
      } catch {
        // silencioso — sin conexión o sin releases firmadas aún
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  if (!update || dismissed) return null;

  async function install() {
    if (!update) return;
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      console.error("[updater]", e);
      setInstalling(false);
    }
  }

  return (
    <>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={styles.banner}>
        <div style={styles.title}>🎉 Nueva versión disponible</div>
        <div style={styles.sub}>
          Datum {update.version} ya está lista para instalar.
        </div>
        {installing ? (
          <div style={styles.progress}>Descargando e instalando…</div>
        ) : (
          <div style={styles.row}>
            <button style={styles.btnPrimary} onClick={install}>
              Actualizar ahora
            </button>
            <button style={styles.btnSecondary} onClick={() => setDismissed(true)}>
              Después
            </button>
          </div>
        )}
      </div>
    </>
  );
}
