import { fetchStrapi } from "./strapifetch";

export async function fetchtags() {
  const res = await fetchStrapi("/tags?populate=*");
  if (!res?.data) throw new Error("No tags found");
  return res.data.map(item => ({ id: item.id, ...item.attributes }));
}
