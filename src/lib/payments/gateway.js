// PATH: src/lib/payments/gateway.js

/**
 * A minimal provider-agnostic mock capture.
 * Replace with real SDK calls for Stripe/SSLCommerz/bKash/Nagad as needed.
 */
export async function capturePayment({ provider, transactionId, amount, currency }) {
  // Simulate provider capture logic with basic validation
  if (!provider) throw new Error("Missing provider");
  if (!amount || Number(amount) <= 0) throw new Error("Invalid amount");
  if (provider === "CASH_ON_DELIVERY") {
    // COD has nothing to capture
    return { ok: false, status: "UNSUPPORTED", message: "COD does not support capture" };
  }

  // Pretend the gateway returns a capture reference
  return {
    ok: true,
    status: "CAPTURED",
    captureRef: transactionId || `CAP_${Math.random().toString(36).slice(2, 10)}`,
    raw: { provider, transactionId, amount: Number(amount), currency },
  };
}
