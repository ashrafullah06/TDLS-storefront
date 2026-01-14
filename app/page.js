// FILE: app/page.js
export const revalidate = 60;

import ClientHomepage from "@/components/homepage/homepage-client";
import BottomFloatingBarShell from "@/components/common/bottomfloatingbar.shell.server";
import { fetchHomepage } from "@/lib/fetchhomepage";

export default async function Page() {
  let homepage = {};
  let error = null;

  try {
    homepage = await fetchHomepage();
  } catch (e) {
    error = e?.message || "Failed to load homepage";
  }

  return (
    <>
      <ClientHomepage homepage={homepage} error={error} />
      <BottomFloatingBarShell />
    </>
  );
}
