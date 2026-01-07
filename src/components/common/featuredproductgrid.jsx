import React, { useEffect, useState } from "react";
export default function FeaturedProductGrid() {
  const [products, setProducts] = useState([]);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_STRAPI_API_URL}/products?filters[featured][$eq]=true&populate=*`)
      .then(res => res.json())
      .then(json => setProducts(json.data?.map(p => p.attributes) || []));
  }, []);
  return <div>{products.map((p, i) => <div key={i}>{p.name}</div>)}</div>;
}