// RedX Courier — create order
const { REDX_API_KEY, REDX_BASE = "https://openapi.redx.com.bd" } = process.env;

export async function redxCreateShipment({
  orderId,
  recipientName,
  recipientPhone,
  address,
  amountToCollect, // COD amount (BDT)
}) {
  if (!REDX_API_KEY) throw new Error("redx_key_missing");

  const payload = {
    customer_name: recipientName,
    customer_phone: recipientPhone,
    customer_address: address,
    cod_amount: Number(amountToCollect) || 0,
    reference: orderId,
  };

  const res = await fetch(`${REDX_BASE}/v1.0.0/orders`, {
    method: "POST",
    headers: {
      "X-API-KEY": REDX_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data?.tracking_id) throw new Error("redx_create_failed");
  return { tracking: data.tracking_id, label_url: data?.label_url || null };
}
