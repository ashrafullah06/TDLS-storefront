// FILE: app/api/auth/providers/route.js
// Not strictly necessary (the catch-all already handles this),
// but you asked to create it; we delegate to the same NextAuth handler.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { handlers } from "@/lib/auth";

// NextAuth’s GET handler inspects the request URL and returns the providers JSON.
export const GET = handlers.GET;
