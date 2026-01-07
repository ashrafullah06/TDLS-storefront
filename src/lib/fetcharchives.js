import { fetchStrapi } from "./strapifetch";

export async function fetcharchives() {
  const res = await fetchStrapi("/archive-records?populate=*");
  if (!res?.data) throw new Error("No archive records found");
  return res.data.map(item => ({ id: item.id, ...item.attributes }));
}
