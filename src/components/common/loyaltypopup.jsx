import React, { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";

export default function LoyaltyPopup({ user, open, onClose }) {
  const [loading, setLoading] = useState(true);
  const [loyalty, setLoyalty] = useState(null);

  useEffect(() => {
    if (!user || !open) return;
    let ignore = false;
    setLoading(true);
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/loyalty?user=${user.id}`);
        const json = await res.json();
        setLoyalty(json.data || json);
      } catch {
        setLoyalty(null);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => { ignore = true; };
  }, [user, open]);

  if (!open) return null;

  // Responsive + modal styles
  const popupStyle = {
    position: "fixed",
    top: 0, left: 0,
    width: "100vw", height: "100vh",
    zIndex: 99999,
    background: "rgba(28,35,52,0.29)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit"
  };
  const cardStyle = {
    width: "97vw", maxWidth: 380,
    background: "#fff",
    borderRadius: 18,
    boxShadow: "0 8px 36px #18325023",
    border: "1.8px solid #e4e7ef",
    padding: "27px 19px 16px 19px",
    position: "relative",
    overflowY: "auto",
    maxHeight: "89vh"
  };
  const closeStyle = {
    position: "absolute",
    top: 11, right: 15,
    background: "none",
    border: "none",
    fontSize: 28,
    color: "#0C2340",
    fontWeight: 800,
    cursor: "pointer",
    zIndex: 11
  };

  // Responsive CSS
  const responsive = `
    @media (max-width: 600px) {
      .loycard { max-width: 99vw !important; padding: 13px 4px 8px 8px !important; }
      .loytitle { font-size: 19px !important; }
      .loybig { font-size: 23px !important; }
      .loyrewards { flex-direction: column !important; gap: 8px !important; }
    }
    @media (max-width: 400px) {
      .loycard { padding: 5px 1vw 2vw 2vw !important; }
    }
  `;

  return (
    <div style={popupStyle} tabIndex={-1} aria-modal="true" role="dialog">
      <style>{responsive}</style>
      <div className="loycard" style={cardStyle}>
        <button aria-label="Close loyalty popup" style={closeStyle} onClick={onClose}>×</button>
        <div className="loytitle" style={{
          fontWeight: 900,
          fontSize: 22,
          color: "#0C2340",
          marginBottom: 11,
          textAlign: "center"
        }}>
          Loyalty & Rewards
        </div>
        {loading ? (
          <div style={{ color: "#8ea", textAlign: "center", padding: "38px 0" }}>Loading your loyalty status...</div>
        ) : !loyalty ? (
          <div style={{ color: "#a44", textAlign: "center", padding: "38px 0" }}>Could not load loyalty info.</div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <span style={{
                color: "#21ad57",
                fontWeight: 900,
                fontSize: 21,
                marginBottom: 1
              }}>
                {loyalty.points} Points
              </span>
              <span className="loybig" style={{ fontWeight: 800, color: "#142a50", fontSize: 19 }}>
                {loyalty.tier} Member
              </span>
              <span style={{ color: "#297a42", fontSize: 14 }}>
                {loyalty.nextTier &&
                  <>Next: <b>{loyalty.nextTier}</b> ({loyalty.pointsToNext} pts)</>
                }
              </span>
              {loyalty.referralCode && (
                <span style={{
                  background: "#f3f8e4",
                  color: "#8a9606",
                  fontWeight: 800,
                  fontSize: 15,
                  borderRadius: 8,
                  padding: "6px 18px",
                  margin: "6px 0"
                }}>
                  Referral Code: <span style={{ color: "#1f2f4f" }}>{loyalty.referralCode}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(loyalty.referralCode);
                    }}
                    aria-label="Copy referral code"
                    style={{
                      marginLeft: 7,
                      border: "none",
                      background: "#edf7da",
                      color: "#587a0d",
                      borderRadius: 5,
                      padding: "2px 8px",
                      fontSize: 13,
                      cursor: "pointer"
                    }}
                  >Copy</button>
                </span>
              )}
            </div>
            {/* REWARDS */}
            <div style={{
              margin: "15px 0 2px 0",
              fontWeight: 700,
              color: "#0C2340",
              fontSize: 16
            }}>
              Rewards & Gifts
            </div>
            <div className="loyrewards" style={{
              display: "flex",
              flexDirection: "row",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 7
            }}>
              {(loyalty.rewards || []).map(r => (
                <div key={r.id} style={{
                  background: r.status === "unlocked" ? "#e4faed" : "#f7f5e7",
                  color: r.status === "unlocked" ? "#218838" : "#bfa307",
                  fontWeight: 700,
                  borderRadius: 7,
                  fontSize: 15,
                  padding: "6px 13px",
                  minWidth: 80,
                  textAlign: "center",
                  border: r.status === "unlocked" ? "1.2px solid #a1f7b7" : "1.2px solid #fae89a"
                }}>
                  <span>{r.label}</span>
                  {r.expiry && (
                    <span style={{ color: "#c56a32", fontWeight: 500, fontSize: 12, marginLeft: 4 }}>
                      (Exp: {new Date(r.expiry).toLocaleDateString()})
                    </span>
                  )}
                  <div style={{ fontSize: 13, color: r.status === "unlocked" ? "#37b85b" : "#c2a408" }}>
                    {r.status === "unlocked" ? "Available" : r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                  </div>
                </div>
              ))}
              {(!loyalty.rewards || !loyalty.rewards.length) && (
                <span style={{ color: "#8a8", fontSize: 14, fontWeight: 600 }}>No unlocked rewards yet.</span>
              )}
            </div>
            {/* HISTORY */}
            <div style={{
              marginTop: 11, fontWeight: 700, color: "#0C2340", fontSize: 16
            }}>
              Recent Activities
            </div>
            <div style={{ fontSize: 14, color: "#485167", margin: "7px 0 0 0" }}>
              <ul style={{ margin: 0, paddingLeft: 19 }}>
                {(loyalty.history || []).map((h, i) => (
                  <li key={i} style={{ margin: "2px 0" }}>
                    {new Date(h.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: <b>{h.activity}</b>
                    {typeof h.points !== "undefined" &&
                      <span style={{ color: "#178e41", fontWeight: 800, marginLeft: 6 }}>+{h.points} pts</span>
                    }
                  </li>
                ))}
                {(!loyalty.history || !loyalty.history.length) && (
                  <span style={{ color: "#bbb", fontSize: 13 }}>No recent activities.</span>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
