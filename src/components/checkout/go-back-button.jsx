"use client";
import { useRouter } from "next/navigation";

const NAVY = "#0B1C3F";

export default function GoBackButton({ label = "Back" }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex items-center gap-2 font-medium rounded-full px-4 h-10 bg-white border hover:shadow-md transition"
      style={{ color: NAVY, borderColor: "#E8ECF4" }}
      aria-label={label}
    >
      <span aria-hidden>←</span> {label}
    </button>
  );
}
