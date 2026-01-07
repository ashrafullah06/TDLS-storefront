// hooks/use-otp-autofill.js
import { useEffect } from "react";

/**
 * Autofills OTP from:
 * - URL param: ?otp=123456
 * - Web OTP API for SMS (Android Chrome)
 * - Plus exposes a "pasteFromClipboard" helper (works after user interaction)
 */
export function useOtpAutofill(setter) {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("otp");
      if (code) setter(code);
    } catch {}
  }, [setter]);

  useEffect(() => {
    let abort = new AbortController();
    if ("OTPCredential" in window) {
      navigator.credentials
        .get({ otp: { transport: ["sms"] }, signal: abort.signal })
        .then((cred) => cred?.code && setter(cred.code))
        .catch(() => {});
    }
    return () => abort.abort();
  }, [setter]);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const m = text.match(/\b(\d{4,8})\b/);
      if (m) setter(m[1]);
    } catch {}
  };

  return { pasteFromClipboard };
}
