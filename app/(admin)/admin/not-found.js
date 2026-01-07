// FILE: app/(admin)/admin/not-found.js
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="w-full flex flex-col justify-center items-center pt-40 pb-32 min-h-[60vh]">
      <h1 className="text-4xl font-bold mb-4">Admin Page Not Found</h1>
      <p className="text-lg text-neutral-700 mb-8">
        This admin page doesn’t exist or is temporarily unavailable.
      </p>

      <div className="flex gap-3 flex-wrap justify-center">
        <Link href="/admin" className="px-5 py-2 rounded border">
          Back to Admin
        </Link>

        <Link href="/" className="px-5 py-2 rounded border">
          Storefront Home
        </Link>
      </div>
    </div>
  );
}
