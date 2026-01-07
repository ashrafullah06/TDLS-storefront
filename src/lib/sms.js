// FILE: src/lib/sms.js
// MiMSMS-based SMS sender for OTP codes.
// Returns true on success, false on failure.
// Signature (supports both ttlSec and ttlSeconds):
//
//   const ok = await sendOtpSms({ to, code, ttlSeconds: 90, brand = "TDLC", purpose: "login" })
//   // or (legacy)
//   const ok = await sendOtpSms({ to, code, ttlSec: 300, brand = "TDLC", purpose: "login" })
//
// ENV expected at runtime:
//   MIMSMS_BASE_URL=https://api.mimsms.com
//   MIMSMS_USERNAME=tdlcbrand@gmail.com
//   MIMSMS_APIKEY=O6KT9FDK94SRNV9
//   MIMSMS_SENDER=8809601004735
//   MIMSMS_TRANSACTION_TYPE=T
//   MIMSMS_CAMPAIGN_ID=null
//   BRAND_NAME=TDLC        // optional; used as default brand when not provided
//   OTP_TTL_SECONDS=90     // optional; used when neither ttlSeconds nor ttlSec are passed
//
// Message format (purpose-aware & TTL-synced):
//   "<Brand> <purpose> code is <code>. Expires in <N> second(s)/minute(s)."

const BASE_URL = process.env.MIMSMS_BASE_URL || "https://api.mimsms.com";
const USERNAME = process.env.MIMSMS_USERNAME;
const APIKEY   = process.env.MIMSMS_APIKEY;
const SENDER   = process.env.MIMSMS_SENDER;
const TXN_TYPE = (process.env.MIMSMS_TRANSACTION_TYPE || "T").toUpperCase(); // T|P|D
const CAMPAIGN = process.env.MIMSMS_CAMPAIGN_ID ?? "null"; // "null" if unused
const DEFAULT_BRAND = process.env.BRAND_NAME || "TDLC";
const ENV_TTL = Number(process.env.OTP_TTL_SECONDS || 0);

// Purpose → user-friendly label (keeps your enum keys but shows readable text)
const PURPOSE_LABELS = {
  // existing
  signup: "signup",
  login: "login",

  // customer flows
  address_create: "address creation",
  address_update: "address update",
  address_delete: "address deletion",
  mobile_update: "mobile number confirmation",
  cod_confirm: "COD confirmation",
  order_confirm: "order confirmation",
  payment_gateway_auth: "payment authentication",

  // account & security
  email_update: "email change confirmation",
  password_change: "password change confirmation",

  // wallet & refunds
  wallet_transfer: "wallet transaction confirmation",
  refund_destination_confirm: "refund destination confirmation",

  // loyalty & privacy
  reward_redeem_confirm: "reward redemption confirmation",
  privacy_request_confirm: "privacy request confirmation",

  // RBAC / backoffice
  rbac_login: "admin login verification",
  rbac_elevate: "admin privilege elevation",
  rbac_sensitive_action: "admin sensitive action verification",
};

function fmtTtl(ttlSeconds) {
  const s = Number(ttlSeconds || 0);
  if (!Number.isFinite(s) || s <= 0) return "a short time";
  if (s < 120) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

function normalizeDigits(str) {
  if (!str) return str;
  // keep only digits and leading '+'
  return String(str).replace(/(?!^\+)[^\d]/g, "");
}

// Accept "+8801XXXXXXXXX" and "01XXXXXXXXX" → convert to "8801XXXXXXXXX" (MiMSMS requirement)
function toMiMNumber(input) {
  if (!input) return null;
  let s = normalizeDigits(String(input).trim());
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("01") && s.length === 11) s = "880" + s;
  return s;
}

async function postJson(path, payload) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/**
 * Returns true on success, false on failure.
 */
export async function sendOtpSms({
  to,
  code,
  ttlSec,                 // legacy param name
  ttlSeconds,             // preferred param name
  brand,
  purpose,
  meta,                   // optional: if callers pass { purpose } inside meta
}) {
  const brandName = brand || DEFAULT_BRAND;

  // Prefer ttlSeconds, then ttlSec, then env, finally fallback 300s
  const ttlRaw =
    (Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds)) ||
    (Number.isFinite(Number(ttlSec)) && Number(ttlSec)) ||
    (Number.isFinite(ENV_TTL) && ENV_TTL) ||
    300;

  const ttlSafe = Math.max(1, Math.floor(ttlRaw)); // whole seconds, min 1s

  // robust purpose detection
  const pKey = String(
    purpose ?? meta?.purpose ?? "login"
  ).toLowerCase().trim();
  const readablePurpose = PURPOSE_LABELS[pKey] || pKey || "verification";

  // Tell exactly which ENV is missing (so we fix the right one)
  const missing = [];
  if (!USERNAME) missing.push("MIMSMS_USERNAME");
  if (!APIKEY)   missing.push("MIMSMS_APIKEY");
  if (!SENDER)   missing.push("MIMSMS_SENDER");

  if (missing.length) {
    console.error("[MiMSMS] Missing required env:", missing.join(", "));
    console.log("[SMS disabled - missing MiMSMS env]", { to, code, ttlSeconds: ttlSafe, brandName, pKey });
    return false;
  }

  const MobileNumber = toMiMNumber(to);
  if (!MobileNumber || !/^\d{12,15}$/.test(MobileNumber)) {
    console.error("[MiMSMS] Invalid destination number after normalization:", { original: to, MobileNumber });
    return false;
  }

  const Message = `Your ${brandName} ${readablePurpose} code is ${code}. Expires in ${fmtTtl(ttlSafe)}.`;

  const payload = {
    UserName: USERNAME,
    Apikey: APIKEY,
    MobileNumber,
    CampaignId: String(CAMPAIGN),
    SenderName: SENDER,
    TransactionType: TXN_TYPE,
    Message,
  };

  try {
    const { data } = await postJson("/api/SmsSending/SMS", payload);
    const { statusCode, status, trxnId, responseResult } = data || {};

    const success = statusCode === "200" && String(status).toLowerCase() === "success";
    if (!success) {
      console.error("[MiMSMS] sendOtpSms failed", {
        statusCode,
        status,
        responseResult,
        trxnId,
        MobileNumber,
        SENDER,
        TXN_TYPE,
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[MiMSMS] sendOtpSms network/error:", err);
    return false;
  }
}

// Optional ops helper; not used by OTP flow
export async function checkSmsBalance() {
  if (!USERNAME || !APIKEY) return { ok: false };
  const { data } = await postJson("/api/SmsSending/balanceCheck", {
    UserName: USERNAME,
    Apikey: APIKEY,
  });
  return { ok: data?.statusCode === "200", balance: data?.responseResult, raw: data };
}

// Exporting labels can help other modules keep wording consistent (non-breaking)
export const purposeLabel = (key) => {
  const k = String(key || "").toLowerCase().trim();
  return PURPOSE_LABELS[k] || k || "verification";
};

export default { sendOtpSms, checkSmsBalance, purposeLabel };
