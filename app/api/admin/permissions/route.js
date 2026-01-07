// app/api/admin/permissions/route.js
import { NextResponse } from "next/server";
import { Permissions } from "@/lib/rbac";

/** Static permission catalogue from rbac.js for UI forms and policy UI */
export async function GET() {
  return NextResponse.json({
    ok: true,
    permissions: Object.keys(Permissions),
  });
}
