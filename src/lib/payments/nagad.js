// Nagad Hosted Checkout (cryptographic flow condensed)
// Requires merchant keys in base64 (PKCS#8) as env vars.
import crypto from "crypto";

const {
  NAGAD_MERCHANT_ID,
  NAGAD_MERCHANT_NUMBER,
  NAGAD_PUBLIC_KEY_BASE64,
  NAGAD_PRIVATE_KEY_BASE64,
  NAGAD_SANDBOX = "true",
  PUBLIC_BASE_URL,
} = process.env;

function base() {
  return NAGAD_SANDBOX === "true"
    ? "https://sandbox.nagad.com.bd"
    : "https://api.nagad.com.bd";
}

function rsaEncrypt(data, pubB64) {
  const key = Buffer.from(pubB64, "base64").toString("utf8");
  return crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(data, "utf8")
  ).toString("base64");
}
function rsaSign(data, privB64) {
  const key = Buffer.from(privB64, "base64").toString("utf8");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data);
  return signer.sign(key, "base64");
}

export async function nagadCreatePayment({
  amount,
  orderId,
}) {
  if (!PUBLIC_BASE_URL) throw new Error("public_base_url_missing");
  const datetime = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

  // Step 1: /check-out/initialize/{merchantId}/{timestamp}
  const initPayload = {
    merchantId: NAGAD_MERCHANT_ID,
    datetime,
    orderId,
    challenge: crypto.randomBytes(16).toString("hex"),
  };
  const sensitive = rsaEncrypt(JSON.stringify(initPayload), NAGAD_PUBLIC_KEY_BASE64);
  const signature = rsaSign(JSON.stringify(initPayload), NAGAD_PRIVATE_KEY_BASE64);

  const initRes = await fetch(
    `${base()}/api/dfs/check-out/initialize/${NAGAD_MERCHANT_ID}/${datetime}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sensitiveData: sensitive, signature }),
    }
  );
  const initData = await initRes.json();
  if (!initRes.ok || !initData?.sensitiveData)
    throw new Error("nagad_init_failed");

  const payload = {
    merchantId: NAGAD_MERCHANT_ID,
    orderId,
    currencyCode: "050", // BDT
    amount: String(amount),
    challenge: JSON.parse(
      Buffer.from(initData.sensitiveData, "base64").toString("utf8")
    )?.challenge,
    merchantCallbackURL: `${PUBLIC_BASE_URL}/api/payments/nagad/callback`,
  };
  const paySensitive = rsaEncrypt(JSON.stringify(payload), NAGAD_PUBLIC_KEY_BASE64);
  const paySignature = rsaSign(JSON.stringify(payload), NAGAD_PRIVATE_KEY_BASE64);

  const payRes = await fetch(`${base()}/api/dfs/check-out/complete/${NAGAD_MERCHANT_ID}/${datetime}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sensitiveData: paySensitive, signature: paySignature }),
  });
  const payData = await payRes.json();
  if (!payRes.ok || !payData?.callBackUrl) throw new Error("nagad_create_failed");

  return {
    redirect_url: payData.callBackUrl,
    payment_ref_id: payData.paymentReferenceId,
  };
}
