// FILE: app/api/customers/address-book/[id]/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/* ────────────────────────── helpers ────────────────────────── */

function getUserIdFromSession(session) {
  return session?.user?.id || session?.user?.uid || session?.user?.sub || null;
}

function strOrNull(v) {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[^\d+]/g, "");

  const bdLocal = /^01[3-9]\d{8}$/;
  const bdIntl = /^8801[3-9]\d{8}$/;
  const bdPlus = /^\+8801[3-9]\d{8}$/;

  if (bdPlus.test(s)) return s;
  if (bdIntl.test(s)) return `+${s}`;
  if (bdLocal.test(s)) return `+88${s}`;

  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.indexOf("+") > 0) s = s.replace(/\+/g, "");

  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    return null;
  }
  if (s.length >= 8 && s.length <= 15) return `+${s}`;
  return null;
}

/**
 * Next.js 15+ can supply dynamic route params as a Promise.
 * Always unwrap (await) before reading params.id.
 */
async function unwrapParams(params) {
  return params && typeof params.then === "function" ? await params : params;
}

/**
 * Accepts BOTH DB-shaped keys (line1/line2/city/state)
 * and UI-shaped keys (streetAddress/address2/upazila/district/division).
 * For PATCH, missing fields are preserved from `existing`.
 */
function pickInputAddress(raw = {}, existing = null) {
  const ex = existing || {};
  const g = (ex.granular && typeof ex.granular === "object") ? ex.granular : {};

  const line1 = strOrNull(
    raw.line1 ?? raw.address1 ?? raw.addressLine1 ?? raw.streetAddress ?? ex.line1 ?? g.streetAddress
  );
  const line2 = strOrNull(raw.line2 ?? raw.address2 ?? raw.addressLine2 ?? ex.line2 ?? g.address2);

  // In your BD mapping: upazila ≈ city (required), district ≈ state
  const upazila = strOrNull(raw.upazila ?? raw.city ?? raw.area ?? ex.adminLevel3 ?? ex.city ?? g.upazila);
  const district = strOrNull(raw.district ?? raw.state ?? raw.region ?? ex.adminLevel2 ?? ex.state ?? g.district);
  const division = strOrNull(raw.division ?? raw.adminLevel1 ?? ex.adminLevel1 ?? g.division);

  const postalCode = strOrNull(raw.postalCode ?? raw.postcode ?? raw.zip ?? ex.postalCode);
  const countryIso2 = String(raw.countryIso2 ?? raw.country ?? ex.countryIso2 ?? "BD")
    .toUpperCase()
    .trim();

  const name = strOrNull(raw.name ?? g.name);
  const phone = normalizePhone(raw.phone ?? ex.phone ?? g.phone) || null;
  const email = strOrNull(raw.email ?? g.email) ? String(raw.email ?? g.email).trim().toLowerCase() : null;
  const label = strOrNull(raw.label ?? ex.label ?? g.label);
  const notes = strOrNull(raw.notes ?? g.notes);

  const houseNo = strOrNull(raw.houseNo ?? ex.streetNumber ?? g.houseNo);
  const houseName = strOrNull(raw.houseName ?? ex.premise ?? g.houseName);
  const apartmentNo = strOrNull(raw.apartmentNo ?? g.apartmentNo);
  const floorNo = strOrNull(raw.floorNo ?? g.floorNo);

  const policeStation = strOrNull(raw.policeStation ?? raw.thana ?? ex.sublocality ?? g.policeStation);

  const makeDefault = !!(raw.makeDefault ?? raw.isDefault ?? raw.default ?? raw.primary);

  return {
    line1,
    line2,

    // DB required fields
    city: upazila,
    state: district,

    postalCode,
    countryIso2,

    // BD hierarchy fields
    upazila,
    district,
    division,

    // identity
    name,
    phone,
    email,
    label,
    notes,

    // granular extras
    houseNo,
    houseName,
    apartmentNo,
    floorNo,
    policeStation,

    makeDefault,
  };
}

function validateForWrite(picked) {
  if (!picked?.line1) return { ok: false, error: "LINE1_REQUIRED" };
  if (!picked?.city) return { ok: false, error: "UPAZILA_REQUIRED" }; // city in DB
  if (!picked?.countryIso2 || picked.countryIso2.length !== 2) {
    return { ok: false, error: "COUNTRY_ISO2_REQUIRED" };
  }
  return { ok: true };
}

function toPrismaAddressData(picked, existing = null) {
  const ex = existing || {};
  const g = (ex.granular && typeof ex.granular === "object") ? ex.granular : {};

  const subpremise =
    [picked.apartmentNo, picked.floorNo].filter(Boolean).join(", ") ||
    ex.subpremise ||
    null;

  return {
    // canonical mailing
    line1: String(picked.line1).trim(),
    line2: picked.line2 ? String(picked.line2).trim() : null,
    city: String(picked.city).trim(),
    state: picked.state ? String(picked.state).trim() : null,
    postalCode: picked.postalCode ? String(picked.postalCode).trim() : null,
    countryIso2: String(picked.countryIso2).toUpperCase().trim(),

    // columns
    phone: picked.phone,
    label: picked.label,

    // BD hierarchy
    adminLevel1: picked.division,
    adminLevel2: picked.district,
    adminLevel3: picked.upazila,

    // optional mapped fields
    premise: picked.houseName ?? ex.premise ?? null,
    streetNumber: picked.houseNo ?? ex.streetNumber ?? null,
    subpremise,
    sublocality: picked.policeStation ?? ex.sublocality ?? null,

    // preserve round-trip identity + UI aliases
    granular: {
      ...(g || {}),
      name: picked.name ?? g.name ?? null,
      phone: picked.phone ?? g.phone ?? null,
      email: picked.email ?? g.email ?? null,
      label: picked.label ?? g.label ?? null,
      notes: picked.notes ?? g.notes ?? null,

      houseNo: picked.houseNo ?? g.houseNo ?? null,
      houseName: picked.houseName ?? g.houseName ?? null,
      apartmentNo: picked.apartmentNo ?? g.apartmentNo ?? null,
      floorNo: picked.floorNo ?? g.floorNo ?? null,
      policeStation: picked.policeStation ?? g.policeStation ?? null,

      // UI-friendly aliases for future-proof clients
      streetAddress: picked.line1 ?? g.streetAddress ?? null,
      address2: picked.line2 ?? g.address2 ?? null,
      upazila: picked.upazila ?? g.upazila ?? null,
      district: picked.district ?? g.district ?? null,
      division: picked.division ?? g.division ?? null,
    },
  };
}

function normalizeAddressRow(a, defaultId) {
  if (!a) return null;
  const g = (a.granular && typeof a.granular === "object") ? a.granular : {};
  const isDefault = defaultId ? String(a.id) === String(defaultId) : !!a.isDefault;

  return {
    id: a.id,
    isDefault,

    // identity fields (top-level for UI)
    name: strOrNull(g.name),
    phone: normalizePhone(a.phone ?? g.phone) || null,
    email: strOrNull(g.email) ? String(g.email).trim().toLowerCase() : null,
    label: strOrNull(a.label ?? g.label),
    notes: strOrNull(g.notes),

    // UI-friendly canonical keys
    streetAddress: a.line1,
    address2: a.line2,
    upazila: a.adminLevel3 ?? a.city,
    district: a.adminLevel2 ?? a.state,
    division: a.adminLevel1 ?? null,
    postalCode: a.postalCode,
    countryIso2: a.countryIso2,

    // DB keys for compatibility
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,

    // optional
    houseName: a.premise ?? g.houseName ?? null,
    houseNo: a.streetNumber ?? g.houseNo ?? null,
    apartmentNo: g.apartmentNo ?? null,
    floorNo: g.floorNo ?? null,
    policeStation: a.sublocality ?? g.policeStation ?? null,

    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    archivedAt: a.archivedAt,

    granular: g,
  };
}

/**
 * Auto-heal default consistency between:
 * - User.defaultAddressId (canonical pointer)
 * - Address.isDefault (denormalized flag)
 */
async function loadListAndDefault(userId) {
  const [user, list] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { defaultAddressId: true },
    }),
    prisma.address.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const userDefaultId = user?.defaultAddressId || null;
  const hasUserDefault =
    userDefaultId && list.some((x) => String(x.id) === String(userDefaultId));

  let desiredDefaultId = null;

  if (hasUserDefault) {
    desiredDefaultId = userDefaultId;
  } else {
    const flagged = list.find((x) => !!x.isDefault);
    desiredDefaultId = flagged?.id || (list[0]?.id ?? null);
  }

  const desiredStr = desiredDefaultId ? String(desiredDefaultId) : null;
  const flaggedIds = list.filter((x) => !!x.isDefault).map((x) => String(x.id));

  const mismatch =
    String(userDefaultId || "") !== String(desiredDefaultId || "") ||
    (desiredStr
      ? !(flaggedIds.length === 1 && flaggedIds[0] === desiredStr)
      : flaggedIds.length > 0);

  if (mismatch) {
    await prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, archivedAt: null },
        data: { isDefault: false },
      });

      if (desiredDefaultId) {
        await tx.address.update({
          where: { id: desiredDefaultId },
          data: { isDefault: true },
        });
        await tx.user.update({
          where: { id: userId },
          data: { defaultAddressId: desiredDefaultId },
        });
      } else {
        await tx.user.update({
          where: { id: userId },
          data: { defaultAddressId: null },
        });
      }
    });

    // reload after heal
    const [u2, l2] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { defaultAddressId: true },
      }),
      prisma.address.findMany({
        where: { userId, archivedAt: null },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      }),
    ]);

    const defId2 = u2?.defaultAddressId || null;
    const addresses2 = l2.map((x) => normalizeAddressRow(x, defId2)).filter(Boolean);
    const def2 = addresses2.find((x) => x.isDefault) || addresses2[0] || null;

    return {
      addresses: addresses2,
      defaultId: def2?.id || null,
      defaultAddress: def2,
      data: addresses2,
    };
  }

  const addresses = list.map((x) => normalizeAddressRow(x, desiredDefaultId)).filter(Boolean);
  const def = addresses.find((x) => x.isDefault) || addresses[0] || null;

  return {
    addresses,
    defaultId: def?.id || null,
    defaultAddress: def,
    data: addresses,
  };
}

async function setDefaultAddress(userId, addressId) {
  await prisma.$transaction(async (tx) => {
    const target = await tx.address.findFirst({
      where: { id: addressId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!target) {
      const e = new Error("NOT_FOUND");
      e.code = "NOT_FOUND";
      throw e;
    }

    await tx.address.updateMany({
      where: { userId, archivedAt: null },
      data: { isDefault: false },
    });
    await tx.address.update({
      where: { id: addressId },
      data: { isDefault: true },
    });
    await tx.user.update({
      where: { id: userId },
      data: { defaultAddressId: addressId },
    });
  });
}

async function softDeleteAddress(userId, addressId) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({
      where: { id: addressId, userId, archivedAt: null },
      select: { id: true },
    });
    if (!existing) {
      const e = new Error("NOT_FOUND");
      e.code = "NOT_FOUND";
      throw e;
    }

    // Archive address
    await tx.address.update({
      where: { id: addressId },
      data: { archivedAt: new Date(), isDefault: false },
    });

    // If user pointer referenced it, select a new default
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { defaultAddressId: true },
    });

    if (user?.defaultAddressId && String(user.defaultAddressId) === String(addressId)) {
      const candidate = await tx.address.findFirst({
        where: { userId, archivedAt: null },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      });

      if (candidate) {
        await tx.address.updateMany({
          where: { userId, archivedAt: null },
          data: { isDefault: false },
        });
        await tx.address.update({
          where: { id: candidate.id },
          data: { isDefault: true },
        });
        await tx.user.update({
          where: { id: userId },
          data: { defaultAddressId: candidate.id },
        });
      } else {
        await tx.user.update({
          where: { id: userId },
          data: { defaultAddressId: null },
        });
      }
    }
  });
}

/* ────────────────────────── GET (single address) ────────────────────────── */

export async function GET(req, { params }) {
  try {
    const session = await auth();
    const userId = getUserIdFromSession(session);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const p = await unwrapParams(params);
    const id = p?.id ? String(p.id) : null;

    if (!id) {
      return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
    }

    const [user, addr] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { defaultAddressId: true },
      }),
      prisma.address.findFirst({
        where: { id, userId, archivedAt: null },
      }),
    ]);

    if (!addr) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    const defId = user?.defaultAddressId || null;
    return NextResponse.json(
      { ok: true, data: normalizeAddressRow(addr, defId) },
      { status: 200 }
    );
  } catch (err) {
    console.error("Address-book [id] GET error", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/* ────────────────────────── PUT / PATCH (update + optional makeDefault) ────────────────────────── */

async function handleUpdate(req, { params }) {
  const session = await auth();
  const userId = getUserIdFromSession(session);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const p = await unwrapParams(params);
  const id = p?.id ? String(p.id) : null;

  if (!id) {
    return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
  }

  const existing = await prisma.address.findFirst({
    where: { id, userId, archivedAt: null },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const makeDefault = !!(body?.makeDefault ?? body?.isDefault ?? body?.default ?? body?.primary);

  // If this is a default-only operation (no address fields), just set default
  const hasAnyAddressFields =
    body?.line1 ||
    body?.streetAddress ||
    body?.address1 ||
    body?.addressLine1 ||
    body?.line2 ||
    body?.address2 ||
    body?.city ||
    body?.upazila ||
    body?.district ||
    body?.division ||
    body?.postalCode ||
    body?.countryIso2 ||
    body?.phone ||
    body?.label ||
    body?.notes ||
    body?.houseNo ||
    body?.houseName ||
    body?.apartmentNo ||
    body?.floorNo ||
    body?.policeStation ||
    body?.thana;

  if (makeDefault && !hasAnyAddressFields) {
    await setDefaultAddress(userId, id);
    const loaded = await loadListAndDefault(userId);
    return NextResponse.json(
      {
        ok: true,
        message: "Default address updated.",
        addresses: loaded.addresses,
        defaultAddress: loaded.defaultAddress,
        defaultId: loaded.defaultId,
        data: loaded.addresses,
      },
      { status: 200 }
    );
  }

  // Merge payload with existing for PATCH-like behavior
  const picked = pickInputAddress(body, existing);
  const v = validateForWrite(picked);
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  }

  const data = toPrismaAddressData(picked, existing);

  await prisma.address.update({
    where: { id },
    data,
  });

  if (makeDefault) {
    await setDefaultAddress(userId, id);
  }

  const loaded = await loadListAndDefault(userId);
  const updated = loaded.addresses.find((x) => String(x.id) === String(id)) || null;

  return NextResponse.json(
    {
      ok: true,
      message: "Address updated.",
      address: updated,
      addresses: loaded.addresses,
      defaultAddress: loaded.defaultAddress,
      defaultId: loaded.defaultId,
      data: loaded.addresses,
    },
    { status: 200 }
  );
}

export async function PUT(req, ctx) {
  try {
    return await handleUpdate(req, ctx);
  } catch (err) {
    console.error("Address-book [id] PUT error", err);
    if (err && (err.code === "NOT_FOUND" || err.message === "NOT_FOUND")) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PATCH(req, ctx) {
  try {
    return await handleUpdate(req, ctx);
  } catch (err) {
    console.error("Address-book [id] PATCH error", err);
    if (err && (err.code === "NOT_FOUND" || err.message === "NOT_FOUND")) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/* ────────────────────────── DELETE (soft delete; no OTP) ────────────────────────── */

export async function DELETE(req, { params }) {
  try {
    const session = await auth();
    const userId = getUserIdFromSession(session);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const p = await unwrapParams(params);
    const id = p?.id ? String(p.id) : null;

    if (!id) {
      return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
    }

    // Ensure it exists and belongs to user
    const existing = await prisma.address.findFirst({
      where: { id, userId, archivedAt: null },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    await softDeleteAddress(userId, id);

    const loaded = await loadListAndDefault(userId);

    return NextResponse.json(
      {
        ok: true,
        message: "Address deleted.",
        addresses: loaded.addresses,
        defaultAddress: loaded.defaultAddress,
        defaultId: loaded.defaultId,
        data: loaded.addresses,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Address-book [id] DELETE error", err);
    if (err && (err.code === "NOT_FOUND" || err.message === "NOT_FOUND")) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR_ADDRESS_DELETE" },
      { status: 500 }
    );
  }
}
