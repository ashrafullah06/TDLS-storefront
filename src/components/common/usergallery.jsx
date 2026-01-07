import React, { useEffect, useState } from "react";
const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";

export default function UserGallery({ productId }) {
  const [ugc, setUGC] = useState([]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/usergallery?product=${productId}`);
        const json = await res.json();

        let arr = json.data || json;
        if (!Array.isArray(arr)) arr = [];
        if (!ignore) setUGC(arr);
      } catch {
        if (!ignore) setUGC([]);
      }
    }
    load();
    return () => { ignore = true; };
  }, [productId]);

  if (!ugc || !Array.isArray(ugc) || ugc.length === 0) return null;

  return (
    <div style={{ margin: "40px 0 18px 0" }}>
      <h3 style={{ fontWeight: 900, fontSize: 19, color: "#0C2340" }}>Customer Gallery</h3>
      <div style={{ display: "flex", gap: 11, overflowX: "auto" }}>
        {ugc.map((item, i) => (
          <img
            key={i}
            src={item.image?.url || item.image}
            alt={`Customer photo ${i + 1}`}
            style={{
              width: 74, height: 74, objectFit: "cover", borderRadius: 13, boxShadow: "0 1px 7px #eee"
            }}
          />
        ))}
      </div>
    </div>
  );
}
