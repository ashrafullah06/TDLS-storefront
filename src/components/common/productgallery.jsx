// src/components/common/productgallery.jsx
import React, { useState } from "react";

export default function ProductGallery({ product }) {
  // Resolve real image array (strings or {url})
  let imagesArr = [];
  if (Array.isArray(product?.images?.data)) {
    imagesArr = product.images.data
      .map((img) => img?.attributes?.url || img?.url)
      .filter(Boolean);
  } else if (Array.isArray(product?.images)) {
    imagesArr = product.images
      .map((img) => (typeof img === "string" ? img : img?.url))
      .filter(Boolean);
  } else if (product?.image) {
    const url = typeof product.image === "string" ? product.image : product.image?.url;
    if (url) imagesArr = [url];
  }

  const [showModal, setShowModal] = useState(false);
  const [modalImg, setModalImg] = useState(imagesArr[0] || null);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
        {imagesArr.map((url, i) => (
          <img
            key={i}
            src={url}
            alt={`Product image ${i + 1}`}
            style={{
              width: 110,
              height: 110,
              objectFit: "cover",
              borderRadius: 13,
              boxShadow: "0 2px 12px #eee",
              cursor: "pointer",
            }}
            onClick={() => { setShowModal(true); setModalImg(url); }}
          />
        ))}
      </div>

      {/* Modal for zoom */}
      {showModal && modalImg && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
            background: "rgba(18,22,33,0.79)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 9999
          }}>
          <img
            src={modalImg}
            alt="Zoomed product"
            style={{
              maxWidth: "90vw", maxHeight: "90vh",
              borderRadius: 18, boxShadow: "0 8px 44px #0c234077"
            }}
          />
        </div>
      )}
    </div>
  );
}
