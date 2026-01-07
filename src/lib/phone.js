// FILE: src/lib/phone.js

/**
 * Canonical phone normalizer for the whole app.
 *
 * Storage format (DB):
 *   - Digits only, no "+".
 *   - BD mobiles: "017XXXXXXXX" / "+88017XXXXXXXX" / "88017XXXXXXXX"
 *     all become: "88017XXXXXXXX".
 *   - Other countries: "+<digits>" or "00<digits>" -> "<digits>".
 *
 * This is what we store in User.phone and always query with.
 */
export function normalizePhone(raw) {
  if (!raw) return null;

  let s = String(raw).trim();
  // Remove everything except digits and "+"
  s = s.replace(/[^\d+]/g, "");

  // Bangladesh mobiles (11 digits, starting with 01)
  if (/^0\d{10}$/.test(s)) {
    // "01787091462" -> "8801787091462"
    s = "880" + s.slice(1);
  } else if (/^\+880\d{10}$/.test(s)) {
    // "+8801787091462" -> "8801787091462"
    s = s.replace(/^\+/, "");
  } else if (/^880\d{10}$/.test(s)) {
    // already canonical
  } else {
    // Generic: strip "+", accept 8–15 digits
    const digits = s.replace(/\+/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    s = digits;
  }

  const digits = s.replace(/\+/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  return digits; // final canonical form
}

/**
 * For SMS/WhatsApp gateways: convert canonical DB value to E.164-like "+digits".
 */
export function toE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/[^\d]/g, "");
  if (!digits) return null;
  return `+${digits}`;
}

/**
 * Safely compare two raw phone inputs as “same person”.
 */
export function phonesEqual(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb;
}
