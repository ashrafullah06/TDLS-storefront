// FILE: src/lib/otp-session.js
import crypto from "crypto";

const OTP_SECRET = process.env.OTP_SECRET;
if (!OTP_SECRET) throw new Error("OTP_SECRET is required");

export const OTP_SESSION_COOKIE = "otp_session"; // customer (existing)
export const OTP_SESSION_ADMIN_COOKIE = "otp_session_admin"; // admin (new)

/** Minimal cookie parser (server-only) */
function parseCookie(header = "") {
  const out = {};
  header.split(";").forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > -1) {
      const k = kv.slice(0, i).trim();
      const v = kv.slice(i + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function b64urlToBuf(s) {
  const b64 =
    s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Buffer.from(b64, "base64");
}

function bufToB64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function timingEq(a, b) {
  const A = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
  const B = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
  if (A.length !== B.length) return false;
  try {
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

function hmacB64url(s) {
  return crypto.createHmac("sha256", OTP_SECRET).update(s).digest("base64url");
}

/**
 * Create a signed session token (JWT-like).
 * payload should include: { uid, pur, exp }
 * You may add extra fields (e.g. scp).
 */
export function signOtpSession(payload) {
  const header = { alg: "HS256", typ: "OTP" };
  const h = bufToB64url(JSON.stringify(header));
  const p = bufToB64url(JSON.stringify(payload));
  const sig = hmacB64url(`${h}.${p}`);
  return `${h}.${p}.${sig}`;
}

/**
 * Serialize cookie with safe defaults.
 */
export function serializeOtpCookie(
  name,
  value,
  {
    maxAgeSeconds = 10 * 60,
    path = "/",
    sameSite = "Lax",
    httpOnly = true,
    secure = process.env.NODE_ENV === "production",
  } = {}
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    `Max-Age=${Math.max(1, Math.trunc(maxAgeSeconds))}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Verify OTP session from Request cookies.
 * Default cookie: otp_session (customer)
 *
 * @param {Request} req
 * @param {string|string[]=} expectedPurpose Optional purpose or list of accepted purposes
 * @param {object=} opts
 * @param {string=} opts.cookieName Override cookie name (e.g. otp_session_admin)
 * @returns {{ok:boolean, uid?:string, purpose?:string, exp?:number, error?:string, payload?:any}}
 */
export function verifyOtpSession(req, expectedPurpose, opts = {}) {
  try {
    const rawCookie = req.headers.get("cookie") || "";
    const cookies = parseCookie(rawCookie);
    const cookieName = opts.cookieName || OTP_SESSION_COOKIE;

    const token = cookies[cookieName];
    if (!token) return { ok: false, error: "MISSING_OTP_SESSION" };

    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false, error: "INVALID_TOKEN_FORMAT" };
    const [h, p, s] = parts;

    const sig = hmacB64url(`${h}.${p}`);
    if (!timingEq(sig, s)) return { ok: false, error: "BAD_SIGNATURE" };

    const payload = JSON.parse(b64urlToBuf(p).toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!payload?.exp || payload.exp <= now) return { ok: false, error: "EXPIRED" };

    if (expectedPurpose) {
      const wanted = Array.isArray(expectedPurpose) ? expectedPurpose : [expectedPurpose];
      if (!wanted.includes(String(payload.pur))) {
        return { ok: false, error: "PURPOSE_MISMATCH" };
      }
    }

    return { ok: true, uid: payload.uid, purpose: payload.pur, exp: payload.exp, payload };
  } catch {
    return { ok: false, error: "VERIFY_ERROR" };
  }
}

export function requireOtpSession(req, expectedPurpose, opts = {}) {
  return verifyOtpSession(req, expectedPurpose, opts);
}
