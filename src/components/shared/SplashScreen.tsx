import { useEffect, useState } from "react";
import datumLogo from "../../assets/datum-logo.svg";

interface Props {
  onDone: () => void;
}

export default function SplashScreen({ onDone }: Props) {
  const [progress, setProgress] = useState(0);
  const [fading,   setFading]   = useState(false);

  // Barra de carga
  useEffect(() => {
    let val = 0;
    const iv = setInterval(() => {
      val += Math.random() * 14 + 4;
      if (val >= 90) { val = 90; clearInterval(iv); }
      setProgress(val);
    }, 100);
    return () => clearInterval(iv);
  }, []);

  // Completa y hace fade-out
  useEffect(() => {
    const t = setTimeout(() => {
      setProgress(100);
      setTimeout(() => {
        setFading(true);
        setTimeout(onDone, 500);
      }, 400);
    }, 2400);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <>
      <style>{`
        @keyframes datum-float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }
        @keyframes datum-glow {
          0%, 100% { filter: drop-shadow(0 0 18px rgba(0,196,255,0.35)) drop-shadow(0 0 6px rgba(0,196,255,0.2)); }
          50%       { filter: drop-shadow(0 0 36px rgba(0,196,255,0.65)) drop-shadow(0 0 14px rgba(0,196,255,0.4)); }
        }
        @keyframes datum-particle {
          0%   { stroke-dashoffset: 200; opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { stroke-dashoffset: 0;   opacity: 0; }
        }
        .datum-logo-img {
          animation: datum-float 3.2s ease-in-out infinite,
                     datum-glow  2.4s ease-in-out infinite;
          width: 680px;
          max-width: 90vw;
          display: block;
          border-radius: 16px;
        }
      `}</style>

      <div style={{
        ...s.overlay,
        opacity: fading ? 0 : 1,
        transition: "opacity 0.5s ease",
      }}>
        {/* Logo */}
        <img
          src={datumLogo}
          alt="Datum"
          className="datum-logo-img"
        />

        {/* Barra de carga */}
        <div style={s.barWrap}>
          <div style={{ ...s.barFill, width: `${progress}%` }} />
        </div>

        <p style={s.label}>
          {progress < 90 ? "Cargando…" : progress < 100 ? "Iniciando conexiones…" : "Listo"}
        </p>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 9999,
    background: "#080c10",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    gap: 28,
  },
  barWrap: {
    width: 680, maxWidth: "90vw", height: 3,
    background: "rgba(0,196,255,0.10)",
    borderRadius: 2, overflow: "hidden",
  },
  barFill: {
    height: "100%",
    background: "linear-gradient(90deg, #00c4ff, #0080ff)",
    borderRadius: 2,
    transition: "width 0.2s ease",
    boxShadow: "0 0 10px rgba(0,196,255,0.7)",
  },
  label: {
    margin: 0, fontSize: 11,
    color: "#2a5a6a",
    fontFamily: "'Courier New', Courier, monospace",
    letterSpacing: "0.18em",
    textTransform: "uppercase",
  },
};
