import React, { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL || "";

// Helper for Strapi images
function toFullUrl(url) {
  if (!url) return "/img/offer-placeholder.png";
  if (url.startsWith("http")) return url;
  return API_BASE.replace(/\/$/, "") + url;
}

export default function PersonalizedOffers({ userId, productId }) {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Dynamic fetch based on user and/or product
  useEffect(() => {
    let ignore = false;
    setLoading(true);

    async function load() {
      let url = `${API_BASE}/api/offers?`;
      if (userId) url += `user=${userId}&`;
      if (productId) url += `product=${productId}&`;
      try {
        const res = await fetch(url);
        const json = await res.json();
        let result = json.data || json; // in case your API wraps data
        if (Array.isArray(result) && result.length === 0 && userId) {
          // fallback: try user offers only if product-specific returns nothing
          const res2 = await fetch(`${API_BASE}/api/offers?user=${userId}`);
          const json2 = await res2.json();
          result = json2.data || json2;
        }
        if (!ignore) setOffers(Array.isArray(result) ? result : []);
      } catch {
        if (!ignore) setOffers([]);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => { ignore = true; };
  }, [userId, productId]);

  // Responsive styles (with some CSS-in-JS)
  const styles = {
    container: {
      width: "100%",
      padding: "14px 4px 0 4px",
      margin: "0 auto",
      maxWidth: 1100,
      boxSizing: "border-box"
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      gap: "20px",
      alignItems: "stretch",
      width: "100%"
    },
    card: {
      background: "#fff",
      borderRadius: 13,
      boxShadow: "0 1px 14px #eaeaea44",
      border: "1.2px solid #e7eaf1",
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
      justifyContent: "space-between",
      padding: "0",
      overflow: "hidden",
      minHeight: 295,
      minWidth: 0
    },
    imgWrap: {
      width: "100%",
      aspectRatio: "16/9",
      minHeight: 120,
      background: "#f5f6fa",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    },
    img: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    },
    body: {
      padding: "18px 16px 14px 16px",
      flex: 1,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between"
    },
    discount: {
      background: "#e5f7eb",
      color: "#138f38",
      fontWeight: 700,
      borderRadius: 7,
      padding: "4px 14px",
      fontSize: 15,
      display: "inline-block",
      marginBottom: 7
    },
    title: {
      fontWeight: 900,
      fontSize: 19,
      color: "#153269",
      marginBottom: 6
    },
    desc: {
      fontSize: 15,
      color: "#486068",
      marginBottom: 9,
      minHeight: 36
    },
    expiry: {
      color: "#a82e10",
      fontSize: 13,
      marginBottom: 10
    },
    cta: {
      display: "inline-block",
      background: "linear-gradient(92deg, #0C2340 80%, #26d37a 100%)",
      color: "#fff",
      borderRadius: 8,
      fontWeight: 800,
      padding: "10px 28px",
      fontSize: 16,
      border: "none",
      marginTop: "auto",
      boxShadow: "0 1px 6px #0c234033",
      cursor: "pointer",
      textDecoration: "none",
      transition: "background .14s"
    }
  };

  // Add responsive tweaks for mobile
  const responsive = `
    @media (max-width: 800px) {
      .persoffers-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) !important; gap: 12px !important; }
      .persoffers-card { min-height: 210px !important; }
      .persoffers-title { font-size: 17px !important; }
    }
    @media (max-width: 480px) {
      .persoffers-body { padding: 9px 6px 7px 7px !important; }
      .persoffers-title { font-size: 15px !important; }
    }
  `;

  // Date formatter
  function prettyDate(str) {
    if (!str) return "";
    const d = new Date(str);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // Loading/empty state
  if (loading) {
    return (
      <div style={styles.container}>
        <style>{responsive}</style>
        <div style={{ color: "#aaa", fontWeight: 700, fontSize: 16, padding: "30px 0" }}>
          Checking your special offers...
        </div>
      </div>
    );
  }
  if (!offers || offers.length === 0) {
    return (
      <div style={styles.container}>
        <style>{responsive}</style>
        <div style={{ color: "#bbb", fontWeight: 600, fontSize: 15, padding: "25px 0" }}>
          No exclusive offers available for you at this time. Please check again later!
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <style>{responsive}</style>
      <h2 style={{
        fontWeight: 800,
        fontSize: 21,
        color: "#0C2340",
        letterSpacing: ".02em",
        margin: "10px 0 17px 8px"
      }}>
        Personalized Offers For You
      </h2>
      <div className="persoffers-grid" style={styles.grid}>
        {offers.map((offer) => (
          <div className="persoffers-card" key={offer.id || offer._id} style={styles.card}>
            <div style={styles.imgWrap}>
              <img
                src={toFullUrl(offer.image?.url)}
                alt={offer.title}
                style={styles.img}
                loading="lazy"
              />
            </div>
            <div className="persoffers-body" style={styles.body}>
              {offer.discount && (
                <div style={styles.discount}>{offer.discount}% OFF</div>
              )}
              <div className="persoffers-title" style={styles.title}>{offer.title}</div>
              <div style={styles.desc}>{offer.description}</div>
              {offer.expiry && (
                <div style={styles.expiry}>Expires: {prettyDate(offer.expiry)}</div>
              )}
              {offer.link && (
                <a
                  href={offer.link}
                  style={styles.cta}
                  aria-label={offer.cta || "Shop Offer"}
                >
                  {offer.cta || "Shop Offer"}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
