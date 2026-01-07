// app/search/page.jsx
import Link from "next/link";
import { api as strapiApi } from "@/lib/strapi";

export const dynamic = "force-dynamic";

async function fetchResults(q) {
  if (!q) return [];
  const common = new URLSearchParams();
  common.set("populate", "images");               // safe populate
  common.set("pagination[page]", "1");
  common.set("pagination[pageSize]", "48");

  // First attempt: include relations (if they exist in your schema)
  const p1 = new URLSearchParams(common);
  p1.set("filters[$or][0][name][$containsi]", q);
  p1.set("filters[$or][1][short_description][$containsi]", q);
  p1.set("filters[$or][2][slug][$containsi]", q);
  p1.set("filters[$or][3][tags][name][$containsi]", q);
  p1.set("filters[$or][4][category][name][$containsi]", q);
  p1.set("filters[$or][5][brand_tier][name][$containsi]", q);

  try {
    const data = await strapiApi(`/api/products?${p1.toString()}`, { cache: "no-store" });
    return Array.isArray(data?.data) ? data.data : [];
  } catch {
    // Fallback: only safe fields (name/short_description/slug)
    const p2 = new URLSearchParams(common);
    p2.set("filters[$or][0][name][$containsi]", q);
    p2.set("filters[$or][1][short_description][$containsi]", q);
    p2.set("filters[$or][2][slug][$containsi]", q);
    const data = await strapiApi(`/api/products?${p2.toString()}`, { cache: "no-store" });
    return Array.isArray(data?.data) ? data.data : [];
  }
}

export default async function Page({ searchParams }) {
  const q = (searchParams?.q || "").toString().trim();
  const results = await fetchResults(q);

  return (
    <main className="min-h-screen px-6 md:px-12 lg:px-16 pt-28 pb-16 bg-[#FFFDF8]">
      <h1 className="text-2xl md:text-3xl font-bold tracking-wide text-[#0c2340]">
        Search results{q ? ` for “${q}”` : ""}
      </h1>

      {!q && <p className="mt-3 text-gray-600">Type something in the search bar.</p>}
      {q && results.length === 0 && (
        <p className="mt-6 text-gray-600">No products matched. Try another term.</p>
      )}

      {results.length > 0 && (
        <ul className="mt-8 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-6">
          {results.map((item) => {
            const a = item.attributes || {};
            const slug = a.slug;
            return (
              <li key={item.id} className="group border rounded-xl bg-white p-4 hover:shadow-lg transition">
                <Link href={`/product/${slug || ""}`} className="block">
                  <div className="aspect-[4/3] w-full bg-gray-100 rounded-lg overflow-hidden mb-3" />
                  <div className="text-[#0c2340] font-semibold line-clamp-2">{a.name || "Untitled"}</div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
