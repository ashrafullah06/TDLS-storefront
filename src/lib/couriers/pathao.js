// Pathao Courier — create order (store must be onboarded)
const {
  PATHAO_TOKEN,
  PATHAO_STORE_ID,
  PATHAO_BASE = "https://api-hermes.pathao.com",
} = process.env;

export async function pathaoCreateShipment({
  orderId,
  recipientName,
  recipientPhone,
  address,
  city = 14, // Dhaka
  area = 228, // default area (change per your address book)
  amountToCollect,
}) {
  if (!PATHAO_TOKEN || !PATHAO_STORE_ID) throw new Error("pathao_creds_missing");

  const payload = {
    store_id: Number(PATHAO_STORE_ID),
    recipient_name: recipientName,
    recipient_phone: recipientPhone,
    recipient_address: address,
    recipient_city: Number(city),
    recipient_zone: Number(area),
    delivery_type: "regular",
    item_type: "parcel",
    special_instruction: `Order ${orderId}`,
    amount_to_collect: Number(amountToCollect) || 0,
  };

  const res = await fetch(`${PATHAO_BASE}/aladdin/api/v1/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PATHAO_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data?.data?.consignment_id)
    throw new Error("pathao_create_failed");
  return {
    tracking: String(data.data.consignment_id),
    label_url: null,
  };
}
