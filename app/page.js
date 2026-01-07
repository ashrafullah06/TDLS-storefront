export const revalidate = 60;
export const dynamic = "force-static";

import ClientHomepage from "@/components/homepage/homepage-client";
import { fetchHomepage } from "@/lib/fetchhomepage";

export default async function Page() {
  let homepage = {};
  let error = null;
  try {
    homepage = await fetchHomepage();
  } catch (e) {
    error = e?.message || "Failed to load homepage";
  }
  return <ClientHomepage homepage={homepage} error={error} />;
}
