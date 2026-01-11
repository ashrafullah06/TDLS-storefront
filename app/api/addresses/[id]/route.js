// FILE: my-project/app/api/addresses/[id]/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

import { NextResponse } from "next/server";

/* ---------------- lazy imports (avoid build-time crashes) ---------------- */
let _prisma;
async function getPrisma() {
  if (_prisma) return _prisma;
  const mod = await import("@/lib/prisma");
  _prisma = mod.default || mod.prisma;
  return _prisma;
}

let _auth;
async function getAuth() {
  if (_auth) return _auth;
  const mod = await import("@/lib/auth");
  _auth = mod.auth;
  return _auth;
}

/* ---------------- helpers ---------------- */
function j(body, status = 200) {
  return NextResponse.json(body ?? null, { status });
}

function pickAddressPayload(input = {}) {
  // Allow only whitelisted fields to update
  const {
    line1, line2, city, state, postalCode, countryIso2,
    phone, label, isDefault, type,
    adminLevel1, adminLevel2, adminLevel3, adminLevel4,
    locality, sublocality, route, premise, subpremise,
    streetNumber, neighborhood, lat, lng, geohash, placeId,
    geoAccuracy, granular,
  } = input || {};
  return {
    ...(line1 != null ? { line1: String(line1) } : {}),
    ...(line2 != null ? { line2: String(line2) } : {}),
    ...(city != null ? { city: String(city) } : {}),
    ...(state != null ? { state: String(state) } : {}),
    ...(postalCode != null ? { postalCode: String(postalCode) } : {}),
    ...(countryIso2 != null ? { countryIso2: String(countryIso2).toUpperCase() } : {}),
    ...(phone != null ? { phone: String(phone) } : {}),
    ...(label != null ? { label: String(label) } : {}),
    ...(typeof isDefault === "boolean" ? { isDefault } : {}),
    ...(type != null ? { type } : {}),
    ...(adminLevel1 != null ? { adminLevel1: String(adminLevel1) } : {}),
    ...(adminLevel2 != null ? { adminLevel2: String(adminLevel2) } : {}),
    ...(adminLevel3 != null ? { adminLevel3: String(adminLevel3) } : {}),
    ...(adminLevel4 != null ? { adminLevel4: String(adminLevel4) } : {}),
    ...(locality != null ? { locality: String(locality) } : {}),
    ...(sublocality != null ? { sublocality: String(sublocality) } : {}),
    ...(route != null ? { route: String(route) } : {}),
    ...(premise != null ? { premise: String(premise) } : {}),
    ...(subpremise != null ? { subpremise: String(subpremise) } : {}),
    ...(streetNumber != null ? { streetNumber: String(streetNumber) } : {}),
    ...(neighborhood != null ? { neighborhood: String(neighborhood) } : {}),
    ...(lat != null ? { lat: Number(lat) } : {}),
    ...(lng != null ? { lng: Number(lng) } : {}),
    ...(geohash != null ? { geohash: String(geohash) } : {}),
    ...(placeId != null ? { placeId: String(placeId) } : {}),
    ...(geoAccuracy != null ? { geoAccuracy: String(geoAccuracy) } : {}),
    ...(granular != null ? { granular } : {}),
  };
}

async function requireRecentOtp(prisma, userId, purpose, windowMinutes = 10) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const ok = await prisma.otpCode.findFirst({
    where: {
      userId,
      purpose,
      consumedAt: { not: null, gt: since },
    },
    select: { id: true },
  });
  return !!ok;
}

/* ---------------- GET (read single) ---------------- */
export async function GET(_req, { params }) {
  const auth = await getAuth();
  const prisma = await getPrisma();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return j({ error: "UNAUTHORIZED" }, 401);

  const id = String(params?.id || "");
  const addr = await prisma.address.findFirst({
    where: { id, userId, archivedAt: null },
  });

  if (!addr) return j({ error: "NOT_FOUND" }, 404);
  return j(addr, 200);
}

/* ---------------- PUT (update) ---------------- */
export async function PUT(req, { params }) {
  const auth = await getAuth();
  const prisma = await getPrisma();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return j({ error: "UNAUTHORIZED" }, 401);

  const id = String(params?.id || "");
  const body = await req.json().catch(() => ({}));
  const payload = pickAddressPayload(body);

  // Ensure address exists & belongs to user
  const existing = await prisma.address.findFirst({ where: { id, userId, archivedAt: null } });
  if (!existing) return j({ error: "NOT_FOUND" }, 404);

  // If any field (incl. phone) is changing, require a recent OTP for address_update
  const otpOk = await requireRecentOtp(prisma, userId, "address_update");
  if (!otpOk) return j({ error: "OTP_REQUIRED", purpose: "address_update" }, 403);

  // If phone changes, drop its verification marker
  let phoneVerifiedPatch = {};
  if (payload.phone != null && payload.phone !== existing.phone) {
    phoneVerifiedPatch = { phoneVerifiedAt: null };
  }

  // Update + version log inside transaction
  const updated = await prisma.$transaction(async (tx) => {
    // Write the update
    const next = await tx.address.update({
      where: { id },
      data: { ...payload, ...phoneVerifiedPatch },
    });

    // Version trail
    await tx.addressVersion.create({
      data: {
        addressId: id,
        userId,
        payload: { before: existing, after: next },
        reason: "update",
      },
    });

    // Handle default flips
    if (payload.isDefault === true) {
      // Make this default for user; clear others
      await tx.address.updateMany({
        where: { userId, id: { not: id } },
        data: { isDefault: false },
      });
      await tx.user.update({
        where: { id: userId },
        data: { defaultAddressId: id },
      });
    } else if (payload.isDefault === false && existing.isDefault) {
      // If turning off default on the same address, also clear user's default pointer
      await tx.user.updateMany({
        where: { id: userId, defaultAddressId: id },
        data: { defaultAddressId: null },
      });
    }

    return next;
  });

  return j(updated, 200);
}

/* ---------------- DELETE (soft-delete) ---------------- */
export async function DELETE(_req, { params }) {
  const auth = await getAuth();
  const prisma = await getPrisma();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return j({ error: "UNAUTHORIZED" }, 401);

  const id = String(params?.id || "");
  const existing = await prisma.address.findFirst({ where: { id, userId, archivedAt: null } });
  if (!existing) return j({ error: "NOT_FOUND" }, 404);

  // Require OTP for deletion
  const otpOk = await requireRecentOtp(prisma, userId, "address_delete");
  if (!otpOk) return j({ error: "OTP_REQUIRED", purpose: "address_delete" }, 403);

  await prisma.$transaction(async (tx) => {
    // Soft delete
    await tx.address.update({
      where: { id },
      data: { archivedAt: new Date(), isDefault: false },
    });

    // Clear default pointer if it pointed here
    await tx.user.updateMany({
      where: { id: userId, defaultAddressId: id },
      data: { defaultAddressId: null },
    });

    // Version entry
    await tx.addressVersion.create({
      data: {
        addressId: id,
        userId,
        payload: { deletedAt: new Date(), addressId: id },
        reason: "delete",
      },
    });
  });

  return j({ ok: true }, 200);
}
