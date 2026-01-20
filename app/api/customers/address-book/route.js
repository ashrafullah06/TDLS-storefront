// FILE: app/api/customers/address-book/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";

/* ────────────────────────── utilities ────────────────────────── */

function getUserIdFromSession(session) {
  return (
    session?.user?.id ||
    session?.user?.uid ||
    session?.user?.sub ||
    null
  );
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

function strOrNull(v) {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

/**
 * Accepts BOTH:
 * - DB-shaped keys: line1/line2/city/state
 * - UI-shaped keys: streetAddress/address2/upazila/district/division
 */
function pickInputAddress(raw = {}) {
  const a = raw || {};

  const line1 = strOrNull(
    a.line1 ?? a.address1 ?? a.streetAddress ?? a.street_address
  );
  const line2 = strOrNull(a.line2 ?? a.address2 ?? a.address_2);

  // Bangladesh naming: upazila ≈ city, district ≈ state (in your schema usage)
  const upazila = strOrNull(a.upazila ?? a.city ?? a.area);
  const district = strOrNull(a.district ?? a.state ?? a.region);
  const division = strOrNull(a.division ?? a.adminLevel1);

  const postalCode = strOrNull(a.postalCode ?? a.postcode ?? a.zip);
  const countryIso2 = String(a.countryIso2 ?? a.country ?? "BD")
    .toUpperCase()
    .trim();

  const phone = normalizePhone(a.phone) || null;
  const email = strOrNull(a.email) ? String(a.email).trim().toLowerCase() : null;
  const name = strOrNull(a.name);
  const label = strOrNull(a.label);

  const notes = strOrNull(a.notes);

  // Optional granular UI fields
  const houseNo = strOrNull(a.houseNo);
  const houseName = strOrNull(a.houseName);
  const apartmentNo = strOrNull(a.apartmentNo);
  const floorNo = strOrNull(a.floorNo);

  const village = strOrNull(a.village);
  const postOffice = strOrNull(a.postOffice);
  const union = strOrNull(a.union);
  const policeStation = strOrNull(a.policeStation ?? a.thana);

  const makeDefault = !!(a.makeDefault ?? a.isDefault ?? a.default ?? a.primary);

  return {
    // Canonical mailing
    line1,
    line2,
    city: upazila,   // required by schema
    state: district, // optional by schema but treated important in BD

    postalCode,
    countryIso2,

    // Columns
    phone,
    label,

    // UI-friendly region naming
    upazila,
    district,
    division,

    // Optional / identity
    name,
    email,
    notes,

    // Optional granular
    houseNo,
    houseName,
    apartmentNo,
    floorNo,
    village,
    postOffice,
    union,
    policeStation,

    // Derived
    makeDefault,
  };
}

/**
 * Validates required Prisma fields: Address.line1, Address.city, Address.countryIso2
 * Returns { ok, error } instead of throwing to keep responses clean.
 */
function validateForWrite(picked) {
  if (!picked?.line1) return { ok: false, error: "LINE1_REQUIRED" };
  if (!picked?.city) return { ok: false, error: "UPAZILA_REQUIRED" }; // city in DB
  if (!picked?.countryIso2 || picked.countryIso2.length !== 2) {
    return { ok: false, error: "COUNTRY_ISO2_REQUIRED" };
  }
  return { ok: true };
}

/**
 * Maps UI payload → Prisma Address update/create object.
 * Keeps a rich "granular" record so UI can round-trip fields reliably.
 */
function toPrismaAddressData(picked, existing = null) {
  const ex = existing || {};
  const g = (ex.granular && typeof ex.granular === "object") ? ex.granular : {};

  const houseBits = [picked.apartmentNo, picked.floorNo].filter(Boolean).join(", ") || null;

  return {
    // required + canonical mailing
    line1: String(picked.line1).trim(),
    line2: picked.line2 ? String(picked.line2).trim() : null,
    city: String(picked.city).trim(),
    state: picked.state ? String(picked.state).trim() : null,
    postalCode: picked.postalCode ? String(picked.postalCode).trim() : null,
    countryIso2: String(picked.countryIso2).toUpperCase().trim(),

    // columns
    phone: picked.phone,
    label: picked.label,

    // geo-ish fields that you already use for BD hierarchy
    adminLevel1: picked.division,
    adminLevel2: picked.district,
    adminLevel3: picked.upazila,

    // optional mapping to existing schema fields
    premise: picked.houseName ?? ex.premise ?? null,
    streetNumber: picked.houseNo ?? ex.streetNumber ?? null,
    subpremise: houseBits ?? ex.subpremise ?? null,
    sublocality: picked.policeStation ?? ex.sublocality ?? null,

    // keep UI fields + identity in granular for perfect round-trip
    granular: {
      ...(g || {}),
      name: picked.name ?? g.name ?? null,
      email: picked.email ?? g.email ?? null,
      notes: picked.notes ?? g.notes ?? null,

      houseNo: picked.houseNo ?? g.houseNo ?? null,
      houseName: picked.houseName ?? g.houseName ?? null,
      apartmentNo: picked.apartmentNo ?? g.apartmentNo ?? null,
      floorNo: picked.floorNo ?? g.floorNo ?? null,

      village: picked.village ?? g.village ?? null,
      postOffice: picked.postOffice ?? g.postOffice ?? null,
      union: picked.union ?? g.union ?? null,
      policeStation: picked.policeStation ?? g.policeStation ?? null,

      // store UI alias keys too (harmless, prevents future client drift)
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

    // UI-friendly canonical keys
    name: strOrNull(g.name),
    phone: normalizePhone(a.phone ?? g.phone) || null,
    email: strOrNull(g.email) ? String(g.email).trim().toLowerCase() : null,
    label: strOrNull(a.label ?? g.label),
    notes: strOrNull(g.notes),

    streetAddress: a.line1,
    address2: a.line2,
    upazila: a.adminLevel3 ?? a.city,
    district: a.adminLevel2 ?? a.state,
    division: a.adminLevel1 ?? null,
    postalCode: a.postalCode,
    countryIso2: a.countryIso2,

    // also return DB keys for compatibility
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,

    // optional extras
    houseName: a.premise ?? g.houseName ?? null,
    houseNo: a.streetNumber ?? g.houseNo ?? null,
    apartmentNo: g.apartmentNo ?? null,
    floorNo: g.floorNo ?? null,

    village: g.village ?? null,
    postOffice: g.postOffice ?? null,
    union: g.union ?? null,
    policeStation: a.sublocality ?? g.policeStation ?? null,

    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    archivedAt: a.archivedAt,

    granular: g,
  };
}

/**
 * Ensures consistency between:
 * - User.defaultAddressId (canonical pointer)
 * - Address.isDefault (denormalized flag)
 *
 * Auto-heals only if mismatch is detected.
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
  const hasUserDefault = userDefaultId && list.some((x) => String(x.id) === String(userDefaultId));

  // determine desired default
  let desiredDefaultId = null;

  if (hasUserDefault) {
    desiredDefaultId = userDefaultId;
  } else {
    const flagged = list.filter((x) => !!x.isDefault);
    if (flagged.length > 0) {
      desiredDefaultId = flagged[0].id;
    } else if (list.length > 0) {
      desiredDefaultId = list[0].id;
    } else {
      desiredDefaultId = null;
    }
  }

  // detect mismatch
  const defaultsFlagged = list.filter((x) => !!x.isDefault).map((x) => String(x.id));
  const desiredStr = desiredDefaultId ? String(desiredDefaultId) : null;

  const mismatch =
    (String(userDefaultId || "") !== String(desiredDefaultId || "")) ||
    (desiredStr
      ? !(defaultsFlagged.length === 1 && defaultsFlagged[0] === desiredStr)
      : defaultsFlagged.length > 0);

  if (mismatch) {
    // heal in a transaction
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

    // re-load after heal
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
    const normalized2 = l2.map((x) => normalizeAddressRow(x, defId2)).filter(Boolean);
    const def2 = normalized2.find((x) => x.isDefault) || normalized2[0] || null;

    return {
      addresses: normalized2,
      defaultId: def2?.id || null,
      defaultAddress: def2,
      data: normalized2, // legacy alias
    };
  }

  const normalized = list.map((x) => normalizeAddressRow(x, desiredDefaultId)).filter(Boolean);
  const def = normalized.find((x) => x.isDefault) || normalized[0] || null;

  return {
    addresses: normalized,
    defaultId: def?.id || null,
    defaultAddress: def,
    data: normalized, // legacy alias
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

async function softDeleteAddress(userId, id) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({
      where: { id, userId, archivedAt: null },
      select: { id: true, isDefault: true },
    });

    if (!existing) {
      const e = new Error("NOT_FOUND");
      e.code = "NOT_FOUND";
      throw e;
    }

    // archive
    await tx.address.update({
      where: { id },
      data: { archivedAt: new Date(), isDefault: false },
    });

    // if deleted was default, choose new default
    if (existing.isDefault) {
      const candidate = await tx.address.findFirst({
        where: { userId, archivedAt: null },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      });

      if (candidate) {
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
    } else {
      // if not default, keep user pointer as-is
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { defaultAddressId: true },
      });
      // if pointer referenced this id (mismatch case), clear it and heal on next read
      if (u?.defaultAddressId && String(u.defaultAddressId) === String(id)) {
        await tx.user.update({
          where: { id: userId },
          data: { defaultAddressId: null },
        });
      }
    }
  });
}

/* ────────────────────────── GET ──────────────────────────
   - GET /api/customers/address-book          -> list + default
   - GET /api/customers/address-book?default=1 -> default only (optional convenience)
*/
export async function GET(req) {
  try {
    const session = await auth();
    const userId = getUserIdFromSession(session);

    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const onlyDefault = searchParams.get("default");

    const loaded = await loadListAndDefault(userId);

    if (onlyDefault) {
      return NextResponse.json({ ok: true, data: loaded.defaultAddress }, { status: 200 });
    }

    return NextResponse.json(
      {
        ok: true,
        data: loaded.addresses, // legacy alias for older clients
        addresses: loaded.addresses,
        defaultAddress: loaded.defaultAddress,
        defaultId: loaded.defaultId,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Address-book GET error", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/* ────────────────────────── POST ──────────────────────────
   Single source of truth for:
   - create: { ...fields }
   - update (compat): { id, ...fields }
   - set default: { id, makeDefault: true } (no other fields needed)
*/
export async function POST(req) {
  try {
    const session = await auth();
    const userId = getUserIdFromSession(session);

    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = body?.id ? String(body.id) : null;

    // default-only operation
    const makeDefault = !!(body?.makeDefault ?? body?.isDefault ?? body?.default ?? body?.primary);
    const hasAnyAddressFields =
      body?.line1 ||
      body?.streetAddress ||
      body?.address1 ||
      body?.city ||
      body?.upazila ||
      body?.district ||
      body?.division ||
      body?.postalCode ||
      body?.phone ||
      body?.label ||
      body?.notes;

    if (id && makeDefault && !hasAnyAddressFields) {
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

    const picked = pickInputAddress(body);

    const v = validateForWrite(picked);
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
    }

    let saved = null;

    if (id) {
      const existing = await prisma.address.findFirst({
        where: { id, userId, archivedAt: null },
      });
      if (!existing) {
        return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }

      const data = toPrismaAddressData(picked, existing);

      saved = await prisma.address.update({
        where: { id },
        data,
      });
    } else {
      // create
      const data = toPrismaAddressData(picked, null);

      // auto-default if this is first address OR makeDefault was requested
      const existingCount = await prisma.address.count({
        where: { userId, archivedAt: null },
      });
      const shouldDefault = makeDefault || existingCount === 0;

      saved = await prisma.address.create({
        data: {
          ...data,
          userId,
          archivedAt: null,
          isDefault: false, // set below transactionally if needed
        },
      });

      if (shouldDefault) {
        await setDefaultAddress(userId, saved.id);
      }
    }

    // If makeDefault requested on update
    if (id && makeDefault) {
      await setDefaultAddress(userId, saved.id);
    }

    const loaded = await loadListAndDefault(userId);

    return NextResponse.json(
      {
        ok: true,
        message: id ? "Address updated." : "Address saved.",
        address: loaded.addresses.find((x) => String(x.id) === String(saved.id)) || null,
        addresses: loaded.addresses,
        defaultAddress: loaded.defaultAddress,
        defaultId: loaded.defaultId,
        data: loaded.addresses,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Address-book POST error", err);
    if (err && (err.code === "NOT_FOUND" || err.message === "NOT_FOUND")) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/* ────────────────────────── PUT (compat) ──────────────────────────
   Optional: allows clients to call PUT /api/customers/address-book with { id, ...fields }.
   This is useful if you want to remove reliance on /address-book/[id].
*/
export async function PUT(req) {
  try {
    const session = await auth();
    const userId = getUserIdFromSession(session);

    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = body?.id ? String(body.id) : null;
    if (!id) {
      return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
    }

    // Reuse POST logic by calling it internally is not possible cleanly; implement directly.
    const makeDefault = !!(body?.makeDefault ?? body?.isDefault ?? body?.default ?? body?.primary);

    const picked = pickInputAddress(body);
    const v = validateForWrite(picked);
    if (!v.ok) {
      return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
    }

    const existing = await prisma.address.findFirst({
      where: { id, userId, archivedAt: null },
    });
    if (!existing) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
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

    return NextResponse.json(
      {
        ok: true,
        message: "Address updated.",
        address: loaded.addresses.find((x) => String(x.id) === String(id)) || null,
        addresses: loaded.addresses,
        defaultAddress: loaded.defaultAddress,
        defaultId: loaded.defaultId,
        data: loaded.addresses,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Address-book PUT error", err);
    if (err && (err.code === "NOT_FOUND" || err.message === "NOT_FOUND")) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/* ────────────────────────── DELETE (compat — body.id) ──────────────────────────
   Prefer /api/customers/address-book/[id] for REST, but this keeps old callers working.
*/
export async function DELETE(req) {
  try {
    const session = await auth();
    const userId = getUserIdFromSession(session);

    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = body?.id ? String(body.id) : null;

    if (!id) {
      return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
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
    console.error("Address-book DELETE error", err);
    if (err && (err.code === "NOT_FOUND" || err.message === "NOT_FOUND")) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
