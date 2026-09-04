// app/search/page.jsx

import SearchClient from "./search_client";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}) {
  const sp =
    await Promise.resolve(
      searchParams
    );

  const raw = sp?.q;

  const q = (
    Array.isArray(raw)
      ? raw[0]
      : raw || ""
  )
    .toString()
    .trim();

  return (
    <SearchClient
      initialQuery={q}
    />
  );
}