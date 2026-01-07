// FILE: src/lib/email.js
import crypto from "crypto";
import { getTransporter } from "./smtp";

const BRAND_NAME = process.env.BRAND_NAME || "TDLC";
const FROM_ADDR = process.env.EMAIL_FROM_NOREPLY; // e.g. no-reply@mail.thednalabstore.com
const SUPPORT_ADDRESS =
  process.env.SUPPORT_ADDRESS ||
  `support@${(FROM_ADDR || "").split("@")[1] || "example.com"}`;
const BRAND_URL = process.env.BRAND_URL || "https://thednalabstore.com";

// envelope-from/bounces — MUST live on the same domain as FROM_ADDR for DMARC/SPF alignment
const RETURN_PATH = process.env.EMAIL_RETURN_PATH || FROM_ADDR;

// OTP default TTL -> from env OTP_TTL_SECONDS (fallback 80s)
const DEFAULT_TTL = Number(process.env.OTP_TTL_SECONDS || 80);

// Optional HTTP failover with Resend (only used on explicit SMTP errors and if API key exists)
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

/* ---------------- helpers ---------------- */
function fmtTtl(ttlSec) {
  const s = Number(ttlSec || DEFAULT_TTL);
  if (!Number.isFinite(s) || s <= 0) return "a short time";
  if (s < 120) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

function domainOf(email) {
  const at = String(email || "").split("@")[1];
  return (at || "").toLowerCase();
}

function requireFromAddr() {
  // Fail fast with a clear error; missing FROM_ADDR causes invalid "From:" formatting
  if (!FROM_ADDR) throw new Error("EMAIL_FROM_NOREPLY is not configured");
  return FROM_ADDR;
}

function stableIdFragment(seed) {
  const s = String(seed || "").trim();
  if (!s) return null;
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/**
 * Deterministic Message-ID when `seed` is given (e.g., meta.otpId).
 * This helps prevent duplicates across retries/fallback providers.
 */
function makeMessageId(domain, seed) {
  const d = (domain || "").trim() || "thednalabstore.com";
  const frag = stableIdFragment(seed);
  if (frag) return `<tdlc.${frag}@${d}>`;
  const rnd = Math.random().toString(36).slice(2);
  return `<tdlc.${Date.now()}.${rnd}@${d}>`;
}

function isQuotaOrUsageLimitError(err) {
  const msg = String(err?.message || "");
  // MailerSend: "450 ... reached its email usage limit. #MS42204"
  return /MS42204|usage\s*limit|email usage limit|quota|rate\s*limit/i.test(msg);
}

function classifyShouldFailoverToResend(err) {
  if (!RESEND_API_KEY) return false;
  const code = Number(err?.responseCode || err?.code || 0);

  // SMTP errors likely to be transient or account-limited. Include quota/usage-limit messages too.
  const codeList = new Set([
    421, 450, 451, 452, 454, 471,
    500, 502, 503,
    550, 551, 552, 553, 554,
  ]);

  return codeList.has(code) || isQuotaOrUsageLimitError(err);
}

// Map enum-ish key → user-friendly label (keeps your enum but shows readable text)
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

/* ---------------- Secondary sender (failover via Resend) ---------------- */
async function sendViaResend({
  from,
  to,
  subject,
  html,
  text,
  headers,
  replyTo,
  messageId,
}) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

  // Resend supports custom headers; set Message-ID too for idempotency tracing.
  const mergedHeaders = {
    ...(headers || {}),
    ...(messageId ? { "Message-ID": messageId } : {}),
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      headers: mergedHeaders,
      reply_to: replyTo || SUPPORT_ADDRESS,
    }),
  });

  const jr = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(jr?.message || "Resend API send failed");
  return jr;
}

/* ---------------- Primary send with SMTP, with fallback ---------------- */
async function sendWithFailover(mailOptions) {
  const transporter = getTransporter();
  try {
    return await transporter.sendMail(mailOptions);
  } catch (err) {
    const shouldFailover = classifyShouldFailoverToResend(err);

    if (shouldFailover) {
      const { from, to, subject, html, text, headers, replyTo, messageId } =
        mailOptions;
      return await sendViaResend({
        from,
        to,
        subject,
        html,
        text,
        headers,
        replyTo,
        messageId,
      });
    }
    throw err;
  }
}

/* ---------------- Public API ---------------- */

export async function sendOtpEmail({
  to,
  code,
  ttlSec,
  ttlSeconds,
  brand,
  purpose,
  meta,
}) {
  const brandName = brand || BRAND_NAME;

  // prefer ttlSeconds if provided; keep ttlSec for backward compatibility
  const ttl =
    (Number.isFinite(Number(ttlSeconds)) && Number(ttlSeconds)) ||
    (Number.isFinite(Number(ttlSec)) && Number(ttlSec)) ||
    DEFAULT_TTL;

  // readable purpose (supports nested meta.purpose defensively)
  const pKey = String(purpose ?? meta?.purpose ?? "login").toLowerCase().trim();
  const readable = PURPOSE_LABELS[pKey] || pKey || "verification";

  requireFromAddr();

  const subject = `${brandName} ${readable} code: ${code}`;
  const plain = `Your ${brandName} ${readable} code is ${code}. It expires in ${fmtTtl(
    ttl
  )}. If you didn’t request this, ignore this email.`;

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;max-width:640px;margin:0 auto;padding:16px">
      <h2 style="margin:0 0 12px">${brandName} verification code</h2>
      <p>Your ${readable} code is</p>
      <p style="font-size:22px;font-weight:700;letter-spacing:2px">${code}</p>
      <p>This code expires in <b>${fmtTtl(ttl)}</b>.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
      <p style="color:#666;font-size:12px;margin:0">
        This is an automated message from ${brandName}. Replies to this address are not monitored.
        For help, contact ${SUPPORT_ADDRESS} or visit ${BRAND_URL}.
      </p>
    </div>
  `.trim();

  const alignedDomain = domainOf(FROM_ADDR);
  // Deterministic when meta.otpId provided (prevents duplicates across retries/fallback)
  const messageId = makeMessageId(alignedDomain, meta?.otpId || meta?.id || null);

  const mail = {
    // Hard-align all sender identities to the same domain for DMARC
    from: `${brandName} <${FROM_ADDR}>`, // RFC5322.From (visible)
    sender: FROM_ADDR, // RFC5322.Sender
    to,
    subject,
    text: plain,
    html,

    // RFC5321.MailFrom (envelope/bounce) — SAME DOMAIN as 'from'
    envelope: { from: RETURN_PATH, to },

    // IMPORTANT: this header is used by smtp.js to trigger OTP fast mode reliably
    headers: {
      "X-TDLC-Mail-Purpose": "otp",
      "X-TDLC-Type": "otp",
      "X-TDLC-Brand": BRAND_NAME,
      "X-TDLC-Purpose": pKey || "verification",
      ...(meta?.otpId ? { "X-TDLC-OTP-Id": String(meta.otpId) } : {}),
      "Auto-Submitted": "auto-generated",
      "List-Unsubscribe": `<mailto:unsubscribe@${alignedDomain}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },

    replyTo: SUPPORT_ADDRESS,
    messageId,
  };

  return sendWithFailover(mail);
}

export async function sendOrderConfirmation({
  to,
  orderId,
  placedAt,
  items,
  subtotal,
  shipping,
  tax,
  total,
}) {
  requireFromAddr();

  const rows = (items || [])
    .map(
      (i) => `
    <tr>
      <td style="padding:8px 0">${i.name} × ${i.qty}</td>
      <td style="text-align:right;padding:8px 0">${i.amount}</td>
    </tr>
  `
    )
    .join("");

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;max-width:640px;margin:0 auto;padding:16px">
      <h2 style="margin:0 0 12px">Thank you! Your order is confirmed.</h2>
      <p>Order ID: <b>${orderId}</b></p>
      <p>Date: ${placedAt}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:8px">
        <tbody>
          ${rows}
          <tr><td style="padding-top:8px;border-top:1px solid #eee">Subtotal</td><td style="text-align:right;padding-top:8px;border-top:1px solid #eee">${subtotal}</td></tr>
          <tr><td>Shipping</td><td style="text-align:right">${shipping}</td></tr>
          <tr><td>Tax</td><td style="text-align:right">${tax}</td></tr>
          <tr><td style="padding-top:8px;border-top:1px solid #eee"><b>Total</b></td><td style="text-align:right;padding-top:8px;border-top:1px solid #eee"><b>${total}</b></td></tr>
        </tbody>
      </table>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
      <p style="color:#666;font-size:12px;margin:0">This is an automated message from ${BRAND_NAME}. Replies to this address are not monitored.</p>
    </div>
  `.trim();

  const text = `Order ${orderId} confirmed. Total: ${total}.`;
  const alignedDomain = domainOf(FROM_ADDR);
  const messageId = makeMessageId(alignedDomain, `order:${orderId}:${String(to)}`);

  const mail = {
    from: `${BRAND_NAME} <${FROM_ADDR}>`,
    sender: FROM_ADDR,
    to,
    subject: `Order ${orderId} confirmed — ${BRAND_NAME}`,
    text,
    html,
    envelope: { from: RETURN_PATH, to },
    headers: {
      "X-TDLC-Mail-Purpose": "transactional",
      "X-TDLC-Type": "order_confirmation",
      "X-TDLC-Brand": BRAND_NAME,
      "Auto-Submitted": "auto-generated",
      "List-Unsubscribe": `<mailto:unsubscribe@${alignedDomain}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    replyTo: SUPPORT_ADDRESS,
    messageId,
  };

  return sendWithFailover(mail);
}

// Optional export to keep wording consistent across the app
export const purposeLabel = (key) => {
  const k = String(key || "").toLowerCase().trim();
  return PURPOSE_LABELS[k] || k || "verification";
};
