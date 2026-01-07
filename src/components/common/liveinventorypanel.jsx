import React, { useEffect, useState } from "react";

// --- STRAPI-FRIENDLY FETCHERS ---
// You may use your real fetch helper with JWT if needed
const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";

// Single product inventory
async function fetchLiveInventoryByProduct(productId) {
  if (!productId) return null;
  const res = await fetch(`${API_BASE}/api/inventory?product=${productId}`);
  if (!res.ok) return null;
  const data = await res.json();
  // Shape: { productId, stock, eta, warehouse, updatedAt }
  return data;
}

// User order-tracking inventory
async function fetchLiveInventoryByUser(userId) {
  if (!userId) return [];
  const res = await fetch(`${API_BASE}/api/orders/${userId}/inventory`);
  if (!res.ok) return [];
  const data = await res.json();
  // Shape: [ { productId, productName, stock, eta, warehouse }, ... ]
  return Array.isArray(data) ? data : [];
}

// --- MAIN PANEL ---
export default function LiveInventoryPanel({ productId, userId, showTracking = false, showEta = true }) {
  const [loading, setLoading] = useState(true);
  const [inventory, setInventory] = useState(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    async function load() {
      try {
        let data;
        if (productId) {
          data = await fetchLiveInventoryByProduct(productId);
        } else if (userId && showTracking) {
          data = await fetchLiveInventoryByUser(userId);
        }
        if (!ignore) setInventory(data);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => { ignore = true; };
  }, [productId, userId, showTracking]);

  // --- STYLES: Responsive + Clean ---
  const panelStyle = {
    background: "#fcfdff",
    borderRadius: 13,
    border: "1.2px solid #e7eaf1",
    padding: 18,
    margin: "16px 0",
    maxWidth: 630,
    minWidth: 210,
    color: "#17592e",
    boxShadow: "0 1px 8px #e7eaf733",
    fontWeight: 700,
    fontSize: 16,
    width: "100%",
    overflowX: "auto",
    // Responsive tweak
    ...(window?.innerWidth < 600 ? { padding: 8, fontSize: 15 } : {}),
  };

  // --- MOBILE-FRIENDLY MEDIA QUERIES ---
  const responsiveStyles = `
    @media (max-width: 650px) {
      .liveinv-panel { padding: 7px !important; font-size: 15px !important; }
      .liveinv-table th, .liveinv-table td { font-size: 14px !important; padding: 5px 2px !important;}
    }
    @media (max-width: 430px) {
      .liveinv-panel { padding: 4px !important; font-size: 13.5px !important; }
      .liveinv-table th, .liveinv-table td { font-size: 12.5px !important; padding: 3px 1px !important;}
    }
  `;

  // --- Loading ---
  if (loading) {
    return (
      <div className="liveinv-panel" style={panelStyle}>
        <style>{responsiveStyles}</style>
        <span style={{ color: "#7a8e99" }}>Checking live inventory...</span>
      </div>
    );
  }

  // --- Single product mode ---
  if (productId && inventory) {
    return (
      <div className="liveinv-panel" style={panelStyle} aria-live="polite" aria-label="Live Inventory Status">
        <style>{responsiveStyles}</style>
        <div style={{ fontSize: 17, color: "#17592e", fontWeight: 800, marginBottom: 7 }}>
          Live Inventory
        </div>
        <div>
          <span>In Stock: </span>
          <span style={{
            fontWeight: 900,
            color: inventory.stock > 5 ? "#217d44" : inventory.stock > 0 ? "#e49c0b" : "#b2290c"
          }}>
            {inventory.stock > 0 ? inventory.stock : "Out of Stock"}
          </span>
        </div>
        <div>
          <span>Warehouse: </span>
          <b>{inventory.warehouse}</b>
        </div>
        {showEta && (
          <div>
            <span>Estimated Delivery: </span>
            <b>{inventory.eta}</b>
          </div>
        )}
        <div style={{ fontSize: 12.5, color: "#888", marginTop: 3 }}>
          Last updated: {new Date(inventory.updatedAt).toLocaleString()}
        </div>
      </div>
    );
  }

  // --- User tracking mode: table of orders/products ---
  if (userId && showTracking && Array.isArray(inventory)) {
    return (
      <div className="liveinv-panel" style={panelStyle} aria-label="Live Inventory Tracking">
        <style>{responsiveStyles}</style>
        <div style={{ fontSize: 17, color: "#17592e", fontWeight: 800, marginBottom: 10 }}>
          Live Inventory & Delivery Status
        </div>
        <div style={{ overflowX: "auto", width: "100%" }}>
          <table className="liveinv-table" style={{
            width: "100%",
            fontSize: 15,
            borderCollapse: "collapse",
            minWidth: 320
          }}>
            <thead>
              <tr style={{ color: "#297a42", background: "#f4fcf7" }}>
                <th style={{ textAlign: "left", paddingBottom: 7 }}>Product</th>
                <th style={{ textAlign: "right", paddingBottom: 7 }}>Stock</th>
                <th style={{ textAlign: "right", paddingBottom: 7 }}>ETA</th>
                <th style={{ textAlign: "right", paddingBottom: 7, display: window?.innerWidth < 600 ? "none" : undefined }}>Warehouse</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map(item => (
                <tr key={item.productId} style={{ borderTop: "1px solid #e4e7ef" }}>
                  <td style={{ padding: "7px 0", fontWeight: 700 }}>{item.productName}</td>
                  <td style={{ textAlign: "right", color: item.stock > 5 ? "#218838" : item.stock > 0 ? "#c99204" : "#b2290c" }}>
                    {item.stock > 0 ? item.stock : "Out of Stock"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {item.eta}
                  </td>
                  <td style={{
                    textAlign: "right",
                    display: window?.innerWidth < 600 ? "none" : undefined
                  }}>
                    {item.warehouse}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
          Real-time warehouse sync. Need urgent delivery? <a href="https://wa.me/8801700000000" style={{ color: "#25d366", textDecoration: "underline" }}>WhatsApp us</a>
        </div>
      </div>
    );
  }

  // --- No data ---
  return null;
}
