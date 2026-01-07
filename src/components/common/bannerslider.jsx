import React, { useEffect, useState } from "react";

export default function BannerSlider() {
  const [banners, setBanners] = useState([]);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_STRAPI_API_URL}/api/banners?populate=*`)
      .then(res => res.json())
      .then(data => setBanners(data.data || []))
      .catch(() => setBanners([]));
  }, []);

  return (
    <div>
      {banners.map((b, i) => (
        <img
          key={b.id || i}
          src={b.attributes?.image?.data?.attributes?.url}
          alt={b.attributes?.title || ""}
        />
      ))}
    </div>
  );
}
