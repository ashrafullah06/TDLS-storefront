// FILE: src/lib/sms/index.js
// MiMSMS client used by /api/auth/request-otp.
// - Returns true/false so your route’s current logic keeps working.
// - Accepts "+8801XXXXXXXXX" and "01XXXXXXXXX"; converts to "8801XXXXXXXXX" per MiMSMS.
// - Logs exactly which env var is missing or which vendor status we got.

const BASE_URL = process.env.MIMSMS_BASE_URL || "https://api.mimsms.com";
const USERNAME = process.env.MIMSMS_USERNAME;       // tdlcbrand@gmail.com
const APIKEY   = process.env.MIMSMS_APIKEY;         // O6KT9FDK94SRNV9
const SENDER   = process.env.MIMSMS_SENDER;         // 8809601004735
const TXN_TYPE = (process.env.MIMSMS_TRANSACTION_TYPE || "T").toUpperCase(); // T|P|D
const CAMPAIGN = process.env.MIMSMS_CAMPAIGN_ID ?? "null";

// Default brand (only affects message text)
const BRAND    = process.env.BRAND_NAME || "TDLS";

// --- helpers ---
function normalizeDigits(s) {
  if (!s) return s;
  return String(s);
}

// MiMSMS requires international format WITHOUT '+'
function toMiMNumber(input) {
  if (!input) return null;
  let s = normalizeDigits(String(input).trim());
  if (s.startsWith("+")) s = s.slice(1);
  // Convert local BD format 01XXXXXXXXX -> 8801XXXXXXXXX
  if (s.startsWith("01") && s.length === 11) s = "880" + s;
  return s;
}

async function postJson(path, payload) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/**
 * Low-level SMS sender for arbitrary text.
 * @returns {Promise<{ ok: boolean, trxnId?: string, statusCode?: string, status?: string, responseResult?: string }>}
 */
export async function sendSms({ to, message, transactionType = TXN_TYPE, campaignId = CAMPAIGN }) {
  const missing = [];
  if (!USERNAME) missing.push("MIMSMS_USERNAME");
  if (!APIKEY)   missing.push("MIMSMS_APIKEY");
  if (!SENDER)   missing.push("MIMSMS_SENDER");
  if (missing.length) {
    console.error("[MiMSMS] Missing env:", missing.join(", "));
    return { ok: false };
  }

  const MobileNumber = toMiMNumber(to);
  if (!MobileNumber || !/^\d{12,15}$/.test(MobileNumber)) {
    console.error("[MiMSMS] Invalid MobileNumber after normalization:", { original: to, MobileNumber });
    return { ok: false };
  }

  const payload = {
    UserName: USERNAME,
    Apikey: APIKEY,
    MobileNumber,
    CampaignId: String(campaignId),
    SenderName: SENDER,
    TransactionType: String(transactionType || "T"),
    Message: message,
  };

  try {
    const { data } = await postJson("/api/SmsSending/SMS", payload);
    const { statusCode, status, trxnId, responseResult } = data || {};
    const ok = statusCode === "200" && String(status).toLowerCase() === "success";
    if (!ok) {
      console.error("[MiMSMS] sendSms failed", { statusCode, status, responseResult, trxnId, MobileNumber, SENDER });
    }
    return { ok, trxnId, statusCode, status, responseResult };
  } catch (err) {
    console.error("[MiMSMS] sendSms network/error:", err);
    return { ok: false };
  }
}

/**
 * High-level helper used by /api/auth/request-otp
 * Keeps your existing signature: sendOtpSms({ to, code, ttlSeconds, purpose })
 * Returns true/false. No other files need changes.
 */
export async function sendOtpSms({ to, code, ttlSeconds = 300, purpose = "login" }) {
  const safeCode = String(code || "").trim();
  if (!/^\d{4,8}$/.test(safeCode)) return false;

  const ttlMsg = Number.isFinite(ttlSeconds) ? ` Expires in ${Math.max(1, Math.round(ttlSeconds / 60))} min.` : "";
  const text = `${BRAND}: Your ${purpose} code is ${safeCode}.${ttlMsg}`;

  const res = await sendSms({ to, message: text });
  return !!res.ok;
}

// Optional: balance check for ops usage
export async function checkBalance() {
  const missing = [];
  if (!USERNAME) missing.push("MIMSMS_USERNAME");
  if (!APIKEY)   missing.push("MIMSMS_APIKEY");
  if (missing.length) {
    console.error("[MiMSMS] Missing env:", missing.join(", "));
    return { ok: false };
  }
  try {
    const { data } = await postJson("/api/SmsSending/balanceCheck", {
      UserName: USERNAME,
      Apikey: APIKEY,
    });
    const ok = data?.statusCode === "200";
    return { ok, balance: data?.responseResult, raw: data };
  } catch (e) {
    console.error("[MiMSMS] balanceCheck error:", e);
    return { ok: false };
  }
}

export default { sendSms, sendOtpSms, checkBalance };
