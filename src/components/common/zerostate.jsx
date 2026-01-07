// components/ZeroState.jsx
export default function ZeroState({ message, actionLabel, onAction }) {
  return (
    <div style={{
      background: "#F8F6ED", color: "#b99225", padding: 30, borderRadius: 18, textAlign: "center",
      boxShadow: "0 4px 28px #e5e2b444", maxWidth: 420, margin: "30px auto"
    }}>
      <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 12 }}>{message}</div>
      {actionLabel && <button onClick={onAction} style={{
        marginTop: 12, padding: "11px 24px", borderRadius: 9, background: "#E6C873", color: "#7B2326",
        border: "none", fontWeight: 700, fontSize: 15, cursor: "pointer"
      }}>{actionLabel}</button>}
    </div>
  );
}
