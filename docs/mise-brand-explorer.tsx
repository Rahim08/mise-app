import { useState } from "react"

const concepts = [
  { id: "stack", label: "Stack", desc: "Три полоски — mise en place" },
  { id: "word", label: "Wordmark", desc: "Только типографика" },
  { id: "mono", label: "Monogram", desc: "Буква M" },
  { id: "plate", label: "Plate", desc: "Тарелка + полоски" },
]

const themes = [
  { id: "dark", label: "Тёмный", bg: "#0a0a0a", text: "#fff" },
  { id: "light", label: "Светлый", bg: "#f2f2f7", text: "#1c1c1e" },
  { id: "blue", label: "Синий", bg: "#007aff", text: "#fff" },
]

// ── CONCEPT 1: Stack (текущий, но улучшенный) ─────────────────────────────────
function StackLogo({ size = 48, color = "#007aff", textColor = "#1c1c1e", showText = true }) {
  const s = size
  return (
    <div style={{ display: "flex", alignItems: "center", gap: s * 0.28 }}>
      <svg width={s} height={s} viewBox="0 0 64 64" fill="none">
        <rect width="64" height="64" rx="16" fill={color}/>
        <rect x="13" y="19" width="38" height="6" rx="3" fill="white"/>
        <rect x="13" y="29" width="28" height="6" rx="3" fill="white" opacity="0.72"/>
        <rect x="13" y="39" width="18" height="6" rx="3" fill="white" opacity="0.44"/>
      </svg>
      {showText && (
        <span style={{
          fontSize: s * 0.54, fontWeight: 800, color: textColor,
          letterSpacing: "-0.04em", fontFamily: "-apple-system, sans-serif",
        }}>mise</span>
      )}
    </div>
  )
}

// ── CONCEPT 2: Wordmark — чистая типографика с акцентом ──────────────────────
function WordmarkLogo({ size = 48, color = "#007aff", textColor = "#1c1c1e" }) {
  const fs = size * 0.7
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 0 }}>
      <span style={{
        fontSize: fs, fontWeight: 900, color: textColor,
        letterSpacing: "-0.06em", fontFamily: "-apple-system, sans-serif",
        lineHeight: 1,
      }}>mis</span>
      <span style={{
        fontSize: fs, fontWeight: 900, color: color,
        letterSpacing: "-0.06em", fontFamily: "-apple-system, sans-serif",
        lineHeight: 1,
      }}>e</span>
    </div>
  )
}

// ── CONCEPT 3: Monogram M ─────────────────────────────────────────────────────
function MonogramLogo({ size = 48, color = "#007aff", textColor = "#1c1c1e", showText = true }) {
  const s = size
  return (
    <div style={{ display: "flex", alignItems: "center", gap: s * 0.28 }}>
      <svg width={s} height={s} viewBox="0 0 64 64" fill="none">
        <rect width="64" height="64" rx="16" fill={color}/>
        {/* Bold M */}
        <path d="M12 48 L12 16 L32 36 L52 16 L52 48" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
      {showText && (
        <span style={{
          fontSize: s * 0.54, fontWeight: 800, color: textColor,
          letterSpacing: "-0.04em", fontFamily: "-apple-system, sans-serif",
        }}>mise</span>
      )}
    </div>
  )
}

// ── CONCEPT 4: Plate — абстрактная тарелка ───────────────────────────────────
function PlateLogo({ size = 48, color = "#007aff", textColor = "#1c1c1e", showText = true }) {
  const s = size
  return (
    <div style={{ display: "flex", alignItems: "center", gap: s * 0.28 }}>
      <svg width={s} height={s} viewBox="0 0 64 64" fill="none">
        <rect width="64" height="64" rx="16" fill={color}/>
        {/* Circle (plate) */}
        <circle cx="32" cy="32" r="18" stroke="white" strokeWidth="4" fill="none" opacity="0.9"/>
        {/* Three lines inside */}
        <rect x="22" y="28" width="20" height="3" rx="1.5" fill="white" opacity="0.95"/>
        <rect x="22" y="33" width="14" height="3" rx="1.5" fill="white" opacity="0.65"/>
      </svg>
      {showText && (
        <span style={{
          fontSize: s * 0.54, fontWeight: 800, color: textColor,
          letterSpacing: "-0.04em", fontFamily: "-apple-system, sans-serif",
        }}>mise</span>
      )}
    </div>
  )
}

const LOGOS = { stack: StackLogo, word: WordmarkLogo, mono: MonogramLogo, plate: PlateLogo }

export default function MiseBrandExplorer() {
  const [activeConcept, setActiveConcept] = useState("stack")
  const [activeTheme, setActiveTheme] = useState("dark")
  const [size, setSize] = useState(56)

  const theme = themes.find(t => t.id === activeTheme)
  const Logo = LOGOS[activeConcept]

  return (
    <div style={{
      minHeight: "100vh", background: "#060606",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif",
      WebkitFontSmoothing: "antialiased",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "44px 20px",
    }}>

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.3)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 12 }}>
          Mise · Brand Explorer
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, color: "#fff", letterSpacing: -0.5 }}>Логотип бренда</div>
      </div>

      {/* Concept selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap", justifyContent: "center", background: "rgba(255,255,255,0.05)", padding: 4, borderRadius: 16, border: "1px solid rgba(255,255,255,0.07)" }}>
        {concepts.map(c => (
          <button key={c.id} onClick={() => setActiveConcept(c.id)} style={{
            padding: "10px 18px", borderRadius: 12, border: "none",
            background: activeConcept === c.id ? "rgba(255,255,255,0.12)" : "transparent",
            color: activeConcept === c.id ? "#fff" : "rgba(255,255,255,0.4)",
            fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
            transition: "all 0.2s",
          }}>
            <div>{c.label}</div>
            <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>{c.desc}</div>
          </button>
        ))}
      </div>

      {/* Theme selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 52, flexWrap: "wrap", justifyContent: "center" }}>
        {themes.map(t => (
          <button key={t.id} onClick={() => setActiveTheme(t.id)} style={{
            padding: "7px 16px", borderRadius: 980, border: "none",
            background: activeTheme === t.id ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)",
            color: activeTheme === t.id ? "#fff" : "rgba(255,255,255,0.4)",
            fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer",
            transition: "all 0.2s",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Main preview */}
      <div style={{
        width: "100%", maxWidth: 480,
        background: theme.bg,
        borderRadius: 24, padding: "56px 40px",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 40,
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
      }}>
        <Logo size={size} color="#007aff" textColor={theme.text} showText={activeConcept !== "word"} />
      </div>

      {/* Size slider */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, background: "rgba(255,255,255,0.04)", padding: "14px 22px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)", marginBottom: 40 }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 600, letterSpacing: 1 }}>РАЗМЕР</span>
        <input type="range" min={28} max={120} value={size} onChange={e => setSize(Number(e.target.value))} style={{ width: 140, accentColor: "#007aff" }} />
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", fontWeight: 600, minWidth: 40 }}>{size}px</span>
      </div>

      {/* Sizes showcase */}
      <div style={{ width: "100%", maxWidth: 480, marginBottom: 40 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginBottom: 16, letterSpacing: 2, textTransform: "uppercase" }}>Все размеры</div>
        <div style={{
          background: "#111", borderRadius: 20, padding: "28px 32px",
          border: "1px solid rgba(255,255,255,0.06)",
          display: "flex", flexDirection: "column", gap: 28,
        }}>
          {[80, 48, 32, 20].map(s => (
            <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Logo size={s} color="#007aff" textColor="#fff" showText={activeConcept !== "word"} />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>{s}px</span>
            </div>
          ))}
        </div>
      </div>

      {/* Nav context */}
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginBottom: 16, letterSpacing: 2, textTransform: "uppercase" }}>В навбаре</div>
        <div style={{
          background: "rgba(255,255,255,0.06)", borderRadius: 16, padding: "0 20px",
          height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
          border: "1px solid rgba(255,255,255,0.08)",
        }}>
          <Logo size={28} color="#007aff" textColor="#fff" showText={activeConcept !== "word"} />
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
          </div>
        </div>
      </div>
    </div>
  )
}
