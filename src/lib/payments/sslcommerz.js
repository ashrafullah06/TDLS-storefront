// SSLCommerz gateway init
const {
  SSLCZ_STORE_ID,
  SSLCZ_STORE_PASSWORD,
  SSLCZ_SANDBOX = "true",
  PUBLIC_BASE_URL,
} = process.env;

function sslczBase() {
  return SSLCZ_SANDBOX === "true"
    ? "https://sandbox.sslcommerz.com"
    : "https://securepay.sslcommerz.com";
}

/**
 * Returns { GatewayPageURL, sessionkey }
 * Docs: https://developer.sslcommerz.com/doc/v4/#initiation
 */
export async function sslcommerzInitPayment({
  amount,
  currency,
  tran_id,
  cus_name,
  cus_email,
  cus_phone,
  cus_add1,
  desc = "Order payment",
}) {
  if (!SSLCZ_STORE_ID || !SSLCZ_STORE_PASSWORD)
    throw new Error("sslcz_credentials_missing");
  if (!PUBLIC_BASE_URL) throw new Error("public_base_url_missing");

  const payload = {
    store_id: SSLCZ_STORE_ID,
    store_passwd: SSLCZ_STORE_PASSWORD,
    total_amount: Number(amount),
    currency,
    tran_id,
    success_url: `${PUBLIC_BASE_URL}/api/payments/sslcommerz/success`,
    fail_url: `${PUBLIC_BASE_URL}/api/payments/sslcommerz/fail`,
    cancel_url: `${PUBLIC_BASE_URL}/api/payments/sslcommerz/cancel`,
    emi_option: 0,
    cus_name,
    cus_email,
    cus_add1,
    cus_city: "Dhaka",
    cus_state: "Dhaka",
    cus_postcode: "1200",
    cus_country: "Bangladesh",
    cus_phone,
    product_name: "Order",
    product_category: "General",
    product_profile: "general",
    value_a: tran_id, // echo back
    value_b: "order",
    value_c: "",
    value_d: "",
  };

  const res = await fetch(`${sslczBase()}/gwprocess/v4/api.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data?.status !== "SUCCESS") {
    throw new Error(data?.failedreason || "sslcommerz_init_failed");
  }
  return {
    gateway_url: data.GatewayPageURL,
    sessionkey: data.sessionkey,
  };
}
