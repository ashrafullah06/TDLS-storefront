// bKash checkout (token + create + execute) — simplified server initiator
// Requires merchant sandbox/prod creds
const {
  BKASH_USERNAME,
  BKASH_PASSWORD,
  BKASH_APP_KEY,
  BKASH_APP_SECRET,
  BKASH_SANDBOX = "true",
  PUBLIC_BASE_URL,
} = process.env;

function base() {
  return BKASH_SANDBOX === "true"
    ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta"
    : "https://tokenized.pay.bka.sh/v1.2.0-beta";
}

async function authToken() {
  const res = await fetch(`${base()}/tokenized/checkout/token/grant`, {
    method: "POST",
    headers: {
      username: BKASH_USERNAME,
      password: BKASH_PASSWORD,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_key: BKASH_APP_KEY,
      app_secret: BKASH_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data?.id_token) throw new Error("bkash_auth_failed");
  return data.id_token;
}

export async function bkashCreatePayment({
  amount,
  currency,
  invoiceNumber,
  intent = "sale",
}) {
  if (!PUBLIC_BASE_URL) throw new Error("public_base_url_missing");
  const token = await authToken();

  const payload = {
    mode: "0011",
    payerReference: "cust",
    callbackURL: `${PUBLIC_BASE_URL}/api/payments/bkash/callback`,
    amount: String(amount),
    currency,
    intent,
    merchantInvoiceNumber: invoiceNumber,
  };

  const res = await fetch(`${base()}/tokenized/checkout/create`, {
    method: "POST",
    headers: {
      authorization: token,
      "x-app-key": BKASH_APP_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data?.bkashURL) throw new Error(data?.statusMessage || "bkash_create_failed");
  return {
    redirect_url: data.bkashURL,
    payment_id: data.paymentID,
    auth_token: token, // needed for execute from callback handler
  };
}
