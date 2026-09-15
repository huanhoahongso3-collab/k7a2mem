import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        background: "#181112",
        color: "#ecdfe1",
        fontFamily: "'Google Sans', 'Roboto', system-ui, sans-serif",
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 500, margin: 0 }}>K7A2</h1>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        <Link href="/kyyeu" style={cardStyle}>
          <span style={{ fontSize: 40 }}>📷</span>
          <span style={cardTitle}>Kỷ yếu</span>
          <span style={cardSubtitle}>Photo album</span>
        </Link>
        <Link href="/onedrive" style={cardStyle}>
          <span style={{ fontSize: 40 }}>☁️</span>
          <span style={cardTitle}>K7A2</span>
          <span style={cardSubtitle}>Browse files</span>
        </Link>
      </div>
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  width: 180,
  padding: "32px 20px",
  borderRadius: 20,
  background: "#251d1f",
  color: "#ecdfe1",
  textDecoration: "none",
  boxShadow: "0 1px 2px rgba(0,0,0,.30), 0 2px 6px 2px rgba(0,0,0,.15)",
  transition: "transform 150ms ease, background 150ms ease",
};

const cardTitle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 500,
};

const cardSubtitle: React.CSSProperties = {
  fontSize: 13,
  color: "#d5c2c6",
};
