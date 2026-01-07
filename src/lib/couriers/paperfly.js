// Paperfly — create order (classic JSON API)
const { PAPERFLY_TOKEN, PAPERFLY_BASE = "https://api.paperfly.com.bd" } = process.env;

export async function paperflyCreateShipment({
  orderId,
  recipientName,
  recipientPhone,
  address,
  amountToCollect,
}) {
  if (!PAPERFLY_TOKEN) throw new Error("paperfly_token_missing");

  const payload = {
    order_id: orderId,
    recipient_name: recipientName,
    recipient_phone: recipientPhone,
    recipient_address: address,
    cod_amount: Number(amountToCollect) || 0,
  };

  const res = await fetch(`${PAPERFLY_BASE}/merchant-api/v1/create-order`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAPERFLY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data?.tracking_number)
    throw new Error("paperfly_create_failed");
  return { tracking: data.tracking_number, label_url: data?.label_url || null };
}
