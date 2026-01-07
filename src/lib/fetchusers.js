import { fetchStrapi } from "./strapifetch";

export async function fetchusers() {
  const res = await fetchStrapi("/users?populate=*&pagination[pageSize]=100");
  if (!res?.length) throw new Error("No users found");
  return res.map(user => ({ id: user.id, ...user }));
}
