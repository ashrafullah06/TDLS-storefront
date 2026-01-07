import React, { useEffect, useState } from "react";

export default function Testimonials() {
  const [testimonials, setTestimonials] = useState([]);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_STRAPI_API_URL}/api/testimonials`)
      .then(res => res.json())
      .then(data => setTestimonials(data.data || []))
      .catch(() => setTestimonials([]));
  }, []);

  return (
    <div>
      {testimonials.map((t, i) => (
        <blockquote key={t.id || i}>
          {t.attributes?.quote} — {t.attributes?.name}
        </blockquote>
      ))}
    </div>
  );
}
