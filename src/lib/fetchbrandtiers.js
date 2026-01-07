import { fetchStrapi } from "./strapifetch";

export async function fetchbrandtiers() {
  const res = await fetchStrapi("/brand-tiers?populate=*");
  if (!res?.data) throw new Error("No brand tiers found");
  return res.data.map(item => ({ id: item.id, ...item.attributes }));
}
