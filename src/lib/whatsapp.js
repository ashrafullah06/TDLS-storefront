// lib/whatsapp.js
import twilio from "twilio";

/**
 * Env for WhatsApp Cloud API (preferred)
 * - WA_PHONE_NUMBER_ID: e.g. "123456789012345"
 * - WA_ACCESS_TOKEN: permanent user token / system token
 */
const WA_PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_TOKEN = process.env.WA_ACCESS_TOKEN;

/**
 * Env for Twilio WhatsApp (fallback)
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - TWILIO_WHATSAPP_FROM: e.g. "whatsapp:+12025550123" or "+12025550123"
 */
const TW_SID = process.env.TWILIO_ACCOUNT_SID;
const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TW_WA_FROM = process.env.TWILIO_WHATSAPP_FROM;

/**
 * Low-level sender.
 * Sends a raw WhatsApp text message using:
 *  1) Meta WhatsApp Cloud API (if configured), else
 *  2) Twilio WhatsApp (if configured).
 *
 * @param {string} to    E.164 phone (with +), e.g. "+8801XXXXXXXXX"
 * @param {string} body  Message text
 * @returns {Promise<{id: string}>}
 */
export async function sendWhatsApp(to, body) {
  // Prefer WhatsApp Cloud API if configured
  if (WA_PHONE_ID && WA_TOKEN) {
    const url = `https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(to).replace(/^whatsapp:/, ""), // Cloud expects raw E.164
        type: "text",
        text: { body },
      }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`WHATSAPP_CLOUD_SEND_FAILED:${r.status}:${t}`);
    }

    const json = await r.json().catch(() => ({}));
    return { id: json?.messages?.[0]?.id || "wa-cloud" };
  }

  // Fallback to Twilio WhatsApp
  if (TW_SID && TW_TOKEN && TW_WA_FROM) {
    const client = twilio(TW_SID, TW_TOKEN);
    const res = await client.messages.create({
      from: TW_WA_FROM.startsWith("whatsapp:") ? TW_WA_FROM : `whatsapp:${TW_WA_FROM}`,
      to: to.startsWith("whatsapp:") ? to : `whatsapp:${to}`,
      body,
    });
    return { id: res.sid };
  }

  throw new Error("WHATSAPP_NOT_CONFIGURED");
}

/**
 * High-level OTP helper used by the /api/auth/request-otp route.
 * Keeps the same call shape as email/SMS helpers:
 *   sendOtpWhatsapp({ to, code, ttlSec, brand, purpose })
 *
 * @param {Object} params
 * @param {string} params.to       E.164 phone number (with +)
 * @param {string|number} params.code
 * @param {number} params.ttlSec   Time to live in seconds
 * @param {string} [params.brand="TDLC"]
 * @param {string} [params.purpose="login"]
 */
export async function sendOtpWhatsapp({
  to,
  code,
  ttlSec,
  brand = "TDLC",
  purpose = "login",
}) {
  const minutes = Math.max(1, Math.ceil(Number(ttlSec || 300) / 60));
  const body = `Your ${brand} ${purpose} OTP is ${code}. It will expire in ${minutes} minute${minutes > 1 ? "s" : ""}. Do not share this code.`;
  return sendWhatsApp(to, body);
}
