// lib/otp.js
// Replace this in production with Redis or another persistent store.
const store = new Map(); // key: `${to}:${purpose}` => { code, exp }

export function createOtp(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) code += Math.floor(Math.random() * 10);
  return code;
}

export async function persistOtp({ to, purpose, code, ttlSec = 300 }) {
  const key = `${to}:${purpose}`;
  const exp = Date.now() + ttlSec * 1000;
  store.set(key, { code, exp });
}

export async function verifyOtpAndConsume({ to, purpose = "login", code }) {
  const key = `${to}:${purpose}`;
  const row = store.get(key);
  if (!row) return false;
  if (Date.now() > row.exp) {
    store.delete(key);
    return false;
  }
  const ok = row.code === code;
  if (ok) store.delete(key);
  return ok;
}
