// FILE: app/api/customers/address-book/[id]/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import crypto from "crypto";

/* ────────────────────────── shared utils (mirrors root route) ────────────────────────── */

function isEmail(v) {
  return /\S+@\S+\.\S+/.test(String(v || "").trim());
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

function detectIdentifier(raw) {
  const val = String(raw || "").trim();
  if (!val) return { type: null };
  if (isEmail(val)) return { type: "email", email: val.toLowerCase() };
  const phone = normalizePhone(val);
  if (phone) return { type: "phone", phone };
  return { type: null };
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const OTP_SECRET = requireEnv("OTP_SECRET");

function hmacFor(userId, purpose, code) {
  return crypto
    .createHmac("sha256", OTP_SECRET)
    .update(`${userId}:${purpose}:${code}`)
    .digest("hex");
}

const PURPOSES = {
  CREATE: "address_create",
  UPDATE: "address_update",
  DELETE: "address_delete",
};

const ADDRESS_MUTATION_PURPOSES = new Set([
  PURPOSES.CREATE,
  PURPOSES.UPDATE,
  PURPOSES.DELETE,
]);

/**
 * FIX: Next.js 15+ can supply dynamic route params as a Promise.
 * Always unwrap (await) before reading properties like `id`.
 */
async function unwrapParams(params) {
  return params && typeof params.then === "function" ? await params : params;
}

/** Parse OTP from headers/body, defaulting purpose when needed */
async function parseOtp(req, body, fallbackPurpose) {
  const h = req.headers;
  const purpose = (
    body?.otp?.purpose ??
    h.get("x-otp-purpose") ??
    fallbackPurpose ??
    ""
  )
    .toString()
    .toLowerCase()
    .trim();

  const code = (
    body?.otp?.code ??
    h.get("x-otp-code") ??
    h.get("x-otp-token") ?? // some clients send it as token
    ""
  )
    .toString()
    .trim();

  // Identifier can arrive under several keys
  const identifier =
    body?.otp?.identifier ??
    body?.otp?.to ??
    body?.otp?.id ??
    h.get("x-otp-identifier") ??
    h.get("x-otp-to") ??
    h.get("x-otp-id") ??
    "";

  return { purpose, code, identifier };
}

/** Canonicalize incoming address payload into model fields, preserving existing values when not provided */
function canon(a = {}, exists = {}) {
  const l1 =
    a.line1 ||
    a.address1 ||
    a.addressLine1 ||
    a.streetAddress ||
    exists.line1;
  const l2 =
    a.line2 ||
    a.address2 ||
    a.addressLine2 ||
    exists.line2 ||
    null;
  const city =
    a.city || a.cityOrUpazila || a.upazila || a.district || exists.city;
  const state =
    a.state ||
    a.districtOrState ||
    a.district ||
    a.division ||
    exists.state;
  const postalCode =
    a.postalCode || a.postcode || exists.postalCode || null;
  const countryIso2 = (
    a.countryIso2 || a.country || exists.countryIso2 || "BD"
  ).toUpperCase();

  return {
    line1: l1,
    line2: l2,
    city,
    state,
    postalCode,
    countryIso2,
    premise: a.houseName ?? exists.premise ?? null,
    streetNumber: a.houseNo ?? exists.streetNumber ?? null,
    subpremise:
      [a.apartmentNo, a.floorNo].filter(Boolean).join(", ") ||
      exists.subpremise ||
      null,
    sublocality:
      a.policeStation || a.thana || exists.sublocality || null,
    adminLevel1: a.division ?? exists.adminLevel1 ?? null,
    adminLevel2: a.district ?? exists.adminLevel2 ?? null,
    adminLevel3: a.upazila ?? exists.adminLevel3 ?? null,
    granular: {
      ...(exists.granular || {}),
      name: a.name ?? exists.granular?.name ?? null,
      phone: a.phone ?? exists.granular?.phone ?? null,
      email: a.email ?? exists.granular?.email ?? null,
      label: a.label ?? exists.granular?.label ?? null,
      notes: a.notes ?? exists.granular?.notes ?? null,
    },
  };
}

/** Normalize DB address to client payload (FIX: flatten name/phone/email/label). */
function normalizeAddress(a) {
  if (!a) return null;
  const g = a.granular || {};

  const name =
    (a.name ?? g.name ?? null) != null
      ? String(a.name ?? g.name).trim() || null
      : null;

  const phone =
    normalizePhone(a.phone ?? g.phone ?? null) ||
    normalizePhone(g.phone ?? null) ||
    null;

  const email =
    (a.email ?? g.email ?? null) != null
      ? String(a.email ?? g.email).trim().toLowerCase() || null
      : null;

  const label =
    (a.label ?? g.label ?? null) != null
      ? String(a.label ?? g.label).trim() || null
      : null;

  const notes =
    (a.notes ?? g.notes ?? null) != null
      ? String(a.notes ?? g.notes).trim() || null
      : null;

  return {
    id: a.id,
    isDefault: !!a.isDefault,

    // ✅ critical fields for checkout tiles (top-level)
    name,
    phone,
    email,
    label,
    notes,

    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    countryIso2: a.countryIso2,
    houseName: a.premise,
    houseNo: a.streetNumber,
    apartmentNo: a.subpremise || null,
    division: a.adminLevel1,
    district: a.adminLevel2,
    upazila: a.adminLevel3,
    policeStation: a.sublocality || null,

    // keep granular for backward compat
    granular: g,

    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/** Helper to verify OTP required (strict) for update/delete cases */
async function verifyOtpRequired({ userId, otp, expectedPurpose }) {
  const idRaw = otp?.identifier ?? otp?.id ?? otp?.to ?? null;
  const code = otp?.code ?? null;
  const purpose = String(otp?.purpose || expectedPurpose || "")
    .toLowerCase()
    .trim();

  if (!ADDRESS_MUTATION_PURPOSES.has(purpose)) {
    return { ok: false, error: "OTP_PURPOSE_INVALID" };
  }
  if (!/^\d{6}$/.test(String(code || ""))) {
    return { ok: false, error: "OTP_CODE_REQUIRED" };
  }
  const parsed = detectIdentifier(idRaw);
  if (!parsed.type || parsed.type !== "phone") {
    return { ok: false, error: "OTP_IDENTIFIER_PHONE_REQUIRED" };
  }

  const now = new Date();
  const rec = await prisma.otpCode.findFirst({
    where: {
      userId,
      purpose,
      consumedAt: null,
      expiresAt: { gte: now },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, purpose: true },
  });
  if (!rec) return { ok: false, error: "OTP_NOT_FOUND_OR_EXPIRED" };

  const expectedHash = hmacFor(userId, rec.purpose, String(code));
  if (rec.codeHash !== expectedHash) {
    await prisma.otpCode.update({
      where: { id: rec.id },
      data: { attemptCount: { increment: 1 } },
    });
    return { ok: false, error: "OTP_MISMATCH" };
  }

  // consume OTP
  await prisma.otpCode.update({
    where: { id: rec.id },
    data: { consumedAt: new Date() },
  });
  return { ok: true, phoneFromOtp: parsed.phone || null };
}

/** Load list+default used in DELETE response */
async function loadListAndDefault(userId) {
  const list = await prisma.address.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  // ✅ list now includes top-level name/phone too
  const normalized = list.map(normalizeAddress);

  const def = normalized.find((x) => x.isDefault) || normalized[0] || null;
  return { list: normalized, def };
}

/* ────────────────────────── GET (single address) ────────────────────────── */

export async function GET(req, { params }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    // FIX: await params
    const p = await unwrapParams(params);
    const id = p?.id;

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "id_required" },
        { status: 400 }
      );
    }

    const addr = await prisma.address.findFirst({
      where: { id, userId, archivedAt: null },
    });
    if (!addr) {
      return NextResponse.json(
        { ok: false, error: "address_not_found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { ok: true, data: normalizeAddress(addr) },
      { status: 200 }
    );
  } catch (err) {
    console.error("Address [id] GET error", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

/* ────────────────────────── core update handler ────────────────────────── */

async function handleUpdate(req, { params }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  // FIX: await params
  const p = await unwrapParams(params);
  const id = p?.id;

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "id_required" },
      { status: 400 }
    );
  }

  const exists = await prisma.address.findFirst({
    where: { id, userId, archivedAt: null },
  });
  if (!exists) {
    return NextResponse.json(
      { ok: false, error: "address_not_found" },
      { status: 404 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { makeDefault, ...rest } = body || {};

  // Strict: update requires UPDATE OTP
  const otpParsed = await parseOtp(req, body, PURPOSES.UPDATE);
  const otpResult = await verifyOtpRequired({
    userId,
    otp: otpParsed,
    expectedPurpose: PURPOSES.UPDATE,
  });
  if (!otpResult.ok) {
    return NextResponse.json(
      { ok: false, error: otpResult.error },
      { status: 400 }
    );
  }

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, phoneVerifiedAt: true },
  });

  if (!me?.phoneVerifiedAt) {
    const candidatePhone = normalizePhone(me?.phone || otpResult.phoneFromOtp);
    if (!candidatePhone) {
      return NextResponse.json(
        { ok: false, error: "PHONE_VERIFICATION_REQUIRED" },
        { status: 400 }
      );
    }
    await prisma.user.update({
      where: { id: userId },
      data: { phone: candidatePhone, phoneVerifiedAt: new Date() },
    });
  }

  const v = canon(rest, exists);
  const updated = await prisma.address.update({
    where: { id },
    data: v,
  });

  if (makeDefault) {
    await prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, archivedAt: null },
        data: { isDefault: false },
      });
      await tx.address.update({
        where: { id },
        data: { isDefault: true },
      });
      await tx.user.update({
        where: { id: userId },
        data: { defaultAddressId: id },
      });
    });
  }

  const { list, def } = await loadListAndDefault(userId);

  return NextResponse.json(
    {
      ok: true,
      message: "Address updated.",
      address: normalizeAddress(updated),
      addresses: list,
      defaultAddress: def,
      data: list,
    },
    { status: 200 }
  );
}

/* ────────────────────────── PUT & PATCH (OTP enforced) ────────────────────────── */

export async function PUT(req, ctx) {
  try {
    return await handleUpdate(req, ctx);
  } catch (err) {
    console.error("Address [id] PUT error", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function PATCH(req, ctx) {
  try {
    return await handleUpdate(req, ctx);
  } catch (err) {
    console.error("Address [id] PATCH error", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

/* ────────────────────────── DELETE (soft-delete; OTP optional for non-default) ────────────────────────── */

export async function DELETE(req, { params }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    // FIX: await params
    const p = await unwrapParams(params);
    const id = p?.id;

    if (!id) {
      return NextResponse.json(
        { ok: false, error: "id_required" },
        { status: 400 }
      );
    }

    const existing = await prisma.address.findFirst({
      where: { id, userId, archivedAt: null },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "address_not_found" },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // Require OTP only when deleting current default
    if (existing.isDefault) {
      const otpParsed = await parseOtp(req, body, PURPOSES.DELETE);
      const otpResult = await verifyOtpRequired({
        userId,
        otp: otpParsed,
        expectedPurpose: PURPOSES.DELETE,
      });
      if (!otpResult.ok) {
        return NextResponse.json(
          { ok: false, error: otpResult.error },
          { status: 400 }
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      // Soft-delete this address
      await tx.address.update({
        where: { id },
        data: { archivedAt: new Date(), isDefault: false },
      });

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { defaultAddressId: true },
      });

      if (user?.defaultAddressId === id) {
        // Try to assign a new default from remaining addresses
        const candidate = await tx.address.findFirst({
          where: { userId, archivedAt: null },
          orderBy: [{ updatedAt: "desc" }],
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
      }
    });

    const { list, def } = await loadListAndDefault(userId);

    return NextResponse.json(
      {
        ok: true,
        message: "Address deleted.",
        addresses: list,
        defaultAddress: def,
        data: list,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Address [id] DELETE error", err);
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR_ADDRESS_DELETE" },
      { status: 500 }
    );
  }
}
