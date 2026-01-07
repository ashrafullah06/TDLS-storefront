// Identifier helpers (email/phone) in plain JS

export const isEmailish = (v) => /\S+@\S+\.\S+/.test(String(v || ""));
export const isPhoneish = (v) => /^\+?\d[\d\s\-()]*$/.test(String(v || ""));
export const onlyDigitsPlus = (v) => String(v || "").replace(/[^\d+]/g, "");

export function toE164(raw) {
  const s = onlyDigitsPlus(raw || "");
  if (!s) return "";
  return s.startsWith("+") ? s : `+${s}`;
}

export function normalizeIdentifier(anyId) {
  if (!anyId) return "";
  const raw = String(anyId).trim();
  return isEmailish(raw) ? raw.toLowerCase() : toE164(raw);
}
