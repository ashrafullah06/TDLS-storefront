import { getStrapiApiUrl } from "./strapimedia";

export async function fetchorders(userid, token) {
  const res = await fetch(`${getStrapiApiUrl(`/orders?filters[user][id][$eq]=${userid}&populate=*`)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to fetch user orders");
  const json = await res.json();
  return json.data.map(item => ({ id: item.id, ...item.attributes }));
}

export async function createorder(payload, token) {
  const res = await fetch(getStrapiApiUrl("/orders"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ data: payload }),
  });
  if (!res.ok) throw new Error("Failed to create order");
  return await res.json();
}
