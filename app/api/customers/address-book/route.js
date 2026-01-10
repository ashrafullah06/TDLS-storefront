// FILE: app/api/customers/address-book/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import crypto from "crypto";

/* ────────────────────────── shared helpers ────────────────────────── */

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

function getOtpSecret() {
  const v = process.env.OTP_SECRET;
  if (!v) throw new Error("OTP_SECRET is required");
  return v;
}

function hmacFor(userId, purpose, code) {
  return crypto
    .createHmac("sha256", getOtpSecret())
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

/** Parse OTP from headers or body. Supports either x-otp-token(base64 json) or discrete headers. */
function parseOtpFromRequest(req, body, fallbackExpectedPurpose) {
  const h = req.headers;

  const token =
    h.get("x-otp-token") ||
    h.get("X-Otp-Token") ||
    (body && body.otp && body.otp.token) ||
    "";

  const parseB64Json = (val) => {
    if (!val) return null;
    try {
      const norm = String(val).trim().replace(/\s+/g, "");
      const pad =
        norm.length % 4 === 2 ? "==" : norm.length % 4 === 3 ? "=" : "";
      const json = Buffer.from(norm + pad, "base64").toString("utf8");
      return JSON.parse(json);
    } catch {
      return null;
    }
  };

  const fromToken = parseB64Json(token);

  const purposeRaw =
    (fromToken && fromToken.purpose) ||
    (body && body.otp && body.otp.purpose) ||
    h.get("x-otp-purpose") ||
    h.get("X-Otp-Purpose") ||
    fallbackExpectedPurpose ||
    "";

  const codeRaw =
    (fromToken && (fromToken.code || fromToken.token)) ||
    (body && body.otp && (body.otp.code || body.otp.token)) ||
    h.get("x-otp-code") ||
    h.get("X-Otp-Code") ||
    "";

  const identifierRaw =
    (fromToken && (fromToken.identifier || fromToken.to || fromToken.id)) ||
    (body && body.otp && (body.otp.identifier || body.otp.to || body.otp.id)) ||
    h.get("x-otp-identifier") ||
    h.get("X-Otp-Identifier") ||
    "";

  const purpose = String(purposeRaw || "").toLowerCase().trim();
  const code = String(codeRaw || "").trim();
  const identifier = String(identifierRaw || "").trim();

  if (!purpose && !code && !identifier) return null;
  return { purpose, code, identifier };
}

/** Verify OTP for address mutations. (Currently enforces PHONE identifier.) */
async function verifyAddressOtp({ userId, otp, acceptablePurposes }) {
  const idRaw = otp?.identifier ?? otp?.id ?? otp?.to ?? null;
  const code = otp?.code ?? null;
  const purpose = String(otp?.purpose || "").toLowerCase().trim();

  if (!ADDRESS_MUTATION_PURPOSES.has(purpose)) {
    return { ok: false, error: "OTP_PURPOSE_INVALID" };
  }
  if (
    Array.isArray(acceptablePurposes) &&
    acceptablePurposes.length > 0 &&
    !acceptablePurposes.map((x) => String(x).toLowerCase()).includes(purpose)
  ) {
    return { ok: false, error: "OTP_PURPOSE_NOT_ALLOWED" };
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

  await prisma.otpCode.update({
    where: { id: rec.id },
    data: { consumedAt: new Date() },
  });

  return { ok: true, phoneFromOtp: parsed.phone || null };
}

/** Canonicalize payload into DB shape (preserves granular identity fields). */
function canonAddress(input, existing) {
  const a = input || {};
  const ex = existing || {};

  const l1 = (a.line1 ?? ex.line1 ?? "").toString().trim();
  const l2 = (a.line2 ?? ex.line2 ?? "").toString().trim();

  const city = (a.city ?? a.area ?? ex.city ?? "").toString().trim() || null;
  const state =
    (a.state ?? a.region ?? ex.state ?? "").toString().trim() || null;

  const postalCode =
    (a.postalCode ?? a.postcode ?? ex.postalCode ?? "").toString().trim() ||
    null;

  const countryIso2 = String(a.countryIso2 || a.country || ex.countryIso2 || "BD")
    .toUpperCase()
    .trim();

  const name =
    (a.name ?? ex?.granular?.name ?? null) != null
      ? String(a.name ?? ex?.granular?.name).trim() || null
      : null;

  const phone =
    normalizePhone(a.phone ?? ex?.granular?.phone ?? null) ||
    normalizePhone(ex?.granular?.phone ?? null) ||
    null;

  const email =
    (a.email ?? ex?.granular?.email ?? null) != null
      ? String(a.email ?? ex?.granular?.email).trim().toLowerCase() || null
      : null;

  const label =
    (a.label ?? ex?.granular?.label ?? null) != null
      ? String(a.label ?? ex?.granular?.label).trim() || null
      : null;

  const notes =
    (a.notes ?? ex?.granular?.notes ?? null) != null
      ? String(a.notes ?? ex?.granular?.notes).trim() || null
      : null;

  return {
    line1: l1 || null,
    line2: l2 || null,
    city,
    state,
    postalCode,
    countryIso2,
    premise: a.houseName ?? ex.premise ?? null,
    streetNumber: a.houseNo ?? ex.streetNumber ?? null,
    subpremise:
      [a.apartmentNo, a.floorNo].filter(Boolean).join(", ") ||
      ex.subpremise ||
      null,
    sublocality: a.policeStation || a.thana || ex.sublocality || null,
    adminLevel1: a.division ?? ex.adminLevel1 ?? null,
    adminLevel2: a.district ?? ex.adminLevel2 ?? null,
    adminLevel3: a.upazila ?? ex.adminLevel3 ?? null,
    granular: {
      ...(ex.granular || {}),
      name,
      phone,
      email,
      label,
      notes,
    },
  };
}

/** Normalize DB address into frontend-friendly payload (flatten identity fields). */
function normalizeAddress(a) {
  if (!a) return null;
  const g = a.granular || {};
  return {
    id: a.id,
    isDefault: !!a.isDefault,

    name:
      (a.name ?? g.name ?? null) != null
        ? String(a.name ?? g.name).trim() || null
        : null,
    phone:
      normalizePhone(a.phone ?? g.phone ?? null) ||
      normalizePhone(g.phone ?? null) ||
      null,
    email:
      (a.email ?? g.email ?? null) != null
        ? String(a.email ?? g.email).trim().toLowerCase() || null
        : null,
    label:
      (a.label ?? g.label ?? null) != null
        ? String(a.label ?? g.label).trim() || null
        : null,
    notes:
      (a.notes ?? g.notes ?? null) != null
        ? String(a.notes ?? g.notes).trim() || null
        : null,

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

    granular: g,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/**
 * IMPORTANT:
 * This helper MUST NOT be exported from a route module,
 * otherwise Next.js will fail type-checking the route exports.
 */
async function loadListAndDefault(userId) {
  const list = await prisma.address.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  const addresses = list.map(normalizeAddress).filter(Boolean);
  const def = addresses.find((x) => x.isDefault) || addresses[0] || null;

  return {
    addresses,
    defaultAddress: def,
    defaultId: def?.id ?? null,
    data: addresses, // legacy
  };
}

/** hard/soft delete helper (used internally by this route). */
async function deleteAddressForUser(userId, id) {
  const existing = await prisma.address.findFirst({
    where: { id, userId, archivedAt: null },
  });
  if (!existing) {
    const e = new Error("NOT_FOUND");
    e.code = "NOT_FOUND";
    throw e;
  }

  await prisma.$transaction(async (tx) => {
    await tx.address.update({
      where: { id },
      data: { archivedAt: new Date(), isDefault: false },
    });

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { defaultAddressId: true },
    });

    if (user?.defaultAddressId === id) {
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

  const { addresses, defaultId } = await loadListAndDefault(userId);
  return { addresses, defaultId };
}

/* ────────────────────────── GET (list or default) ────────────────────────── */

export async function GET(req) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
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
        data: loaded.addresses, // legacy alias
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

/* ────────────────────────── POST (create / update / set default) ────────────────────────── */

export async function POST(req) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { id, makeDefault, otp, ...rest } = body || {};

    // If only setting default, allow without OTP
    if (id && makeDefault && !rest.line1 && !rest.city) {
      const target = await prisma.address.findFirst({
        where: { id, userId, archivedAt: null },
      });
      if (!target) {
        return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }

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

    const expectedPurpose = id ? PURPOSES.UPDATE : PURPOSES.CREATE;
    const otpParsed = otp || parseOtpFromRequest(req, body, expectedPurpose);

    if (!otpParsed) {
      return NextResponse.json({ ok: false, error: "OTP_CODE_REQUIRED" }, { status: 400 });
    }

    const otpResult = await verifyAddressOtp({
      userId,
      otp: otpParsed,
      acceptablePurposes: [expectedPurpose],
    });

    if (!otpResult.ok) {
      return NextResponse.json({ ok: false, error: otpResult.error }, { status: 400 });
    }

    // Ensure user's phone is verified and stored
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

    let updated;
    if (id) {
      const existing = await prisma.address.findFirst({
        where: { id, userId, archivedAt: null },
      });
      if (!existing) {
        return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }

      const v = canonAddress(rest, existing);
      updated = await prisma.address.update({
        where: { id },
        data: v,
      });
    } else {
      const v = canonAddress(rest, {});
      updated = await prisma.address.create({
        data: {
          ...v,
          userId,
          isDefault: false,
          archivedAt: null,
        },
      });
    }

    if (makeDefault) {
      await prisma.$transaction(async (tx) => {
        await tx.address.updateMany({
          where: { userId, archivedAt: null },
          data: { isDefault: false },
        });
        await tx.address.update({
          where: { id: updated.id },
          data: { isDefault: true },
        });
        await tx.user.update({
          where: { id: userId },
          data: { defaultAddressId: updated.id },
        });
      });
    }

    const loaded = await loadListAndDefault(userId);

    return NextResponse.json(
      {
        ok: true,
        message: id ? "Address updated." : "Address saved.",
        address: normalizeAddress(updated),
        addresses: loaded.addresses,
        defaultAddress: loaded.defaultAddress,
        defaultId: loaded.defaultId,
        data: loaded.addresses,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Address-book POST error", err);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/* ────────────────────────── DELETE (compat — body.id) ────────────────────────── */
/* Prefer using /api/customers/address-book/:id, but this keeps old callers working. */

export async function DELETE(req) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const id = body?.id;
    if (!id) {
      return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
    }

    const existing = await prisma.address.findFirst({
      where: { id, userId, archivedAt: null },
    });
    if (!existing) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    // For default address, require delete OTP
    if (existing.isDefault) {
      const otpParsed = body?.otp || parseOtpFromRequest(req, body, PURPOSES.DELETE);
      if (!otpParsed) {
        return NextResponse.json({ ok: false, error: "OTP_CODE_REQUIRED" }, { status: 400 });
      }
      const otpResult = await verifyAddressOtp({
        userId,
        otp: otpParsed,
        acceptablePurposes: [PURPOSES.DELETE, PURPOSES.UPDATE],
      });
      if (!otpResult.ok) {
        return NextResponse.json({ ok: false, error: otpResult.error }, { status: 400 });
      }
    }

    const { addresses, defaultId } = await deleteAddressForUser(userId, String(id));

    const def = addresses.find((a) => String(a.id) === String(defaultId)) || null;

    return NextResponse.json(
      {
        ok: true,
        message: "Address deleted.",
        addresses,
        defaultId,
        defaultAddress: def,
        data: addresses,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Address-book DELETE (root) error", err);
    if (err && (err.code === "NOT_FOUND" || err.message === "NOT_FOUND")) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: "INTERNAL_ERROR_ADDRESS_DELETE" },
      { status: 500 }
    );
  }
}
