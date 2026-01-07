// FILE: app/api/auth/forgot-password/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

const isEmailish = (v) => /\S+@\S+\.\S+/.test(String(v || "").trim());

function normalizePhone(raw) {
  if (!raw) return null;

  let s = String(raw).trim();
  s = s.replace(/[^\d+]/g, "");

  // Bangladesh-friendly normalization (keeps other countries as digits too)
  if (/^0\d{10}$/.test(s)) {
    s = "880" + s.slice(1);
  } else if (/^\+880\d{10}$/.test(s)) {
    s = s.replace(/^\+/, "");
  } else if (/^880\d{10}$/.test(s)) {
    // already canonical
  }

  const digits = s.replace(/\+/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function normalizeIdentifier(raw) {
  const val = String(raw || "").trim();
  if (!val) return null;
  if (isEmailish(val)) return val.toLowerCase();
  return normalizePhone(val);
}

async function postJson(url, payload, idem) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idem ? { "x-idempotency-key": idem } : {}),
    },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function requestOtp(baseUrl, payload, idem) {
  // ✅ Enforce the canonical route only (no legacy fallback)
  const url = new URL("/api/auth/request-otp", baseUrl);
  return await postJson(url, payload, idem);
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const identifier = normalizeIdentifier(body?.identifier);

    if (!identifier) {
      return NextResponse.json(
        { ok: false, error: "IDENTIFIER_REQUIRED" },
        { status: 400 }
      );
    }

    const channel = isEmailish(identifier) ? "email" : "sms";
    const idem =
      (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`);

    // Primary purpose for password recovery.
    let attempt = await requestOtp(
      req.url,
      { identifier, channel, purpose: "password_change", clientRequestId: idem },
      idem
    );

    // Fallback: if server rejects purpose naming, try login as compatibility path.
    // (still within the canonical /api/auth/request-otp endpoint)
    if (!attempt?.res?.ok) {
      const err = attempt?.json?.error;

      if (attempt?.res?.status === 429 && attempt?.json?.retryAfter) {
        return NextResponse.json(
          { ok: false, error: "RATE_LIMITED", retryAfter: attempt.json.retryAfter },
          { status: 429 }
        );
      }

      if (err === "INVALID_PURPOSE") {
        const attempt2 = await requestOtp(
          req.url,
          { identifier, channel, purpose: "login", clientRequestId: idem },
          idem
        );
        attempt = attempt2;
      }
    }

    if (!attempt?.res?.ok) {
      const err = attempt?.json?.error || "REQUEST_OTP_FAILED";
      const status = err === "USER_NOT_FOUND" ? 404 : attempt?.res?.status || 500;
      return NextResponse.json({ ok: false, error: err }, { status });
    }

    return NextResponse.json({
      ok: true,
      via: attempt.json?.via || channel,
      ttlSeconds: Number(attempt.json?.ttlSeconds || 600),
    });
  } catch (e) {
    console.error("[forgot-password]", e);
    return NextResponse.json({ ok: false, error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
