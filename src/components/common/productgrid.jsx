"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ProductCard from "./productcard";
import styles from "./productgrid.module.css";

export default function ProductGrid({ items = [], pageSize = 24, className = "" }) {
  const [visible, setVisible] = useState(pageSize);
  const sentry = useRef(null);

  const slice = useMemo(() => items.slice(0, visible), [items, visible]);
  useEffect(() => setVisible(pageSize), [items, pageSize]);

  useEffect(() => {
    if (!sentry.current) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) setVisible((v) => Math.min(items.length, v + pageSize));
    }, { rootMargin: "1000px 0px" });
    io.observe(sentry.current);
    return () => io.disconnect();
  }, [items.length, pageSize]);

  return (
    <div className={`${styles.container} ${className}`}>
      <div className={styles.grid}>
        {slice.map((p) => (
          <ProductCard key={p.id || p.slug} product={p} />
        ))}
      </div>
      {visible < items.length && <div ref={sentry} className={styles.sentinel} />}
    </div>
  );
}
