// components/common/crosscarousel.jsx
import React, { useMemo } from "react";
import { useOptions } from "@/providers/optionsprovider";
import ProductCard from "./productcard";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

/**
 * CrossCarousel – Show related, trending, or recommended products in a slick carousel.
 * Props:
 *   - title: Section heading (e.g. "You May Also Like", "Trending Now")
 *   - products: Optional array of product objects (if not provided, uses trending from context)
 *   - filter: Optional function to further filter products (e.g. by audience, tier, category)
 *   - max: Maximum items to show (default: 12)
 */
export default function CrossCarousel({
  title = "You May Also Like",
  products: overrideProducts,
  filter,
  max = 12,
}) {
  const { trending, bestSellers, products } = useOptions();

  // Choose products to show
  const items = useMemo(() => {
    let arr = [];
    if (overrideProducts && overrideProducts.length) {
      arr = overrideProducts;
    } else if (trending && trending.length) {
      arr = trending;
    } else if (bestSellers && bestSellers.length) {
      arr = bestSellers;
    } else if (products && products.length) {
      arr = products;
    }
    if (typeof filter === "function") arr = arr.filter(filter);
    // Remove duplicates (by id)
    arr = Array.from(new Map(arr.map(p => [p.id, p])).values());
    return arr.slice(0, max);
  }, [overrideProducts, trending, bestSellers, products, filter, max]);

  if (!items.length) return null;

  return (
    <section className="my-10">
      <h2 className="text-xl md:text-2xl font-bold mb-5 pl-2">{title}</h2>
      <Swiper
        spaceBetween={16}
        slidesPerView={1.2}
        breakpoints={{
          640: { slidesPerView: 2.1 },
          1024: { slidesPerView: 3.15 },
          1280: { slidesPerView: 4.2 },
        }}
        navigation
        className="w-full"
        style={{ paddingBottom: 24 }}
      >
        {items.map(product => (
          <SwiperSlide key={product.id} style={{ height: "auto" }}>
            <ProductCard product={product} className="mx-2" />
          </SwiperSlide>
        ))}
      </Swiper>
    </section>
  );
}
