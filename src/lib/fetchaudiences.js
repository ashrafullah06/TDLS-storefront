import { fetchStrapi } from "./strapifetch";

export async function fetchaudiences() {
  const res = await fetchStrapi("/audience-categories?populate=*");
  if (!res?.data) throw new Error("No audience categories found");
  return res.data.map(item => ({ id: item.id, ...item.attributes }));
}
