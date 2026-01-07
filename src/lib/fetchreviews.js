import { getStrapiApiUrl } from "./strapimedia";

export async function fetchreviews(productid) {
  const url = getStrapiApiUrl(`/reviews?filters[product][id][$eq]=${productid}&populate=user`);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch reviews");
  const json = await res.json();
  return json.data.map(item => ({ id: item.id, ...item.attributes }));
}

export async function createreview(payload, token) {
  const res = await fetch(getStrapiApiUrl("/reviews"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: payload }),
  });
  if (!res.ok) throw new Error("Failed to post review");
  return await res.json();
}
