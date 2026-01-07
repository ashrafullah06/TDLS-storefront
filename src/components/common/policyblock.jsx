import React from "react";

export default function PolicyBlock({ policies = [] }) {
  if (!Array.isArray(policies) || policies.length === 0) return null;
  return (
    <section style={{
      width: "100%",
      maxWidth: 1200,
      margin: "3.2rem auto 2rem auto",
      borderRadius: 16,
      background: "linear-gradient(100deg, #FFF6E0 0%, #F8F8F3 100%)",
      boxShadow: "0 1px 18px 0 rgba(36,31,68,0.07)",
      padding: "2.2em 1.5em 1.7em 1.5em"
    }}>
      <h2 style={{
        fontSize: "1.7em",
        fontWeight: 700,
        color: "#19203B",
        textAlign: "center",
        margin: "0 0 1em 0"
      }}>Why Shop With Us?</h2>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "1.8em",
        justifyItems: "center"
      }}>
        {policies.map((p, i) => (
          <div key={p.id || i} style={{
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 1px 8px #c9b15d17",
            padding: "1.4em 1.2em",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            minHeight: 160,
            maxWidth: 270,
          }}>
            {p.icon && (
              <img src={p.icon} alt={p.title} style={{ width: 48, height: 48, marginBottom: 10 }} />
            )}
            <div style={{ fontWeight: 600, fontSize: "1.12em", color: "#19203B", marginBottom: 6 }}>
              {p.title}
            </div>
            <div style={{ fontSize: "0.99em", color: "#45433d", textAlign: "center" }}>
              {p.summary}
            </div>
            {p.link && (
              <a
                href={p.link}
                style={{
                  color: "#C9B15D",
                  fontWeight: 700,
                  marginTop: 8,
                  fontSize: "0.97em",
                  textDecoration: "underline",
                }}
              >
                Learn more
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
