// smtp.js
import nodemailer from "nodemailer";
import crypto from "crypto";

/**
 * Smart multi-provider SMTP with circuit breaker + strict TLS.
 * Providers tried in priority order. If a provider returns a soft/hard error
 * or hits quota, we "open" its breaker for a cooldown period and try the next.
 * Only ONE provider will send a given message (no double sends).
 *
 * Supported providers via env:
 * - MailerSend: MAILERSEND_SMTP_HOST/PORT/USERNAME/PASSWORD
 * - Brevo:      BREVO_SMTP_HOST/PORT/BREVO_SMTP_USER/BREVO_SMTP_PASS
 * - ZeptoMail:  ZEPTO_SMTP_HOST/PORT/ZEPTO_SMTP_USER/ZEPTO_SMTP_PASS
 * - Mailjet:    MAILJET_SMTP_HOST/PORT/MAILJET_SMTP_USER/MAILJET_SMTP_PASS
 *
 * From address / brand:
 * - BRAND_NAME, EMAIL_FROM_NOREPLY, SUPPORT_ADDRESS, BRAND_URL
 *
 * Optional:
 * - SMTP_PRIORITY = "mailersend,brevo,zepto,mailjet"
 * - SMTP_SECURE = "true" to force SMTPS/465 for all, otherwise inferred by port
 *
 * Optional fast mode (OTP):
 * - SMTP_FAST_POOL = "false" to disable fast pooling (default: enabled for speed)
 * - SMTP_FAST_GREETING_TIMEOUT_MS (default 800)
 * - SMTP_FAST_CONNECTION_TIMEOUT_MS (default 800)
 * - SMTP_FAST_SOCKET_TIMEOUT_MS (default 5000)
 * - SMTP_FAST_ATTEMPT_TIMEOUT_MS (default 1500)  // hard per-provider deadline (prevents "hang" delay)
 * - SMTP_OTP_DEDUPE_WINDOW_MS (default 3000)
 * - SMTP_QUOTA_COOLDOWN_MINUTES (default 720 = 12h)
 */

let _smartTransporter; // our "virtual" transporter object
const _nodeTransporters = new Map(); // id:mode -> nodemailer transport
const _breakers = new Map(); // id -> {openUntil:number, failures:number, lastError?:string}

/**
 * ✅ OTP EMAIL DEDUPE (NO USER COOLDOWN)
 *
 * Fixes "double OTP email" caused by duplicate calls (double-submit, React double effect,
 * network retry, client re-render). It does NOT block legitimate resends.
 *
 * Behavior:
 * - Only applies to OTP-like emails.
 * - Only dedupes IDENTICAL payloads within a tiny window (default 3s).
 * - If the OTP code/body changes, it sends immediately.
 */
const _recentOtpSends = new Map(); // fp -> { expiresAt:number, promise:Promise<any> }
const OTP_DEDUPE_WINDOW_MS = Number(process.env.SMTP_OTP_DEDUPE_WINDOW_MS || 3000);

const DEFAULT_PORT = 587;

const POOL_OPTS = {
  pool: true,
  maxConnections: 4,
  maxMessages: 200,
  greetingTimeout: 20000,
  connectionTimeout: 20000,
  socketTimeout: 60000,
};

// Fast-lane pooling: keeps a warm connection for "click and fire" OTPs.
// Disable via SMTP_FAST_POOL=false if you ever observe provider-side issues.
const FAST_POOL_ENABLED =
  String(process.env.SMTP_FAST_POOL || "true").toLowerCase() !== "false";

const FAST_BASE_TIMEOUTS = {
  greetingTimeout: Number(process.env.SMTP_FAST_GREETING_TIMEOUT_MS || 800),
  connectionTimeout: Number(process.env.SMTP_FAST_CONNECTION_TIMEOUT_MS || 800),
  socketTimeout: Number(process.env.SMTP_FAST_SOCKET_TIMEOUT_MS || 5000),
};

function clampMs(v, minV, maxV) {
  const n = Number(v);
  if (!Number.isFinite(n)) return minV;
  return Math.max(minV, Math.min(maxV, n));
}

// Clamp fast-lane socket timeouts (prevents accidental huge delays)
FAST_BASE_TIMEOUTS.greetingTimeout = clampMs(FAST_BASE_TIMEOUTS.greetingTimeout, 300, 5000);
FAST_BASE_TIMEOUTS.connectionTimeout = clampMs(FAST_BASE_TIMEOUTS.connectionTimeout, 300, 5000);
FAST_BASE_TIMEOUTS.socketTimeout = clampMs(FAST_BASE_TIMEOUTS.socketTimeout, 1000, 30000);

const FAST_NOPOOL_OPTS = {
  pool: false,
  ...FAST_BASE_TIMEOUTS,
};

const FAST_POOL_OPTS = {
  pool: true,
  // Keep a single warm connection to minimize handshake latency for OTP.
  // (Still safe: OTP dedupe prevents accidental double-send.)
  maxConnections: Number(process.env.SMTP_FAST_POOL_MAX_CONNECTIONS || 1),
  maxMessages: Number(process.env.SMTP_FAST_POOL_MAX_MESSAGES || 50),
  ...FAST_BASE_TIMEOUTS,
};

let FAST_ATTEMPT_TIMEOUT_MS = Number(process.env.SMTP_FAST_ATTEMPT_TIMEOUT_MS || 1500);
// Guardrails: keep OTP attempts aggressively fast but not zero.
FAST_ATTEMPT_TIMEOUT_MS = Math.max(500, Math.min(5000, FAST_ATTEMPT_TIMEOUT_MS));

const TLS_OPTS = {
  minVersion: "TLSv1.2",
  rejectUnauthorized: true,
};

// Speed memory: stick to last-good provider for OTP to avoid paying the cost of a failing provider first.
let _lastGoodFastProviderId = "";
const _fastLatencyMs = new Map(); // id -> EWMA ms

function now() {
  return Date.now();
}
function minutes(n) {
  return n * 60 * 1000;
}

function ewmaUpdate(map, id, sampleMs, alpha = 0.35) {
  const s = Number(sampleMs);
  if (!Number.isFinite(s) || s <= 0) return;
  const prev = Number(map.get(id) || 0);
  const next = prev ? prev * (1 - alpha) + s * alpha : s;
  map.set(id, Math.round(next));
}

function orderProvidersForFast(providers) {
  if (!providers || providers.length <= 1) return providers || [];
  if (!_lastGoodFastProviderId) return providers;

  const idx = providers.findIndex((p) => p.id === _lastGoodFastProviderId);
  if (idx <= 0) return providers;

  const list = providers.slice();
  const [p] = list.splice(idx, 1);
  list.unshift(p);
  return list;
}

// Build provider configs from env
function providersFromEnv() {
  const defs = {
    mailersend: {
      id: "mailersend",
      label: "MailerSend",
      host: process.env.MAILERSEND_SMTP_HOST,
      port: Number(process.env.MAILERSEND_SMTP_PORT || DEFAULT_PORT),
      user: process.env.MAILERSEND_SMTP_USERNAME,
      pass: process.env.MAILERSEND_SMTP_PASSWORD,
    },
    brevo: {
      id: "brevo",
      label: "Brevo",
      host: process.env.BREVO_SMTP_HOST,
      port: Number(process.env.BREVO_SMTP_PORT || DEFAULT_PORT),
      user: process.env.BREVO_SMTP_USER,
      pass: process.env.BREVO_SMTP_PASS,
    },
    zepto: {
      id: "zepto",
      label: "ZeptoMail",
      host: process.env.ZEPTO_SMTP_HOST,
      port: Number(process.env.ZEPTO_SMTP_PORT || DEFAULT_PORT),
      user: process.env.ZEPTO_SMTP_USER,
      pass: process.env.ZEPTO_SMTP_PASS,
    },
    mailjet: {
      id: "mailjet",
      label: "Mailjet",
      host: process.env.MAILJET_SMTP_HOST,
      port: Number(process.env.MAILJET_SMTP_PORT || DEFAULT_PORT),
      user: process.env.MAILJET_SMTP_USER,
      pass: process.env.MAILJET_SMTP_PASS,
    },
  };

  // priority
  const prio = (process.env.SMTP_PRIORITY || "mailersend,brevo,zepto,mailjet")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const list = [];
  for (const key of prio) {
    const d = defs[key];
    if (!d) continue;
    if (d.host && d.port && d.user && d.pass) list.push(d);
  }
  return list;
}

function getBreaker(id) {
  if (!_breakers.has(id))
    _breakers.set(id, { openUntil: 0, failures: 0, lastError: "" });
  return _breakers.get(id);
}

function isOpen(id) {
  const b = getBreaker(id);
  return b.openUntil && now() < b.openUntil;
}

function openFor(id, ms, reason) {
  const b = getBreaker(id);
  b.openUntil = now() + ms;
  if (reason) b.lastError = String(reason).slice(0, 500);
}

function isAuthError(err) {
  const c = Number(err?.responseCode || err?.code || 0);
  return (
    c === 530 ||
    c === 534 ||
    c === 535 ||
    /auth/i.test(String(err?.message || ""))
  );
}

function isSoftError(err) {
  const c = Number(err?.responseCode || err?.code || 0);
  return (
    [421, 450, 451, 452, 454, 471].includes(c) ||
    /temporar|try again|busy/i.test(String(err?.message || ""))
  );
}

function isQuotaError(err) {
  const msg = String(err?.message || "");
  const code = String(err?.responseCode || err?.code || "");
  // Common quota/rate-limit signals across SMTP providers
  // - MailerSend: MS42204
  // - Generic SMTP: "quota", "usage limit", "rate limit", "too many requests"
  return (
    /MS42204/i.test(msg) ||
    /quota|usage\s*limit|rate\s*limit|daily\s*limit|reached\s+.*limit|too\s+many\s+requests|throttl/i.test(msg) ||
    /429/.test(code)
  );
}

function isGreetingTimeout(err) {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  return /greeting never received/i.test(msg) || (/ETIMEDOUT/i.test(code) && /greeting/i.test(msg));
}

function isConnError(err) {
  return /(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH)/i.test(
    String(err?.code || err?.message || "")
  );
}

function quotaCooldownMs(err) {
  // Prefer explicit env override. Usage limits can be daily or monthly depending on provider/plan.
  const mins = Number(process.env.SMTP_QUOTA_COOLDOWN_MINUTES || 720); // default 12h
  const msg = String(err?.message || "");
  if (/usage\s*limit|MS42204/i.test(msg)) return minutes(Math.max(30, mins));
  return minutes(Math.max(30, Number(process.env.SMTP_QUOTA_COOLDOWN_MINUTES || 45)));
}

// Decide cooldown
function classifyErrorCooldown(err) {
  if (isAuthError(err)) return minutes(60); // likely misconfig; pause 60m
  if (isQuotaError(err)) return quotaCooldownMs(err); // quota/usage limit — pause long
  if (isGreetingTimeout(err)) return minutes(30); // greeting timeouts are almost always connectivity/firewall/provider
  if (isSoftError(err)) return minutes(10); // soft temp failure — pause 10m
  if (isConnError(err)) return minutes(10); // network/connectivity — pause 10m
  return minutes(15);
}

function recordFailure(id, err) {
  const b = getBreaker(id);
  b.failures += 1;
  // Escalate cooldown after repeated failures
  const base = classifyErrorCooldown(err);
  const extra = Math.min(b.failures - 1, 4) * minutes(2); // +0/2/4/6/8 min
  openFor(
    id,
    base + extra,
    err?.message || err?.toString?.() || "send failed"
  );

  // If primary is repeatedly failing, ensure we don't keep trying it first for OTP.
  if (id === _lastGoodFastProviderId && b.failures >= 1) _lastGoodFastProviderId = "";
}

function resetFailures(id) {
  const b = getBreaker(id);
  b.failures = 0;
  b.openUntil = 0;
}

function createNodeTransport(provider, opts = {}) {
  const forcedSecure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
  const secure = forcedSecure || provider.port === 465;

  const fastOpts = FAST_POOL_ENABLED ? FAST_POOL_OPTS : FAST_NOPOOL_OPTS;

  return nodemailer.createTransport({
    host: provider.host,
    port: provider.port,
    secure,
    auth: { user: provider.user, pass: provider.pass },
    // Force STARTTLS on 587
    requireTLS: !secure,
    tls: TLS_OPTS,
    ...(opts.fast ? fastOpts : POOL_OPTS),
  });
}

function getNodeTransport(provider, opts = {}) {
  /**
   * FAST-LANE (OTP):
   * - If pooling is enabled (default), cache a single warm connection per provider.
   * - If pooling is disabled, create per attempt (previous behavior).
   */
  if (opts.fast && !FAST_POOL_ENABLED) return createNodeTransport(provider, opts);

  const key = `${provider.id}:${opts.fast ? "fastpool" : "norm"}`;
  if (_nodeTransporters.has(key)) return _nodeTransporters.get(key);
  const t = createNodeTransport(provider, opts);
  _nodeTransporters.set(key, t);
  return t;
}

function looksLikeOtpMail(mailOptions) {
  try {
    const h = mailOptions?.headers || {};
    const hdrPurpose = String(
      h["X-TDLC-Mail-Purpose"] || h["X-Mail-Purpose"] || ""
    ).toLowerCase();
    if (hdrPurpose.includes("otp")) return true;

    const subj = String(mailOptions?.subject || "");
    if (/\botp\b|one[- ]time|security\s+code|login\s+code|authentication\s+code|confirm(ation)?\s+code|verify\s+code|passcode|two[- ]factor|2fa/i.test(subj)) return true;

    const text = String(mailOptions?.text || "");
    const html = String(mailOptions?.html || "");
    const body = (text + "\n" + html).slice(0, 5000);

    // typical OTP mail contains a 6-digit code and an OTP keyword.
    const has6 = /\b\d{6}\b/.test(body);
    const hasOtpWord = /\botp\b|verification\s+code|one[- ]time|security\s+code|login\s+code|authentication\s+code|confirm(ation)?\s+code|verify\s+code|passcode|two[- ]factor|2fa/i.test(body);
    return has6 && hasOtpWord;
  } catch {
    return false;
  }
}

function otpFingerprint(mailOptions) {
  // Future-proof: prefer explicit idempotency headers if present
  const h = mailOptions?.headers || {};
  const explicit = String(
    h["X-TDLC-OTP-ID"] || h["X-TDLC-Idempotency-Key"] || h["X-Idempotency-Key"] || ""
  ).trim();

  const to = String(mailOptions?.to || "").trim().toLowerCase();
  const subj = String(mailOptions?.subject || "").trim();

  // Use content-derived fingerprint (stable even if messageId is generated later)
  const text = String(mailOptions?.text || "");
  const html = String(mailOptions?.html || "");
  const body = (text + "\n" + html).slice(0, 8000);

  const base = explicit || `${to}::${subj}::${body}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}

function sweepRecentOtpSends() {
  const t = now();
  for (const [k, v] of _recentOtpSends.entries()) {
    if (!v || v.expiresAt <= t) _recentOtpSends.delete(k);
  }
}

function closeTransportSafe(t) {
  try {
    if (t && typeof t.close === "function") t.close();
  } catch {}
}

function timeoutError(ms, providerId) {
  const e = new Error(`SMTP send timed out after ${ms}ms (${providerId})`);
  e.code = "SMTP_FAST_TIMEOUT";
  return e;
}

async function sendMailWithHardTimeout(transport, mail, timeoutMs, providerId, closeAfterSuccess = true) {
  if (!timeoutMs || timeoutMs <= 0) return transport.sendMail(mail);

  let done = false;
  const t = Math.max(250, Number(timeoutMs));

  let timeoutId;
  const timer = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      if (done) return;
      // Close the transport to abort any in-flight connection, preventing late/double sends.
      closeTransportSafe(transport);
      reject(timeoutError(t, providerId));
    }, t);
    // Avoid keeping the process open
    timeoutId?.unref?.();
  });

  try {
    const res = await Promise.race([transport.sendMail(mail), timer]);
    done = true;
    return res;
  } finally {
    done = true;
    if (timeoutId) clearTimeout(timeoutId);
    // For non-pooled fast transports, close immediately to avoid lingering sockets.
    if (closeAfterSuccess) closeTransportSafe(transport);
  }
}

// Our "virtual transporter" that nodemailer-like sendMail across providers
function getSmartTransporter() {
  if (_smartTransporter) return _smartTransporter;

  const providers = providersFromEnv();
  if (!providers.length) {
    console.warn("[smtp] No SMTP providers configured from env; check your credentials.");
  } else {
    console.log("[smtp] Providers (priority):", providers.map((p) => p.id).join(" → "));
  }

  _smartTransporter = {
    async sendMail(mailOptions) {
      const fast = looksLikeOtpMail(mailOptions);

      // ✅ Prevent accidental duplicate OTP EMAIL sends (no user cooldown)
      let _otpFpKey = null;
      if (fast) {
        sweepRecentOtpSends();
        _otpFpKey = otpFingerprint(mailOptions);
        const existing = _recentOtpSends.get(_otpFpKey);
        if (existing && existing.expiresAt > now() && existing.promise) {
          return existing.promise;
        }
      }

      // enforce from / envelope if missing
      const brand = process.env.BRAND_NAME || "TDLC";
      const fromAddr =
        process.env.EMAIL_FROM_NOREPLY ||
        process.env.SUPPORT_ADDRESS ||
        process.env.EMAIL_FROM ||
        "";

      const visibleFrom = mailOptions.from || (fromAddr ? `${brand} <${fromAddr}>` : brand);

      const envelopeFrom =
        (mailOptions.envelope && mailOptions.envelope.from) ||
        process.env.EMAIL_RETURN_PATH ||
        (fromAddr || undefined);

      // attach messageId if the caller hasn't set one
      if (!mailOptions.messageId) {
        const d =
          (fromAddr && String(fromAddr).includes("@") ? String(fromAddr).split("@")[1] : "") ||
          "thednalabstore.com";
        const rnd = Math.random().toString(36).slice(2);
        mailOptions.messageId = `<m.${Date.now()}.${rnd}@${d}>`;
      }

      if (fast) {
        mailOptions.headers = {
          ...(mailOptions.headers || {}),
          "X-TDLC-Mail-Purpose": (mailOptions.headers?.["X-TDLC-Mail-Purpose"] || "otp"),
          "X-Priority": "1",
          "X-MSMail-Priority": "High",
          Importance: "High",
        };
      }

      const baseHeaders = {
        ...(mailOptions.headers || {}),
        "X-Mail-Visible-From": visibleFrom,
        "X-Mail-Envelope-From": envelopeFrom || "",
      };

      let lastErr;

      const baseProviderList = fast ? orderProvidersForFast(providers) : providers;

      const sendPromise = (async () => {
        for (const p of baseProviderList) {
          if (isOpen(p.id)) continue;

          // For OTP: pooled fast transporter is cached (default), otherwise per attempt.
          const transport = getNodeTransport(p, { fast });

          const started = Date.now();
          try {
            const mail = {
              ...mailOptions,
              from: visibleFrom,
              envelope: { from: envelopeFrom, to: mailOptions.to },
              headers: { ...baseHeaders, "X-Mail-Provider": p.label, "X-Provider-ID": p.id },
            };

            const closeAfterSuccess = !(fast && FAST_POOL_ENABLED);

            const res = fast
              ? await sendMailWithHardTimeout(transport, mail, FAST_ATTEMPT_TIMEOUT_MS, p.id, closeAfterSuccess)
              : await transport.sendMail(mail);

            const elapsed = Date.now() - started;

            resetFailures(p.id);

            if (fast) {
              _lastGoodFastProviderId = p.id;
              ewmaUpdate(_fastLatencyMs, p.id, elapsed);
              console.log(
                `[smtp] OTP sent via ${p.label} in ${elapsed}ms (ewma=${_fastLatencyMs.get(p.id) || elapsed}ms)`
              );
            }

            return res;
          } catch (err) {
            const elapsed = Date.now() - started;

            // If a pooled fast transporter got into a bad socket state, close it so the next attempt recreates cleanly.
            if (fast && FAST_POOL_ENABLED && (isConnError(err) || isGreetingTimeout(err))) {
              closeTransportSafe(transport);
              _nodeTransporters.delete(`${p.id}:fastpool`);
            }

            console.warn(
              `[smtp] ${p.label} failed:`,
              err?.responseCode || err?.code || "",
              err?.message || err,
              `(after ${elapsed}ms)`
            );
            lastErr = err;
            recordFailure(p.id, err);
            continue;
          }
        }

        const details = Array.from(_breakers.entries())
          .map(([id, b]) => `${id}{openUntil:${b.openUntil},failures:${b.failures}}`)
          .join(", ");
        const finalErr = lastErr || new Error("All SMTP providers are unavailable");
        finalErr.details = `breakers: ${details}`;
        throw finalErr;
      })();

      // Share in-flight OTP send to avoid double-send from duplicate calls
      if (fast && _otpFpKey) {
        _recentOtpSends.set(_otpFpKey, {
          expiresAt: now() + Math.max(1000, OTP_DEDUPE_WINDOW_MS),
          promise: sendPromise,
        });
      }

      return sendPromise;
    },
  };

  return _smartTransporter;
}

export function getTransporter() {
  return getSmartTransporter();
}
