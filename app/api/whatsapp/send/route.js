// app/api/whatsapp/send/route.js
export const dynamic = "force-dynamic";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
}

export async function OPTIONS() {
  // CORS preflight (useful if you call from client)
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export async function POST(req) {
  try {
    const { to, text } = await req.json().catch(() => ({}));

    if (!to || !text) {
      return json({ error: "Both 'to' and 'text' are required." }, { status: 400 });
    }

    const token = process.env.WA_ACCESS_TOKEN;
    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      return json(
        { error: "WhatsApp credentials missing. Set WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN." },
        { status: 503 }
      );
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: String(to),
      type: "text",
      text: { body: String(text) },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return json({ error: "WhatsApp API error", details: data }, { status: res.status });
    }

    return json({ ok: true, data }, { status: 200 });
  } catch (e) {
    return json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
