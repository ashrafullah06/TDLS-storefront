// Stripe via REST (no SDK dependency). Requires STRIPE_SECRET_KEY.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

export async function stripeCreatePaymentIntent({
  amount, // Decimal(12,2) string or number in major units
  currency, // e.g., "BDT"
  metadata = {},
}) {
  if (!STRIPE_SECRET_KEY) throw new Error("stripe_key_missing");

  // Convert major to minor (e.g., 1234.56 -> 123456)
  const minor = Math.round(Number(amount) * 100);

  const body = new URLSearchParams({
    amount: String(minor),
    currency: currency.toLowerCase(),
    automatic_payment_methods: "enabled",
    ...Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, String(v)])
    ),
  });

  const res = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
    },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    // expose Stripe error message
    throw new Error(data?.error?.message || "stripe_error");
  }

  return {
    id: data.id,
    client_secret: data.client_secret,
    status: data.status,
  };
}
