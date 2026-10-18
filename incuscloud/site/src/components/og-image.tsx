// Open Graph card (1200×630), rendered at build time by Takumi. Inline styles only: Takumi draws a
// subset of CSS, not the site's Tailwind. Monochrome like the site, with the grid as the texture.
export const OgImage = ({ title, description, eyebrow }: { title: string; description?: string; eyebrow?: string }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      width: "100%",
      height: "100%",
      padding: 72,
      backgroundColor: "#09090b",
      backgroundImage:
        "radial-gradient(60% 50% at 50% 0%, rgba(255,255,255,0.12), transparent 70%), linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)",
      backgroundSize: "100% 100%, 56px 56px, 56px 56px",
      color: "#fafafa",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 56,
          height: 56,
          borderRadius: 14,
          backgroundColor: "#fafafa",
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#18181b" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 12 5.5 6.5M12 12l6.5-5.5M12 12v7" />
          <circle cx="12" cy="12" r="2.6" fill="#18181b" stroke="none" />
          <circle cx="5" cy="6" r="2.2" />
          <circle cx="19" cy="6" r="2.2" />
          <circle cx="12" cy="19.5" r="2.2" />
        </svg>
      </div>
      <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: -1 }}>IncusCloud</span>
      <span style={{ fontSize: 24, color: "#71717a" }}>by hyprr</span>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {eyebrow && <span style={{ fontSize: 22, letterSpacing: 4, textTransform: "uppercase", color: "#71717a" }}>{eyebrow}</span>}
      <span style={{ fontSize: 68, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>{title}</span>
      {description && <span style={{ fontSize: 30, lineHeight: 1.4, color: "#a1a1aa" }}>{description}</span>}
    </div>
  </div>
);
